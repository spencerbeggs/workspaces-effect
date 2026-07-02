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
 * The error union surfaced by {@link PointInTimeWorkspace} methods.
 *
 * @remarks
 * - {@link GitReadError} — a `git show`/`git ls-tree` invocation failed for a
 *   reason other than "path absent at this ref" (absent paths degrade to
 *   `Option.none`, never an error).
 * - {@link CatalogAssemblyError} — the `pnpm-workspace.yaml` at the ref (or on
 *   disk) is malformed YAML. A malformed *lockfile* never fails; it degrades to
 *   an empty catalog set.
 * - {@link WorkspaceRootNotFoundError} — no `cwd` was passed and the workspace
 *   root could not be located from `process.cwd()`.
 * - {@link WorkspaceDiscoveryError} — `worktree` failed to enumerate the live
 *   packages via `WorkspaceDiscovery`.
 *
 * @public
 */
export type PointInTimeReadError =
	| GitReadError
	| CatalogAssemblyError
	| WorkspaceRootNotFoundError
	| WorkspaceDiscoveryError;

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
		 * @param cwd - Optional starting directory; when omitted the workspace root
		 *   is resolved from `process.cwd()`.
		 * @returns An Effect that succeeds with the {@link WorkspaceStateSnapshot}
		 *   at the ref, or fails with {@link PointInTimeReadError}.
		 */
		readonly at: (ref: string, cwd?: string) => Effect.Effect<WorkspaceStateSnapshot, PointInTimeReadError>;
		/**
		 * Workspace state of the live working tree (staged + unstaged edits).
		 *
		 * Enumerates packages via `WorkspaceDiscovery` and reads catalogs from the
		 * on-disk `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Uncached.
		 *
		 * @param cwd - Optional starting directory; when omitted the workspace root
		 *   is resolved from `process.cwd()`.
		 * @returns An Effect that succeeds with the live {@link WorkspaceStateSnapshot},
		 *   or fails with {@link PointInTimeReadError}.
		 */
		readonly worktree: (cwd?: string) => Effect.Effect<WorkspaceStateSnapshot, PointInTimeReadError>;
	}
>() {}
