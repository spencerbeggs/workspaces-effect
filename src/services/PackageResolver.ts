/**
 * PackageResolver service — maps file paths to their owning workspace packages.
 *
 * @packageDocumentation
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Service for resolving file paths to workspace packages.
 *
 * Uses prefix matching on absolute paths to determine which workspace package
 * owns a given file. The package path index is built from WorkspaceDiscovery
 * output at layer construction time for fast lookups.
 *
 * @remarks
 * PackageResolver is the first service in the Change Detection group. It provides
 * the bridge between raw file paths (e.g., from `git diff`) and workspace package
 * identities. ChangeDetector uses it to map changed files to their owning packages.
 *
 * Path matching is done longest-prefix-first so that nested packages (e.g.,
 * `packages/foo/packages/bar`) are resolved correctly.
 *
 * The live layer (`PackageResolverLive`) depends on `WorkspaceDiscovery` (and
 * transitively on `WorkspaceRoot`). It requires `FileSystem`, `Path`, and
 * `CommandExecutor` from `@effect/platform`. Use `WorkspacesFullLive` to get
 * all wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/PackageResolver`. The path index is built
 * eagerly via `Layer.effect` and sorted by path length (longest first) to ensure
 * correct longest-prefix matching.
 *
 * @example Resolving changed files to packages
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { PackageResolver, WorkspacesFullLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* PackageResolver;
 *   const owner = yield* resolver.resolveFile("/workspace/packages/ui/src/Button.tsx");
 *   console.log("Owner:", owner);
 *
 *   const changedFiles = [
 *     "/workspace/packages/ui/src/Button.tsx",
 *     "/workspace/packages/core/src/index.ts",
 *   ];
 *   const packageMap = yield* resolver.resolveFiles(changedFiles);
 *   console.log("Affected packages:", [...packageMap.keys()]);
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
export class PackageResolver extends Context.Tag("@spencerbeggs/workspaces-effect/PackageResolver")<
	PackageResolver,
	{
		/**
		 * Find which package owns a file path.
		 *
		 * Uses longest-prefix matching against workspace package paths.
		 *
		 * @param filePath - Absolute path to a file.
		 * @returns An Effect that succeeds with `Option.some(package)` if the file is
		 *   inside a workspace package, or `Option.none()` if the file is outside all
		 *   packages (e.g., a root-level config file). Never fails.
		 */
		readonly resolveFile: (filePath: string) => Effect.Effect<Option.Option<WorkspacePackage>>;

		/**
		 * Batch resolve: map multiple file paths to their owning packages (deduped by package).
		 *
		 * @param filePaths - Readonly array of absolute file paths.
		 * @returns An Effect that succeeds with a `ReadonlyMap` keyed by package name,
		 *   with the corresponding {@link WorkspacePackage} as the value. Files outside
		 *   all packages are silently excluded. Never fails.
		 */
		readonly resolveFiles: (filePaths: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, WorkspacePackage>>;

		/**
		 * Get all indexed package paths (sorted by path length, longest first).
		 *
		 * Useful for debugging or inspecting the internal path index.
		 *
		 * @returns An Effect that succeeds with a readonly array of path/package pairs.
		 *   Never fails.
		 */
		readonly packagePaths: () => Effect.Effect<
			ReadonlyArray<{ readonly path: string; readonly package: WorkspacePackage }>
		>;
	}
>() {}
