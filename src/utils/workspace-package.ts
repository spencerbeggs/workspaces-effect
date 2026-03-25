/**
 * Standalone dual-API functions for WorkspacePackage.
 *
 * Each function supports both data-first and data-last (pipeable) calling styles
 * via `Function.dual()`.
 *
 * @packageDocumentation
 */

import { FileSystem } from "@effect/platform";
import type { Option } from "effect";
import { Effect, Function as Fn, Schema } from "effect";
import { PackageJsonParseError } from "../errors/PackageJsonParseError.js";
import type { DependencyDiff, WorkspacePackage } from "../schemas/core.js";
import { PackageJsonSchema } from "../schemas/core.js";

/** Check if a package has a production dependency. Dual API. */
export const hasDependency: {
	(name: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasDependency(name));

/** Check if a package has a dev dependency. Dual API. */
export const hasDevDependency: {
	(name: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasDevDependency(name));

/** Check if a package has a peer dependency. Dual API. */
export const hasPeerDependency: {
	(name: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasPeerDependency(name));

/** Check if a package has an optional dependency. Dual API. */
export const hasOptionalDependency: {
	(name: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasOptionalDependency(name));

/** Check if a package depends on a name in any dep type. Dual API. */
export const hasAnyDependencyOn: {
	(name: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasAnyDependencyOn(name));

/** Look up version across all dep types. Dual API. */
export const dependencyVersion: {
	(name: string): (self: WorkspacePackage) => Option.Option<string>;
	(self: WorkspacePackage, name: string): Option.Option<string>;
} = Fn.dual(2, (self: WorkspacePackage, name: string): Option.Option<string> => self.dependencyVersion(name));

/** Check if any dep name matches a glob pattern. Dual API. */
export const matchesDependency: {
	(pattern: string): (self: WorkspacePackage) => boolean;
	(self: WorkspacePackage, pattern: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, pattern: string): boolean => self.matchesDependency(pattern));

/** Compare two WorkspacePackage dependency snapshots. Dual API. */
export const dependencyDiff: {
	(other: WorkspacePackage): (self: WorkspacePackage) => DependencyDiff;
	(self: WorkspacePackage, other: WorkspacePackage): DependencyDiff;
} = Fn.dual(2, (self: WorkspacePackage, other: WorkspacePackage): DependencyDiff => self.dependencyDiff(other));

/**
 * Read and parse a package's package.json from disk.
 *
 * Returns the minimal `PackageJsonType` schema fields. For full raw
 * package.json access, read `pkg.packageJsonPath` directly.
 *
 * Not a dual function — takes a single WorkspacePackage argument.
 * Pipeable via `pipe(pkg, readPackageJson)`.
 */
export const readPackageJson = (
	self: WorkspacePackage,
): Effect.Effect<Schema.Schema.Type<typeof PackageJsonSchema>, PackageJsonParseError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const content = yield* fs
			.readFileString(self.packageJsonPath)
			.pipe(
				Effect.mapError(
					() => new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "failed to read file" }),
				),
			);
		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as Record<string, unknown>,
			catch: () => new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "invalid JSON" }),
		});
		return yield* Schema.decodeUnknown(PackageJsonSchema)(raw).pipe(
			Effect.mapError(
				() => new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "schema decode failed" }),
			),
		);
	});
