/**
 * Core schema definitions for workspace types.
 *
 * @packageDocumentation
 */

import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";
import { Option, Schema } from "effect";
import { minimatch } from "minimatch";
import type { PackageJsonParseError } from "../errors/PackageJsonParseError.js";

// ── Branded Primitives ───────────────────────────────────────────────

/**
 * Schema for supported package manager identifiers.
 *
 * @remarks
 * Valid values are `"npm"`, `"pnpm"`, `"yarn"`, and `"bun"`. Used throughout
 * the library to narrow behavior to a specific package manager. The literal
 * union is enforced at the schema level so invalid values are caught during
 * decode rather than at runtime.
 *
 * @example Decoding a package manager value
 * ```typescript
 * import { Schema } from "effect";
 * import { PackageManager } from "workspaces-effect";
 *
 * const result = Schema.decodeUnknownSync(PackageManager)("pnpm");
 * // result: "pnpm"
 * ```
 *
 * @public
 */
export const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun");

/**
 * TypeScript type for the {@link PackageManager} schema.
 *
 * @remarks
 * Equivalent to `"npm" | "pnpm" | "yarn" | "bun"`.
 *
 * @public
 */
export type PackageManagerType = Schema.Schema.Type<typeof PackageManager>;

/**
 * Branded non-empty string representing a package name.
 *
 * @remarks
 * Applies the `PackageName` brand to `Schema.NonEmptyString`, ensuring that
 * decoded values are both non-empty and carry a nominal type tag to prevent
 * accidental interchange with other string types.
 *
 * @example Decoding a package name
 * ```typescript
 * import { Schema } from "effect";
 * import { PackageName } from "workspaces-effect";
 *
 * const name = Schema.decodeUnknownSync(PackageName)("@my-org/utils");
 * // name: PackageName (branded string)
 * ```
 *
 * @public
 */
export const PackageName = Schema.NonEmptyString.pipe(Schema.brand("PackageName"));

/**
 * TypeScript type for the {@link PackageName} schema.
 *
 * @remarks
 * A branded `string` that is guaranteed to be non-empty. Use
 * `Schema.decodeUnknownSync(PackageName)` to produce values of this type.
 *
 * @public
 */
export type PackageNameType = Schema.Schema.Type<typeof PackageName>;

/**
 * Branded non-empty string representing an absolute workspace path.
 *
 * @remarks
 * Applies the `WorkspacePath` brand to `Schema.NonEmptyString`. Used to
 * distinguish workspace directory paths from arbitrary strings in the type
 * system, preventing accidental misuse of unvalidated path values.
 *
 * @example Decoding a workspace path
 * ```typescript
 * import { Schema } from "effect";
 * import { WorkspacePath } from "workspaces-effect";
 *
 * const path = Schema.decodeUnknownSync(WorkspacePath)("/workspace/pkgs/utils");
 * // path: WorkspacePath (branded string)
 * ```
 *
 * @public
 */
export const WorkspacePath = Schema.NonEmptyString.pipe(Schema.brand("WorkspacePath"));

/**
 * TypeScript type for the {@link WorkspacePath} schema.
 *
 * @remarks
 * A branded `string` that is guaranteed to be non-empty. Use
 * `Schema.decodeUnknownSync(WorkspacePath)` to produce values of this type.
 *
 * @public
 */
export type WorkspacePathType = Schema.Schema.Type<typeof WorkspacePath>;

// ── Package.json Schema ──────────────────────────────────────────────

/**
 * The `workspaces` field in package.json.
 *
 * @remarks
 * Supports both the array form (`["packages/*"]`) used by npm and yarn, and
 * the object form (`{ packages: ["packages/*"] }`) used by older yarn versions.
 *
 * @internal
 */
const WorkspaceField = Schema.Union(
	Schema.Array(Schema.String),
	Schema.Struct({ packages: Schema.Array(Schema.String) }),
);

/**
 * Schema for the `publishConfig` field in package.json.
 *
 * @remarks
 * Captures the subset of `publishConfig` properties relevant to workspace
 * tooling: registry selection, access control, and publish directory override.
 *
 * Fields:
 * - `access` — `"public"` or `"restricted"` (scoped package visibility).
 * - `registry` — custom registry URL for publishing.
 * - `directory` — subdirectory to publish instead of the package root.
 *
 * @example Decoding publishConfig
 * ```typescript
 * import { Schema } from "effect";
 * import { PublishConfig } from "workspaces-effect";
 *
 * const config = new PublishConfig({
 *   access: "public",
 *   registry: "https://registry.npmjs.org",
 * });
 * ```
 *
 * @public
 */
export class PublishConfig extends Schema.Class<PublishConfig>("PublishConfig")({
	access: Schema.optional(Schema.Literal("public", "restricted")),
	registry: Schema.optional(Schema.String),
	directory: Schema.optional(Schema.String),
	tag: Schema.optional(Schema.String),
	linkDirectory: Schema.optional(Schema.Boolean),
}) {}

export type PublishConfigType = PublishConfig;

/**
 * Minimal package.json schema for workspace discovery.
 *
 * @remarks
 * Captures only the fields needed by workspace tooling — name, version,
 * private flag, workspace patterns, dependency maps, the `packageManager`
 * field (used by Corepack), and `publishConfig`. Unknown fields are silently
 * ignored during decode.
 *
 * Fields:
 * - `name` — the package name.
 * - `version` — the package version string.
 * - `private` — whether the package is private (not published).
 * - `workspaces` — workspace glob patterns (array or object form).
 * - `dependencies` — production dependency map.
 * - `devDependencies` — development dependency map.
 * - `peerDependencies` — peer dependency map.
 * - `packageManager` — Corepack package manager spec (e.g., `"pnpm@9.1.0"`).
 * - `publishConfig` — publishing configuration overrides.
 *
 * @example Decoding a package.json
 * ```typescript
 * import { Schema } from "effect";
 * import { PackageJsonSchema } from "workspaces-effect";
 *
 * const pkg = Schema.decodeUnknownSync(PackageJsonSchema)({
 *   name: "@my-org/app",
 *   version: "1.0.0",
 *   workspaces: ["packages/*"],
 * });
 * ```
 *
 * @public
 */
export const PackageJsonSchema = Schema.Struct({
	name: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	private: Schema.optional(Schema.Boolean),
	workspaces: Schema.optional(WorkspaceField),
	dependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	devDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	peerDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	optionalDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	packageManager: Schema.optional(Schema.String),
	publishConfig: Schema.optional(PublishConfig),
});

/**
 * TypeScript type for the {@link PackageJsonSchema} schema.
 *
 * @public
 */
export type PackageJsonType = Schema.Schema.Type<typeof PackageJsonSchema>;

// ── Workspace Data Types ─────────────────────────────────────────────

/**
 * Result of comparing two WorkspacePackage dependency snapshots.
 * @public
 */
export interface DependencyDiff {
	readonly added: Record<string, string>;
	readonly removed: Record<string, string>;
	readonly changed: Record<string, { readonly from: string; readonly to: string }>;
}

/**
 * A single workspace package within a monorepo.
 *
 * @remarks
 * Produced by {@link WorkspaceDiscovery} for each package found by expanding
 * the workspace glob patterns. Contains the parsed metadata from the
 * package's `package.json` plus its filesystem location.
 *
 * Fields:
 * - `name` — the package name (non-empty string).
 * - `version` — the package version string.
 * - `path` — absolute filesystem path to the package directory.
 * - `packageJsonPath` — absolute path to the package's `package.json` file.
 * - `relativePath` — path relative to the workspace root.
 * - `private` — whether the package is marked private (defaults to `false`).
 * - `dependencies` — production dependency map (defaults to `{}`).
 * - `devDependencies` — development dependency map (defaults to `{}`).
 * - `peerDependencies` — peer dependency map (defaults to `{}`).
 * - `optionalDependencies` — optional dependency map (defaults to `{}`).
 * - `publishConfig` — optional publishing configuration overrides.
 *
 * @example Creating a WorkspacePackage
 * ```typescript
 * import { WorkspacePackage } from "workspaces-effect";
 *
 * const pkg = new WorkspacePackage({
 *   name: "@my-org/utils",
 *   version: "1.0.0",
 *   path: "/workspace/packages/utils",
 *   packageJsonPath: "/workspace/packages/utils/package.json",
 *   relativePath: "packages/utils",
 * });
 * ```
 *
 * @public
 */
export class WorkspacePackage extends Schema.Class<WorkspacePackage>("WorkspacePackage")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	path: Schema.NonEmptyString,
	packageJsonPath: Schema.NonEmptyString,
	relativePath: Schema.String,
	private: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	dependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
	devDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
	peerDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
	optionalDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
	publishConfig: Schema.optional(PublishConfig),
}) {
	get isRootWorkspace(): boolean {
		return this.relativePath === ".";
	}

	get isPublic(): boolean {
		return !this.private;
	}

	get scope(): Option.Option<string> {
		const match = this.name.match(/^(@[^/]+)\//);
		return match ? Option.some(match[1]) : Option.none();
	}

	get unscopedName(): string {
		const slashIndex = this.name.indexOf("/");
		return this.name.startsWith("@") && slashIndex !== -1 ? this.name.slice(slashIndex + 1) : this.name;
	}

	get allDependencies(): Record<string, string> {
		return {
			...this.optionalDependencies,
			...this.peerDependencies,
			...this.devDependencies,
			...this.dependencies,
		};
	}

	hasDependency(name: string): boolean {
		return name in this.dependencies;
	}

	hasDevDependency(name: string): boolean {
		return name in this.devDependencies;
	}

	hasPeerDependency(name: string): boolean {
		return name in this.peerDependencies;
	}

	hasOptionalDependency(name: string): boolean {
		return name in this.optionalDependencies;
	}

	hasAnyDependencyOn(name: string): boolean {
		return (
			this.hasDependency(name) ||
			this.hasDevDependency(name) ||
			this.hasPeerDependency(name) ||
			this.hasOptionalDependency(name)
		);
	}

	dependencyVersion(name: string): Option.Option<string> {
		const version =
			this.dependencies[name] ??
			this.devDependencies[name] ??
			this.peerDependencies[name] ??
			this.optionalDependencies[name];
		return version !== undefined ? Option.some(version) : Option.none();
	}

	matchesDependency(pattern: string): boolean {
		return Object.keys(this.allDependencies).some((dep) => minimatch(dep, pattern));
	}

	/**
	 * Compare two WorkspacePackage dependency snapshots.
	 *
	 * Compares across all dependency types combined. A dependency that moves
	 * between categories (e.g. from `dependencies` to `peerDependencies`) at
	 * the same version will not appear in the diff.
	 */
	dependencyDiff(other: WorkspacePackage): DependencyDiff {
		const selfDeps = this.allDependencies;
		const otherDeps = other.allDependencies;
		const added: Record<string, string> = {};
		const removed: Record<string, string> = {};
		const changed: Record<string, { from: string; to: string }> = {};

		for (const [name, version] of Object.entries(selfDeps)) {
			if (!(name in otherDeps)) {
				added[name] = version;
			} else if (otherDeps[name] !== version) {
				changed[name] = { from: otherDeps[name], to: version };
			}
		}
		for (const [name, version] of Object.entries(otherDeps)) {
			if (!(name in selfDeps)) {
				removed[name] = version;
			}
		}

		return { added, removed, changed };
	}

	// ── Cross-cutting statics (wired in index.ts) ───────────────────────
	declare static hasDependency: {
		(name: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, name: string): boolean;
	};
	declare static hasDevDependency: {
		(name: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, name: string): boolean;
	};
	declare static hasPeerDependency: {
		(name: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, name: string): boolean;
	};
	declare static hasOptionalDependency: {
		(name: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, name: string): boolean;
	};
	declare static hasAnyDependencyOn: {
		(name: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, name: string): boolean;
	};
	declare static dependencyVersion: {
		(name: string): (self: WorkspacePackage) => Option.Option<string>;
		(self: WorkspacePackage, name: string): Option.Option<string>;
	};
	declare static matchesDependency: {
		(pattern: string): (self: WorkspacePackage) => boolean;
		(self: WorkspacePackage, pattern: string): boolean;
	};
	declare static dependencyDiff: {
		(other: WorkspacePackage): (self: WorkspacePackage) => DependencyDiff;
		(self: WorkspacePackage, other: WorkspacePackage): DependencyDiff;
	};
	declare static readPackageJson: (
		self: WorkspacePackage,
	) => Effect.Effect<PackageJsonType, PackageJsonParseError, FileSystem.FileSystem>;
}

/**
 * Top-level workspace info for a monorepo.
 *
 * @remarks
 * Produced by {@link WorkspaceRoot} and {@link PackageManagerDetector} to
 * describe the workspace root's configuration. Contains the detected package
 * manager, its version (if determinable), and the workspace glob patterns.
 *
 * Fields:
 * - `root` — absolute path to the workspace root directory.
 * - `packageManager` — the detected package manager (`"npm"`, `"pnpm"`, `"yarn"`, or `"bun"`).
 * - `packageManagerVersion` — optional version string from the `packageManager` field.
 * - `patterns` — the workspace glob patterns (e.g., `["packages/*", "apps/*"]`).
 *
 * @example Creating a WorkspaceInfo
 * ```typescript
 * import { WorkspaceInfo } from "workspaces-effect";
 *
 * const info = new WorkspaceInfo({
 *   root: "/workspace",
 *   packageManager: "pnpm",
 *   patterns: ["packages/*", "apps/*"],
 * });
 * ```
 *
 * @public
 */
export class WorkspaceInfo extends Schema.Class<WorkspaceInfo>("WorkspaceInfo")({
	root: Schema.NonEmptyString,
	packageManager: PackageManager,
	packageManagerVersion: Schema.optional(Schema.String),
	patterns: Schema.Array(Schema.String),
}) {}
