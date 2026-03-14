/**
 * Live implementation of the {@link WorkspaceRoot} service.
 *
 * Walks up from a given directory looking for workspace markers:
 * 1. `pnpm-workspace.yaml` (pnpm workspaces)
 * 2. `package.json` with `"workspaces"` field (npm/yarn/bun)
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { WorkspaceRootNotFoundError } from "../errors/index.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";

/**
 * Workspace marker files to look for, in priority order.
 *
 * @internal
 */
const WORKSPACE_MARKERS = ["pnpm-workspace.yaml"] as const;

/**
 * Check if a directory contains a workspace root marker.
 * Returns the directory path if found, or fails with {@link WorkspaceRootNotFoundError}.
 *
 * @internal
 */
const checkForWorkspaceRoot = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	dir: string,
): Effect.Effect<string, WorkspaceRootNotFoundError> =>
	Effect.gen(function* () {
		// Check for pnpm-workspace.yaml first (highest priority)
		for (const marker of WORKSPACE_MARKERS) {
			const markerPath = path.join(dir, marker);
			const exists = yield* fs.exists(markerPath).pipe(Effect.orElseSucceed(() => false));
			if (exists) {
				return dir;
			}
		}

		// Check for package.json with workspaces field
		const pkgJsonPath = path.join(dir, "package.json");
		const pkgExists = yield* fs.exists(pkgJsonPath).pipe(Effect.orElseSucceed(() => false));
		if (pkgExists) {
			const content = yield* fs.readFileString(pkgJsonPath).pipe(Effect.orElseSucceed(() => "{}"));
			const parsed = JSON.parse(content) as Record<string, unknown>;
			if ("workspaces" in parsed && parsed.workspaces != null) {
				return dir;
			}
		}

		return yield* Effect.fail(
			new WorkspaceRootNotFoundError({
				searchPath: dir,
				reason: "no workspace markers found in this directory",
			}),
		);
	});

/**
 * Walk up the directory tree from `startDir` looking for workspace markers.
 *
 * @privateRemarks
 * Resolves `startDir` to an absolute path, then iterates parent directories
 * until a marker is found or the filesystem root is reached.
 *
 * @internal
 */
const findWorkspaceRoot = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	startDir: string,
): Effect.Effect<string, WorkspaceRootNotFoundError> =>
	Effect.gen(function* () {
		let current = path.resolve(startDir);

		// Walk up until we find a workspace root or hit the filesystem root
		for (;;) {
			const result = yield* checkForWorkspaceRoot(fs, path, current).pipe(Effect.option);

			if (result._tag === "Some") {
				yield* Effect.logInfo("Workspace root found").pipe(Effect.annotateLogs("workspace.root", result.value));
				return result.value;
			}

			const parent = path.dirname(current);
			if (parent === current) {
				// We've reached the filesystem root
				return yield* Effect.fail(
					new WorkspaceRootNotFoundError({
						searchPath: startDir,
						reason: "reached filesystem root without finding pnpm-workspace.yaml or package.json with workspaces field",
					}),
				);
			}
			current = parent;
		}
	}).pipe(
		Effect.withSpan("WorkspaceRoot.find", {
			attributes: { "workspace.cwd": startDir },
		}),
	);

/**
 * Live layer for the {@link WorkspaceRoot} service.
 *
 * Provides workspace root discovery by walking up the directory tree
 * looking for workspace markers.
 *
 * @remarks
 * Requires `FileSystem` and `Path` from `@effect/platform`. Provide these
 * via `NodeContext.layer` (Node.js) or `BunContext.layer` (Bun).
 *
 * @privateRemarks
 * Resolves `FileSystem` and `Path` at construction time, then delegates
 * to {@link findWorkspaceRoot} for each `find()` call.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspaceRoot, WorkspaceRootLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   return yield* root.find(process.cwd());
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
export const WorkspaceRootLive: Layer.Layer<WorkspaceRoot, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
	WorkspaceRoot,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		return {
			find: (cwd: string) => findWorkspaceRoot(fs, path, cwd),
		};
	}),
);
