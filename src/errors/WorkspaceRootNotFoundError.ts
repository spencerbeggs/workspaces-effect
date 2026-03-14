import { Data } from "effect";

/**
 * Base constant for {@link WorkspaceRootNotFoundError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const WorkspaceRootNotFoundErrorBase = Data.TaggedError("WorkspaceRootNotFoundError");

/**
 * Emitted when no workspace root can be found from the search path.
 *
 * @remarks
 * Raised by {@link WorkspaceRoot} when directory traversal from the search path
 * to the filesystem root finds no workspace markers (pnpm-workspace.yaml or
 * package.json with workspaces field).
 *
 * Fields:
 * - `searchPath` — the absolute path from which upward traversal started.
 * - `reason` — human-readable explanation of why no root was found.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { WorkspaceRootNotFoundError } from "workspaces-effect";
 * import { WorkspaceRoot, WorkspaceRootLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   return yield* root.find("/some/path");
 * }).pipe(
 *   Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
 *     Effect.succeed(`Fallback: ${e.searchPath}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceRootNotFoundError extends WorkspaceRootNotFoundErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace root not found from "${this.searchPath}": ${this.reason}`;
	}
}
