import { Data } from "effect";

/**
 * Base constant for {@link DependencyResolutionError}.
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
export const DependencyResolutionErrorBase = Data.TaggedError("DependencyResolutionError");

/**
 * Emitted when a dependency cannot be resolved within the workspace.
 *
 * @remarks
 * Raised by {@link DependencyGraph} when a workspace package declares a
 * dependency on another workspace package whose version constraint cannot be
 * satisfied or whose name does not match any known workspace package.
 *
 * Fields:
 * - `packageName` — the package that declares the unresolvable dependency.
 * - `dependency` — the dependency name that could not be resolved.
 * - `reason` — human-readable explanation of the resolution failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { DependencyResolutionError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.resolve();
 * }).pipe(
 *   Effect.catchTag("DependencyResolutionError", (e) =>
 *     Effect.logError(`${e.packageName} -> ${e.dependency}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class DependencyResolutionError extends DependencyResolutionErrorBase<{
	readonly packageName: string;
	readonly dependency: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot resolve "${this.dependency}" from "${this.packageName}": ${this.reason}`;
	}
}
