/**
 * TopologicalSorter service — produces build ordering from the dependency graph.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { CyclicDependencyError, PackageNotFoundError } from "../errors/index.js";

/**
 * Service for topological sorting of workspace packages.
 *
 * Uses Kahn's algorithm (BFS-based) for deterministic ordering and natural
 * parallel level detection. Packages with no dependencies appear first in
 * the sorted output.
 *
 * @remarks
 * TopologicalSorter is the second service in the Package Analysis group. It
 * consumes the dependency graph built by DependencyGraph and produces ordered
 * sequences suitable for build pipelines. The {@link levels} method groups
 * packages by execution level, enabling maximum parallelism — packages within
 * the same level can be built concurrently.
 *
 * The live layer (`TopologicalSorterLive`) depends on `DependencyGraph` (and
 * transitively on `WorkspaceDiscovery` and `WorkspaceRoot`). Use `WorkspacesLive`
 * or `WorkspacesFullLive` to get all wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/TopologicalSorter`. Kahn's algorithm is
 * preferred over DFS-based topological sort because it naturally detects cycles
 * (incomplete processing means a cycle exists) and produces level groupings
 * without a separate pass.
 *
 * @example Building packages in topological order
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { TopologicalSorter, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const sorter = yield* TopologicalSorter;
 *   const order = yield* sorter.sort();
 *   console.log("Build order:", order);
 *
 *   const levels = yield* sorter.levels();
 *   for (const [i, level] of levels.entries()) {
 *     console.log(`Level ${i} (can run in parallel):`, level);
 *   }
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export class TopologicalSorter extends Context.Tag("@spencerbeggs/workspaces-effect/TopologicalSorter")<
	TopologicalSorter,
	{
		/**
		 * Sort all packages in topological order (dependencies first).
		 *
		 * @returns An Effect that succeeds with a readonly array of package names in
		 *   dependency order, or fails with {@link CyclicDependencyError} if the graph
		 *   contains a cycle.
		 */
		readonly sort: () => Effect.Effect<ReadonlyArray<string>, CyclicDependencyError>;

		/**
		 * Sort a subset of packages including their transitive dependencies.
		 *
		 * Given a list of target packages, computes the transitive closure of their
		 * dependencies and returns all of them in topological order.
		 *
		 * @param names - The package names to include (their transitive deps are added
		 *   automatically).
		 * @returns An Effect that succeeds with a readonly array of package names in
		 *   dependency order, or fails with {@link CyclicDependencyError} if the
		 *   subgraph contains a cycle, or {@link PackageNotFoundError} if a named
		 *   package does not exist in the workspace.
		 */
		readonly sortSubset: (
			names: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError>;

		/**
		 * Get packages grouped by parallel execution level.
		 *
		 * Level 0 contains packages with no workspace dependencies. Level 1 contains
		 * packages whose dependencies are all in level 0, and so on. Packages within
		 * the same level can be built concurrently.
		 *
		 * @returns An Effect that succeeds with a readonly array of levels, where each
		 *   level is a readonly array of package names, or fails with
		 *   {@link CyclicDependencyError} if the graph contains a cycle.
		 */
		readonly levels: () => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError>;
	}
>() {}
