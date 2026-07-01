import { Data } from "effect";

/**
 * Base constant for {@link WorkspaceDiscoveryError}.
 *
 * @remarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file. Tagged
 * `@public` because it appears in the `extends` clause of a `@public`
 * subclass; consumers should construct and catch the subclass, not this
 * base directly.
 *
 * @public
 */
export const WorkspaceDiscoveryErrorBase = Data.TaggedError("WorkspaceDiscoveryError");

/**
 * Emitted when workspace package discovery fails.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} when glob expansion of workspace
 * patterns or subsequent package.json reads fail. This can occur if patterns
 * in pnpm-workspace.yaml or the root package.json `workspaces` field resolve
 * to invalid or inaccessible directories.
 *
 * Fields:
 * - `root` — the workspace root path where discovery was attempted.
 * - `reason` — human-readable explanation of what went wrong.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { WorkspaceDiscoveryError } from "workspaces-effect";
 * import { WorkspaceDiscovery, WorkspaceDiscoveryLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   return yield* discovery.discover("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("WorkspaceDiscoveryError", (e) =>
 *     Effect.succeed(`Discovery failed at ${e.root}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceDiscoveryError extends WorkspaceDiscoveryErrorBase<{
	readonly root: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace discovery failed at "${this.root}": ${this.reason}`;
	}
}
