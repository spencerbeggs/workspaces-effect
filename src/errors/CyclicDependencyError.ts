import { Data } from "effect";

/**
 * Base constant for {@link CyclicDependencyError}.
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
export const CyclicDependencyErrorBase = Data.TaggedError("CyclicDependencyError");

/**
 * Emitted when a cycle is detected in the dependency graph.
 *
 * @remarks
 * Raised by {@link DependencyGraph} during topological sorting or cycle
 * detection. The `cycle` array contains all package names that could not
 * be topologically sorted — i.e., packages that are part of or blocked
 * by a cyclic dependency.
 *
 * Fields:
 * - `cycle` — set of package names involved in or blocked by the cycle.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { CyclicDependencyError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.topologicalSort();
 * }).pipe(
 *   Effect.catchTag("CyclicDependencyError", (e) =>
 *     Effect.logError(`Cycle found: ${e.cycle.join(" -> ")}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class CyclicDependencyError extends CyclicDependencyErrorBase<{
	readonly cycle: ReadonlyArray<string>;
}> {
	get message(): string {
		return `Cyclic dependency detected: ${this.cycle.join(" -> ")}`;
	}
}
