/**
 * PointInTimeWorkspace service — workspace state at a git ref or the live
 * working tree.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { CatalogAssemblyError } from "../errors/CatalogAssemblyError.js";
import type { GitReadError } from "../errors/GitReadError.js";
import type { WorkspaceDiscoveryError } from "../errors/WorkspaceDiscoveryError.js";
import type { WorkspaceRootNotFoundError } from "../errors/WorkspaceRootNotFoundError.js";
import type { WorkspaceStateSnapshot } from "../schemas/WorkspaceStateSnapshot.js";

/**
 * The umbrella error union covering both {@link PointInTimeWorkspace}
 * methods: {@link PointInTimeAtError} (raised by `at`) unioned with
 * {@link PointInTimeWorktreeError} (raised by `worktree`).
 *
 * @remarks
 * - {@link GitReadError} — a `git show`/`git ls-tree` invocation failed for a
 *   reason other than "path absent at this ref" (absent paths degrade to
 *   `Option.none`, never an error). `at`-only.
 * - {@link CatalogAssemblyError} — the `pnpm-workspace.yaml` at the ref (or on
 *   disk) is malformed YAML. A malformed *lockfile* never fails; it degrades to
 *   an empty catalog set.
 * - {@link WorkspaceRootNotFoundError} — the workspace root could not be
 *   located walking up from `options.cwd` (or `process.cwd()` when omitted).
 * - {@link WorkspaceDiscoveryError} — `worktree` failed to enumerate the live
 *   packages via `WorkspaceDiscovery`. `worktree`-only.
 *
 * @public
 */
export type PointInTimeReadError = PointInTimeAtError | PointInTimeWorktreeError;

/**
 * Options accepted by both {@link PointInTimeWorkspace} methods.
 *
 * @public
 */
export interface PointInTimeOptions {
	/**
	 * Starting directory for workspace-root resolution. The root is found by
	 * walking UP from here (same semantics as `WorkspaceDiscovery`); when
	 * omitted, resolution starts from `process.cwd()`.
	 */
	readonly cwd?: string;
}

/**
 * Errors `at` can raise. `at` never enumerates the live filesystem, so
 * {@link WorkspaceDiscoveryError} cannot occur.
 *
 * @public
 */
export type PointInTimeAtError = GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError;

/**
 * Errors `worktree` can raise. `worktree` never invokes git, so
 * {@link GitReadError} cannot occur.
 *
 * @public
 */
export type PointInTimeWorktreeError = CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError;

/**
 * Service for reading a monorepo's workspace state at a specific moment: any
 * git ref (via `git show`/`git ls-tree`, without checking the ref out) or the
 * live working tree (via `WorkspaceDiscovery`).
 *
 * @remarks
 * Each snapshot carries that moment's packages plus its assembled pnpm catalog
 * set, so `catalog:`/`workspace:` specifiers resolve against the state as it
 * existed *then* — not against the current working tree. Catalog precedence is
 * lockfile-then-inline (inline `pnpm-workspace.yaml` catalogs win).
 *
 * The live layer ({@link PointInTimeWorkspaceLive}) resolves `WorkspaceRoot`,
 * `WorkspaceDiscovery`, `CommandExecutor`, `FileSystem`, and `Path` at layer
 * construction so both methods have `R = never`. Use `WorkspacesFullLive` to
 * get all wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/PointInTimeWorkspace`.
 *
 * @see {@link PointInTimeWorkspaceLive} for the live implementation.
 *
 * @public
 */
export class PointInTimeWorkspace extends Context.Tag("@spencerbeggs/workspaces-effect/PointInTimeWorkspace")<
	PointInTimeWorkspace,
	{
		/**
		 * Workspace state as of a git ref.
		 *
		 * Reads `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and each package's
		 * `package.json` at `ref` via `git show`/`git ls-tree`; packages absent at
		 * the ref are skipped. Cached per `(resolved root, ref)`.
		 *
		 * @param ref - Any git ref (SHA, branch, tag) resolvable in the repo.
		 * @param options - Optional {@link PointInTimeOptions}; `options.cwd` is a
		 *   starting directory to walk UP from when resolving the workspace root
		 *   (same semantics as `WorkspaceDiscovery`) — when omitted, resolution
		 *   starts from `process.cwd()`.
		 * @returns An Effect that succeeds with the {@link WorkspaceStateSnapshot}
		 *   at the ref, or fails with {@link PointInTimeAtError}.
		 */
		readonly at: (
			ref: string,
			options?: PointInTimeOptions,
		) => Effect.Effect<WorkspaceStateSnapshot, PointInTimeAtError>;
		/**
		 * Workspace state of the live working tree (staged + unstaged edits).
		 *
		 * Enumerates packages via `WorkspaceDiscovery` and reads catalogs from the
		 * on-disk `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Uncached.
		 *
		 * @param options - Optional {@link PointInTimeOptions}; `options.cwd` is a
		 *   starting directory to walk UP from when resolving the workspace root
		 *   (same semantics as `WorkspaceDiscovery`) — when omitted, resolution
		 *   starts from `process.cwd()`.
		 * @returns An Effect that succeeds with the live {@link WorkspaceStateSnapshot},
		 *   or fails with {@link PointInTimeWorktreeError}.
		 */
		readonly worktree: (
			options?: PointInTimeOptions,
		) => Effect.Effect<WorkspaceStateSnapshot, PointInTimeWorktreeError>;
	}
>() {}
