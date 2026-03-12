/**
 * Live implementation of PackageResolver service.
 *
 * Builds a sorted path index at layer construction time from
 * WorkspaceDiscovery output. Resolves file paths to owning packages
 * using longest-prefix matching on absolute paths.
 */

import { Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";
import { PackageResolver } from "../services/PackageResolver.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";

/** A path entry with its absolute path and associated package. */
interface PathEntry {
	readonly path: string;
	readonly package: WorkspacePackage;
}

/**
 * Build a sorted path index from workspace packages.
 * Sorted by path length descending so longest prefix matches first.
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
 * Live layer for PackageResolver.
 * Depends on WorkspaceDiscovery and Path.
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
							map.set(fp, owner.value);
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
	}),
);
