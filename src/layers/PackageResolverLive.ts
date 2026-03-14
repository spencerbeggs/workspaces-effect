/**
 * Live implementation of the {@link PackageResolver} service.
 *
 * Builds a sorted path index at layer construction time from
 * {@link WorkspaceDiscovery} output. Resolves file paths to owning packages
 * using longest-prefix matching on absolute paths.
 *
 * @packageDocumentation
 * @internal
 */

import { Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";
import { PackageResolver } from "../services/PackageResolver.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";

/**
 * A path entry with its absolute path and associated package.
 *
 * @internal
 */
interface PathEntry {
	readonly path: string;
	readonly package: WorkspacePackage;
}

/**
 * Build a sorted path index from workspace packages.
 * Sorted by path length descending so longest prefix matches first.
 *
 * @internal
 */
const buildPathIndex = (packages: ReadonlyArray<WorkspacePackage>, sep: string): ReadonlyArray<PathEntry> => {
	const entries: PathEntry[] = packages.map((pkg) => ({
		path: pkg.path.endsWith(sep) ? pkg.path : pkg.path + sep,
		package: pkg,
	}));

	// Sort by path length descending — longest prefix wins
	entries.sort((a, b) => b.path.length - a.path.length);
	return entries;
};

/**
 * Find the owning package for a file path using longest-prefix matching.
 *
 * @internal
 */
const findOwner = (filePath: string, index: ReadonlyArray<PathEntry>): Option.Option<WorkspacePackage> => {
	for (const entry of index) {
		if (filePath.startsWith(entry.path)) {
			return Option.some(entry.package);
		}
	}
	return Option.none();
};

/**
 * Live layer for the {@link PackageResolver} service.
 *
 * Resolves file paths to their owning workspace packages using
 * longest-prefix matching on a pre-built path index.
 *
 * @remarks
 * Requires {@link WorkspaceDiscovery} and `Path` from `@effect/platform`.
 * The path index is built eagerly at layer construction time and sorted by
 * path length descending so that the most specific match wins.
 *
 * @privateRemarks
 * Uses {@link buildPathIndex} to create a sorted array of path entries,
 * then performs linear scans in {@link findOwner} for each resolution.
 * This is efficient for typical monorepo sizes (tens of packages).
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { PackageResolver, WorkspacesFullLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* PackageResolver;
 *   const owner = yield* resolver.resolveFile("/path/to/packages/foo/src/index.ts");
 *   return owner;
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export const PackageResolverLive = Layer.effect(
	PackageResolver,
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const path = yield* Path.Path;

		const packages = yield* discovery.listPackages();
		const pathIndex = buildPathIndex(packages, path.sep);

		return {
			resolveFile: (filePath: string) => Effect.succeed(findOwner(filePath, pathIndex)),

			resolveFiles: (filePaths: ReadonlyArray<string>) =>
				Effect.succeed(
					filePaths.reduce((map, fp) => {
						const owner = findOwner(fp, pathIndex);
						if (Option.isSome(owner)) {
							map.set(owner.value.name, owner.value);
						}
						return map;
					}, new Map<string, WorkspacePackage>()),
				),

			packagePaths: () =>
				Effect.succeed(
					pathIndex.map((entry) => ({
						path: entry.path,
						package: entry.package,
					})),
				),
		};
	}).pipe(Effect.withSpan("PackageResolver.construct")),
);
