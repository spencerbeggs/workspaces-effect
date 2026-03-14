/**
 * WorkspaceRoot service — finds the monorepo root directory.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspaceRootNotFoundError } from "../errors/WorkspaceRootNotFoundError.js";

/**
 * Service for finding the workspace root directory.
 *
 * Walks up from a given directory looking for workspace markers
 * (pnpm-workspace.yaml, package.json with workspaces field, bun.lock, yarn.lock).
 *
 * @remarks
 * WorkspaceRoot is the foundation of the Discovery service group. Nearly every
 * other service depends on it transitively, since workspace operations need a
 * known root directory. The implementation uses `@effect/platform` FileSystem
 * to traverse parent directories, so it works on any platform that provides a
 * FileSystem layer (Node, Bun, etc.).
 *
 * The live layer (`WorkspaceRootLive`) requires `FileSystem` and `Path` from
 * `@effect/platform`. For convenience, these are provided by `NodeContext.layer`
 * or `BunContext.layer`.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/WorkspaceRoot`. All dependencies are
 * resolved at layer construction time so that service methods have `R = never`.
 *
 * @example Finding the workspace root
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspaceRoot, WorkspaceRootLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   const rootPath = yield* root.find(process.cwd());
 *   console.log("Workspace root:", rootPath);
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspaceRootLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceRoot extends Context.Tag("@spencerbeggs/workspaces-effect/WorkspaceRoot")<
	WorkspaceRoot,
	{
		/**
		 * Find the workspace root starting from the given directory.
		 *
		 * Traverses up the directory tree from `cwd` looking for workspace markers.
		 * Returns the absolute path to the root directory on success.
		 *
		 * @param cwd - The directory to start searching from (typically `process.cwd()`).
		 * @returns An Effect that succeeds with the absolute root path, or fails with
		 *   {@link WorkspaceRootNotFoundError} if no workspace root is found before
		 *   reaching the filesystem root.
		 */
		readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError>;
	}
>() {}
