/**
 * DependencyGraph service — builds a directed graph of inter-workspace dependencies.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageNotFoundError } from "../errors/PackageNotFoundError.js";

/**
 * Service for querying the inter-workspace dependency graph.
 *
 * The graph contains only edges between workspace packages — external npm
 * dependencies are excluded. Edges are derived from `dependencies`,
 * `devDependencies`, and `peerDependencies` in each workspace `package.json`.
 *
 * @remarks
 * DependencyGraph is the first service in the Package Analysis group. It provides
 * the structural data that TopologicalSorter uses for build ordering and that
 * ChangeDetector uses for transitive impact analysis.
 *
 * The graph is eagerly constructed at layer creation time from the workspace
 * package list provided by WorkspaceDiscovery. This means all queries are fast
 * lookups with no additional filesystem or process I/O.
 *
 * The live layer (`DependencyGraphLive`) depends on `WorkspaceDiscovery` (and
 * transitively on `WorkspaceRoot`). Use `WorkspacesLive` or `WorkspacesFullLive`
 * to get all wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/DependencyGraph`. The adjacency map is built
 * eagerly via `Layer.effect`, so all service methods have `R = never` and perform
 * pure in-memory lookups.
 *
 * @example Querying dependencies of a package
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { DependencyGraph, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   const deps = yield* graph.dependenciesOf("@myorg/ui");
 *   console.log("Dependencies:", deps);
 *
 *   const dependents = yield* graph.dependentsOf("@myorg/core");
 *   console.log("Packages that depend on core:", dependents);
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
export class DependencyGraph extends Context.Tag("@spencerbeggs/workspaces-effect/DependencyGraph")<
	DependencyGraph,
	{
		/**
		 * Get direct dependencies of a package (packages it depends on).
		 *
		 * @param name - The workspace package name.
		 * @returns An Effect that succeeds with a readonly array of dependency package
		 *   names, or fails with {@link PackageNotFoundError} if `name` is not in the
		 *   workspace.
		 */
		readonly dependenciesOf: (name: string) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

		/**
		 * Get direct dependents of a package (packages that depend on it).
		 *
		 * @param name - The workspace package name.
		 * @returns An Effect that succeeds with a readonly array of dependent package
		 *   names, or fails with {@link PackageNotFoundError} if `name` is not in the
		 *   workspace.
		 */
		readonly dependentsOf: (name: string) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

		/**
		 * Get all package names in the graph.
		 *
		 * @returns An Effect that succeeds with a readonly array of all workspace
		 *   package names. Never fails.
		 */
		readonly packages: () => Effect.Effect<ReadonlyArray<string>>;

		/**
		 * Check if the graph contains any cycles.
		 *
		 * @returns An Effect that succeeds with `true` if a cycle exists, `false`
		 *   otherwise. Never fails.
		 */
		readonly hasCycle: () => Effect.Effect<boolean>;

		/**
		 * Get the full adjacency map (package name to its dependency names).
		 *
		 * @returns An Effect that succeeds with a `ReadonlyMap` where each key is a
		 *   package name and each value is the set of packages it depends on. Never fails.
		 */
		readonly adjacencyMap: () => Effect.Effect<ReadonlyMap<string, ReadonlySet<string>>>;
	}
>() {}
