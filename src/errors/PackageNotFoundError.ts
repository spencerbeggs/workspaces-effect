import { Data } from "effect";

/**
 * Base constant for {@link PackageNotFoundError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageNotFoundErrorBase = Data.TaggedError("PackageNotFoundError");

/**
 * Emitted when a named package is not found in the workspace.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} or {@link DependencyGraph} when a
 * lookup by package name yields no match. The `available` field lists all
 * known package names to aid debugging typos or missing packages.
 *
 * Fields:
 * - `name` — the package name that was requested but not found.
 * - `available` — all package names currently known in the workspace.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageNotFoundError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.dependenciesOf("@my-org/missing-pkg");
 * }).pipe(
 *   Effect.catchTag("PackageNotFoundError", (e) =>
 *     Effect.logWarning(`"${e.name}" not found. Available: ${e.available.join(", ")}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageNotFoundError extends PackageNotFoundErrorBase<{
	readonly name: string;
	readonly available: ReadonlyArray<string>;
}> {
	get message(): string {
		const count = this.available.length;
		return `Package "${this.name}" not found (${count} package${count === 1 ? "" : "s"} available)`;
	}
}
