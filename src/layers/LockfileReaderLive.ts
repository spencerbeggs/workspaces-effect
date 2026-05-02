/**
 * Live implementation of the {@link LockfileReader} service.
 *
 * Reads and parses lockfiles for all four supported package managers
 * (pnpm, npm, yarn Berry, bun) into a unified {@link LockfileData} model.
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Exit, Layer, Option, Request, RequestResolver } from "effect";
import { LockfileReadError } from "../errors/LockfileReadError.js";
import type { PackageManagerType } from "../schemas/core.js";
import { LockfileData, ResolvedPackage, WorkspaceDependency } from "../schemas/lockfile.js";
import type { LockfileInitError } from "../services/LockfileReader.js";
import { LockfileReader } from "../services/LockfileReader.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { checkLockfileIntegrity } from "./integrity.js";
import { parseBunLockfile } from "./parsers/bun.js";
import { parseNpmLockfile } from "./parsers/npm.js";
import { parsePnpmLockfile } from "./parsers/pnpm.js";
import { parseYarnLockfile } from "./parsers/yarn.js";

/**
 * Map a package manager type to its lockfile filename.
 *
 * @internal
 */
const lockfileNameFor = (pm: PackageManagerType): string => {
	switch (pm) {
		case "pnpm":
			return "pnpm-lock.yaml";
		case "npm":
			return "package-lock.json";
		case "yarn":
			return "yarn.lock";
		case "bun":
			return "bun.lock";
	}
};

/**
 * Dispatch lockfile content to the appropriate format-specific parser.
 *
 * @internal
 */
const parseLockfile = (content: string, lockfilePath: string, pm: PackageManagerType) => {
	switch (pm) {
		case "pnpm":
			return parsePnpmLockfile(content, lockfilePath);
		case "npm":
			return parseNpmLockfile(content, lockfilePath);
		case "yarn":
			return parseYarnLockfile(content, lockfilePath);
		case "bun":
			return parseBunLockfile(content, lockfilePath);
	}
};

/** @internal Snapshot of parsed lockfile state held in the layer's cache. */
interface LockfileState {
	readonly root: string;
	readonly lockfileData: LockfileData;
	readonly packageIndex: ReadonlyMap<string, ReadonlyArray<ResolvedPackage>>;
}

/** @internal Request for resolvedVersion lookups. */
class ResolvedVersionRequest extends Request.TaggedClass("ResolvedVersionRequest")<
	Option.Option<ResolvedPackage>,
	LockfileInitError,
	{ readonly packageName: string }
> {}

/**
 * Convenience type alias for the {@link LockfileReaderLive} layer signature.
 *
 * Useful for consumers who want to annotate layer types explicitly. Layer
 * construction is now O(1); read and parse errors surface from service
 * methods on first use.
 *
 * @public
 */
export type LockfileReaderLiveLayer = Layer.Layer<
	LockfileReader,
	never,
	WorkspaceRoot | PackageManagerDetector | FileSystem.FileSystem | Path.Path
>;

/**
 * Live layer for the {@link LockfileReader} service.
 *
 * Provides a unified view of the workspace lockfile (npm, pnpm, yarn Berry,
 * or bun) with cached version lookups, workspace dependency extraction, and
 * integrity checking.
 *
 * @remarks
 * Requires {@link WorkspaceRoot}, {@link PackageManagerDetector}, `FileSystem`,
 * and `Path` from `@effect/platform`. Layer construction allocates the service
 * record but performs no I/O. The first invocation of any method resolves the
 * workspace root, detects the package manager, and reads/parses the lockfile;
 * subsequent calls reuse the cached result for the lifetime of the layer
 * (success or failure are both memoized via `Effect.cached`).
 *
 * @privateRemarks
 * Wraps the eager initialization (root find, PM detect, lockfile read,
 * format-specific parse, pnpm name resolution, multi-version index) in
 * `Effect.cached` so the cost is paid once per service instance rather than
 * once per layer construction. Format-specific parsers live in `./parsers/`.
 * Uses an Effect `Request.Cache` for deduplicating `resolvedVersion` lookups
 * (same pattern as `DependencyGraphLive`). Integrity checking delegates to
 * {@link checkLockfileIntegrity}.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { LockfileReader, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const data = yield* reader.readLockfile();
 *   return data.packages.length;
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export const LockfileReaderLive: LockfileReaderLiveLayer = Layer.effect(
	LockfileReader,
	Effect.gen(function* () {
		const rootService = yield* WorkspaceRoot;
		const detector = yield* PackageManagerDetector;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		// Memoize the heavy I/O on first read so layer construction stays O(1).
		// `Effect.cached` caches both success and failure for the lifetime of the
		// returned effect; consumers that build the layer but never invoke a
		// method pay nothing.
		const initLockfile: Effect.Effect<LockfileState, LockfileInitError> = yield* Effect.cached(
			Effect.gen(function* () {
				const root = yield* rootService.find(process.cwd());
				const { type: pm } = yield* detector.detect(root);

				const lockfilePath = path.join(root, lockfileNameFor(pm));

				const content = yield* fs.readFileString(lockfilePath).pipe(
					Effect.mapError(
						() =>
							new LockfileReadError({
								lockfilePath,
								reason: "file not found or unreadable",
							}),
					),
				);

				let lockfileData = yield* parseLockfile(content, lockfilePath, pm);

				// For pnpm, resolve importer paths to actual package names from package.json
				if (pm === "pnpm") {
					const pathToName = new Map<string, string>();
					for (const pkg of lockfileData.packages) {
						if (pkg.isWorkspace && pkg.relativePath) {
							const pkgJsonPath = path.join(root, pkg.relativePath, "package.json");
							const exit = yield* Effect.exit(
								fs
									.readFileString(pkgJsonPath)
									.pipe(Effect.flatMap((content) => Effect.try(() => JSON.parse(content) as { name?: string }))),
							);
							if (Exit.isSuccess(exit) && exit.value.name) {
								pathToName.set(pkg.relativePath, exit.value.name);
							}
						}
					}

					if (pathToName.size > 0) {
						// Rebuild packages with resolved names
						const resolvedPackages = lockfileData.packages.map((pkg) => {
							if (!pkg.isWorkspace || !pkg.relativePath) return pkg;
							const realName = pathToName.get(pkg.relativePath);
							if (!realName) return pkg;
							return new ResolvedPackage({
								name: realName,
								version: pkg.version,
								integrity: pkg.integrity,
								isWorkspace: pkg.isWorkspace,
								relativePath: pkg.relativePath,
								dependencies: pkg.dependencies,
							});
						});

						// Rebuild workspace dependencies with resolved names
						const resolvedWsDeps = lockfileData.workspaceDependencies.map((dep) => {
							const fromName = pathToName.get(dep.from) ?? dep.from;
							const toName = pathToName.get(dep.to) ?? dep.to;
							return new WorkspaceDependency({
								from: fromName,
								to: toName,
								depType: dep.depType,
								constraint: dep.constraint,
							});
						});

						lockfileData = new LockfileData({
							packageManager: lockfileData.packageManager,
							lockfileVersion: lockfileData.lockfileVersion,
							packages: resolvedPackages,
							workspaceDependencies: resolvedWsDeps,
							pmSpecific: lockfileData.pmSpecific,
						});
					}
				}

				// Build multi-version lookup index
				const packageIndex = new Map<string, Array<ResolvedPackage>>();
				for (const pkg of lockfileData.packages) {
					const existing = packageIndex.get(pkg.name) ?? [];
					existing.push(pkg);
					packageIndex.set(pkg.name, existing);
				}

				yield* Effect.logDebug("Lockfile reader initialized").pipe(
					Effect.annotateLogs({
						"workspace.pm": pm,
						"workspace.packages.count": lockfileData.packages.length,
					}),
				);

				return { root, lockfileData, packageIndex } satisfies LockfileState;
			}).pipe(Effect.withSpan("LockfileReader.init")),
		);

		// Per-layer cache for request deduplication (same pattern as DependencyGraphLive).
		const cache = yield* Request.makeCache({ capacity: 1024, timeToLive: "1 minute" });

		const ResolvedVersionResolver = RequestResolver.fromEffect((req: ResolvedVersionRequest) =>
			initLockfile.pipe(Effect.map(({ packageIndex }) => Option.fromNullable(packageIndex.get(req.packageName)?.[0]))),
		);

		return {
			readLockfile: () => initLockfile.pipe(Effect.map(({ lockfileData }) => lockfileData)),

			resolvedVersion: (packageName: string) =>
				Effect.request(new ResolvedVersionRequest({ packageName }), ResolvedVersionResolver).pipe(
					Effect.withRequestCache(cache),
					Effect.withRequestCaching(true),
					Effect.tap((result) =>
						Effect.logDebug("Resolved version lookup").pipe(
							Effect.annotateLogs({
								"workspace.package": packageName,
								"workspace.found": Option.isSome(result),
							}),
						),
					),
					Effect.withSpan("LockfileReader.resolvedVersion", {
						attributes: { "workspace.package": packageName },
					}),
				),

			workspaceDependencies: () =>
				initLockfile.pipe(Effect.map(({ lockfileData }) => lockfileData.workspaceDependencies)),

			checkIntegrity: () =>
				Effect.gen(function* () {
					const { root, lockfileData } = yield* initLockfile;
					const result = yield* checkLockfileIntegrity(lockfileData, root, fs, path);
					yield* Effect.logDebug("Lockfile integrity check complete").pipe(
						Effect.annotateLogs({
							"workspace.integrity.valid": result.valid,
							"workspace.integrity.issues":
								result.missingWorkspaces.length + result.extraWorkspaces.length + result.unsatisfiedConstraints.length,
						}),
					);
					return result;
				}).pipe(Effect.withSpan("LockfileReader.checkIntegrity")),
		};
	}).pipe(Effect.withSpan("LockfileReader.construct")),
);
