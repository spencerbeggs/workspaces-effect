/**
 * Lockfile schema definitions for Phase 4 (Configuration and Lockfiles).
 *
 * @remarks
 * These schemas define the normalized representation of lockfile data across
 * all four supported package managers. Raw lockfile formats are parsed into
 * these common types by the {@link LockfileReader} service.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { PackageManager } from "./core.js";

/**
 * Dependency type discriminator for lockfile entries.
 *
 * @remarks
 * Identifies which dependency map a resolved package originated from:
 * `"dependencies"`, `"devDependencies"`, `"peerDependencies"`, or
 * `"optionalDependencies"`.
 *
 * @internal
 */
const DepType = Schema.Literal("dependencies", "devDependencies", "peerDependencies", "optionalDependencies");

/**
 * A package resolved from a lockfile.
 *
 * @remarks
 * Represents a single resolved package entry from any supported lockfile
 * format. The {@link LockfileReader} normalizes format-specific entries
 * (pnpm YAML, npm JSON, yarn Berry, bun JSONC) into this common shape.
 *
 * Fields:
 * - `name` — the resolved package name (non-empty string).
 * - `version` — the resolved version string.
 * - `integrity` — optional SRI integrity hash (e.g., `"sha512-..."`).
 * - `isWorkspace` — `true` if this package is a workspace-local reference.
 * - `dependencies` — map of this package's own dependencies (defaults to `{}`).
 *
 * @example Creating a ResolvedPackage
 * ```typescript
 * import { ResolvedPackage } from "workspaces-effect";
 *
 * const pkg = new ResolvedPackage({
 *   name: "lodash",
 *   version: "4.17.21",
 *   integrity: "sha512-v2kDE...",
 *   isWorkspace: false,
 * });
 * ```
 *
 * @public
 */
export class ResolvedPackage extends Schema.Class<ResolvedPackage>("ResolvedPackage")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	integrity: Schema.optional(Schema.String),
	isWorkspace: Schema.Boolean,
	dependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
}) {}

/**
 * A dependency relationship between two workspace packages in the lockfile.
 *
 * @remarks
 * Captures the directed edge from one workspace package to another as recorded
 * in the lockfile. Used by {@link LockfileReader} to build the workspace
 * dependency subgraph from lockfile data.
 *
 * Fields:
 * - `from` — the name of the workspace package that declares the dependency.
 * - `to` — the name of the workspace package that is depended upon.
 * - `depType` — which dependency map contains this relationship
 *   (`"dependencies"`, `"devDependencies"`, `"peerDependencies"`, or `"optionalDependencies"`).
 * - `constraint` — the version constraint string (e.g., `"workspace:*"`, `"^1.0.0"`).
 *
 * @example Creating a WorkspaceDependency
 * ```typescript
 * import { WorkspaceDependency } from "workspaces-effect";
 *
 * const dep = new WorkspaceDependency({
 *   from: "@my-org/app",
 *   to: "@my-org/utils",
 *   depType: "dependencies",
 *   constraint: "workspace:*",
 * });
 * ```
 *
 * @public
 */
export class WorkspaceDependency extends Schema.Class<WorkspaceDependency>("WorkspaceDependency")({
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	depType: DepType,
	constraint: Schema.String,
}) {}

/**
 * Extension data specific to pnpm lockfiles.
 *
 * @remarks
 * Captures pnpm-specific lockfile features that do not have equivalents in
 * other package managers. Attached to {@link LockfileData} via the
 * `pmSpecific` field when the package manager is pnpm.
 *
 * Fields:
 * - `_tag` — discriminant literal `"pnpm"`.
 * - `catalogs` — pnpm catalog definitions (named groups of version constraints).
 * - `overrides` — version override map from `pnpm.overrides` in package.json.
 * - `settings` — pnpm-specific settings recorded in the lockfile header.
 *
 * @example Accessing pnpm-specific data
 * ```typescript
 * import { Effect } from "effect";
 * import { LockfileReader, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const data = yield* reader.readLockfile();
 *   if (data.pmSpecific?._tag === "pnpm") {
 *     console.log("Catalogs:", data.pmSpecific.catalogs);
 *   }
 * });
 * ```
 *
 * @public
 */
export class PnpmExtension extends Schema.Class<PnpmExtension>("PnpmExtension")({
	_tag: Schema.Literal("pnpm"),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({ key: Schema.String, value: Schema.String }),
		}),
	),
	overrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	settings: Schema.optional(
		Schema.Struct({
			autoInstallPeers: Schema.optional(Schema.Boolean),
			excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
		}),
	),
}) {}

/**
 * Extension data specific to bun lockfiles.
 *
 * @remarks
 * Captures bun-specific lockfile features that do not have equivalents in
 * other package managers. Attached to {@link LockfileData} via the
 * `pmSpecific` field when the package manager is bun. Bun lockfiles use
 * JSONC format (JSON with comments).
 *
 * Fields:
 * - `_tag` — discriminant literal `"bun"`.
 * - `catalog` — the default (unnamed) catalog.
 * - `catalogs` — named catalog definitions.
 * - `overrides` — version override map.
 * - `trustedDependencies` — list of packages allowed to run install scripts.
 *
 * @example Accessing bun-specific data
 * ```typescript
 * import { Effect } from "effect";
 * import { LockfileReader, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const data = yield* reader.readLockfile();
 *   if (data.pmSpecific?._tag === "bun") {
 *     console.log("Trusted deps:", data.pmSpecific.trustedDependencies);
 *   }
 * });
 * ```
 *
 * @public
 */
export class BunExtension extends Schema.Class<BunExtension>("BunExtension")({
	_tag: Schema.Literal("bun"),
	catalog: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
		}),
	),
	overrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * Normalized lockfile data common to all package managers.
 *
 * @remarks
 * The primary output of {@link LockfileReader}. Provides a unified view of
 * lockfile contents regardless of the underlying package manager format.
 * Package-manager-specific extensions are available via the `pmSpecific`
 * discriminated union field.
 *
 * Fields:
 * - `packageManager` — which package manager produced the lockfile.
 * - `lockfileVersion` — the lockfile format version string.
 * - `packages` — all resolved packages as {@link ResolvedPackage} instances.
 * - `workspaceDependencies` — inter-workspace edges as {@link WorkspaceDependency} instances.
 * - `pmSpecific` — optional package-manager-specific data ({@link PnpmExtension} or {@link BunExtension}).
 *
 * @example Reading lockfile data
 * ```typescript
 * import { Effect } from "effect";
 * import { LockfileReader, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const data = yield* reader.readLockfile();
 *   console.log(`${data.packages.length} packages resolved by ${data.packageManager}`);
 * });
 * ```
 *
 * @public
 */
export class LockfileData extends Schema.Class<LockfileData>("LockfileData")({
	packageManager: PackageManager,
	lockfileVersion: Schema.String,
	packages: Schema.Array(ResolvedPackage),
	workspaceDependencies: Schema.Array(WorkspaceDependency),
	pmSpecific: Schema.optional(Schema.Union(PnpmExtension, BunExtension)),
}) {}

/**
 * Result of lockfile integrity validation.
 *
 * @remarks
 * Produced by {@link LockfileReader} when comparing lockfile contents against
 * the workspace's declared dependencies. Unlike {@link LockfileIntegrityError},
 * this is a data type (not an error) — it reports *what* mismatches exist
 * without failing the pipeline.
 *
 * Fields:
 * - `valid` — `true` if the lockfile is fully consistent with workspace declarations.
 * - `missingWorkspaces` — workspace package names present in the workspace but absent from the lockfile.
 * - `extraWorkspaces` — entries in the lockfile that do not correspond to any workspace package.
 * - `unsatisfiedConstraints` — dependency constraints declared in workspace packages
 *   that the lockfile's resolved versions do not satisfy.
 *
 * @example Checking integrity
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileIntegrity } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const integrity = yield* reader.checkIntegrity();
 *   if (!integrity.valid) {
 *     console.log("Missing:", integrity.missingWorkspaces);
 *     console.log("Extra:", integrity.extraWorkspaces);
 *   }
 * });
 * ```
 *
 * @public
 */
export class LockfileIntegrity extends Schema.Class<LockfileIntegrity>("LockfileIntegrity")({
	valid: Schema.Boolean,
	missingWorkspaces: Schema.Array(Schema.String),
	extraWorkspaces: Schema.Array(Schema.String),
	unsatisfiedConstraints: Schema.Array(
		Schema.Struct({
			workspace: Schema.String,
			dependency: Schema.String,
			constraint: Schema.String,
			resolved: Schema.String,
			depType: DepType,
		}),
	),
}) {}
