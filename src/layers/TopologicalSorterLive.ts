/**
 * Live implementation of the {@link TopologicalSorter} service.
 *
 * Uses Kahn's algorithm (BFS-based) for deterministic topological
 * ordering with natural parallel level detection.
 *
 * @packageDocumentation
 * @internal
 */

import { Effect, Layer } from "effect";
import { CyclicDependencyError, PackageNotFoundError } from "../errors/index.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { TopologicalSorter } from "../services/TopologicalSorter.js";

/**
 * Kahn's algorithm for topological sorting.
 * Returns packages grouped by execution level (level 0 = no inter-workspace deps).
 * Fails with {@link CyclicDependencyError} if a cycle is detected.
 *
 * @internal
 */
const kahnLevels = (
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError> =>
	Effect.gen(function* () {
		// Compute in-degree for each node
		const inDegree = new Map<string, number>();
		for (const node of adjacency.keys()) {
			inDegree.set(node, 0);
		}
		for (const [, deps] of adjacency) {
			for (const dep of deps) {
				inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
			}
		}

		const levels: string[][] = [];
		let remaining = adjacency.size;

		// Find initial level: nodes with in-degree 0 (no dependents... wait, no)
		// In our graph, edges go from package -> its dependencies.
		// In-degree counts how many packages depend on this node.
		// Wait — we need to reverse our thinking:
		//
		// Our adjacency map: pkg -> set of packages it depends on
		// For Kahn's: we need in-degree = number of deps a package has
		// (not the number of packages depending on it)
		//
		// Actually for topological sort where dependencies come first:
		// - "edges" in Kahn's = dependency edges (A depends on B means edge A->B)
		// - in-degree of B = number of packages depending on B
		// - Packages with in-degree 0 = nothing depends on them? No...
		//
		// Let me reconsider. In our adjacency map:
		// A -> {B, C} means A depends on B and C
		// For build order: B and C must be built before A
		//
		// Kahn's algorithm processes nodes with no incoming edges first.
		// "Incoming edge to A" = "something depends on A" = A is in someone's dep set
		// Wait no — in a dependency DAG:
		// - Edge A -> B means "A depends on B" (A needs B built first)
		// - For Kahn's, we want to process B before A
		// - In Kahn's terms: B has no prerequisites, A has B as prerequisite
		// - In-degree of a node = number of its dependencies (things IT needs)
		//
		// So: in-degree(A) = |adjacency.get(A)| = number of deps of A

		// Recompute: in-degree = number of dependencies each package has
		const depCount = new Map<string, number>();
		for (const [node, deps] of adjacency) {
			depCount.set(node, deps.size);
		}

		remaining = adjacency.size;

		// Level 0: packages with no inter-workspace dependencies
		let currentLevel: string[] = [];
		for (const [node, count] of depCount) {
			if (count === 0) {
				currentLevel.push(node);
			}
		}
		currentLevel.sort(); // Deterministic ordering

		while (currentLevel.length > 0) {
			levels.push(currentLevel);
			remaining -= currentLevel.length;

			const nextLevel: string[] = [];

			// For each node processed in this level, decrement dep count
			// of nodes that depend on it
			for (const processed of currentLevel) {
				// Find nodes that have `processed` as a dependency
				for (const [node, deps] of adjacency) {
					if (deps.has(processed)) {
						const newCount = (depCount.get(node) ?? 0) - 1;
						depCount.set(node, newCount);
						if (newCount === 0) {
							nextLevel.push(node);
						}
					}
				}
			}

			nextLevel.sort(); // Deterministic ordering
			currentLevel = nextLevel;
		}

		if (remaining > 0) {
			// Remaining nodes are part of a cycle
			const cycleNodes: string[] = [];
			for (const [node, count] of depCount) {
				if (count > 0) {
					cycleNodes.push(node);
				}
			}
			return yield* Effect.fail(
				new CyclicDependencyError({
					cycle: cycleNodes.sort(),
				}),
			);
		}

		return levels;
	});

/**
 * Flatten levels into a single sorted array.
 *
 * @internal
 */
const kahnSort = (
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Effect.Effect<ReadonlyArray<string>, CyclicDependencyError> =>
	kahnLevels(adjacency).pipe(Effect.map((levels) => levels.flat()));

/**
 * Sort a subset of packages including their transitive dependencies.
 *
 * @privateRemarks
 * Collects the transitive closure of dependencies via BFS, builds a
 * sub-adjacency map, then delegates to {@link kahnSort}.
 *
 * @internal
 */
const kahnSortSubset = (
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
	names: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError> =>
	Effect.gen(function* () {
		// Validate all names exist
		for (const name of names) {
			if (!adjacency.has(name)) {
				return yield* Effect.fail(
					new PackageNotFoundError({
						name,
						available: Array.from(adjacency.keys()),
					}),
				);
			}
		}

		// Collect transitive dependencies via BFS
		const needed = new Set<string>();
		const queue = [...names];
		while (queue.length > 0) {
			const current = queue.pop();
			if (current === undefined) break;
			if (needed.has(current)) continue;
			needed.add(current);
			const deps = adjacency.get(current);
			if (deps) {
				for (const dep of deps) {
					if (!needed.has(dep)) {
						queue.push(dep);
					}
				}
			}
		}

		// Build sub-adjacency map
		const subAdjacency = new Map<string, ReadonlySet<string>>();
		for (const node of needed) {
			const deps = adjacency.get(node);
			if (deps) {
				const filteredDeps = new Set<string>();
				for (const dep of deps) {
					if (needed.has(dep)) {
						filteredDeps.add(dep);
					}
				}
				subAdjacency.set(node, filteredDeps);
			}
		}

		return yield* kahnSort(subAdjacency);
	});

/**
 * Live layer for the {@link TopologicalSorter} service.
 *
 * Provides deterministic topological ordering of workspace packages
 * using Kahn's algorithm with parallel level detection.
 *
 * @remarks
 * Requires {@link DependencyGraph}. The adjacency map is resolved eagerly
 * at construction time. Results are sorted lexicographically within each
 * level for deterministic output.
 *
 * @privateRemarks
 * Retrieves the adjacency map from `DependencyGraph.adjacencyMap()` once
 * at construction, then uses it for all `sort`, `sortSubset`, and `levels`
 * calls.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { TopologicalSorter, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const sorter = yield* TopologicalSorter;
 *   const buildOrder = yield* sorter.sort();
 *   return buildOrder;
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
export const TopologicalSorterLive: Layer.Layer<TopologicalSorter, never, DependencyGraph> = Layer.effect(
	TopologicalSorter,
	Effect.gen(function* () {
		const graph = yield* DependencyGraph;
		const adjacency = yield* graph.adjacencyMap();

		return {
			sort: () =>
				Effect.gen(function* () {
					const result = yield* kahnSort(adjacency);
					yield* Effect.logDebug("Topological sort complete").pipe(
						Effect.annotateLogs("workspace.sorted.count", result.length),
					);
					return result;
				}).pipe(Effect.withSpan("TopologicalSorter.sort")),
			sortSubset: (names: ReadonlyArray<string>) =>
				Effect.gen(function* () {
					const result = yield* kahnSortSubset(adjacency, names);
					yield* Effect.logDebug("Topological sort subset complete").pipe(
						Effect.annotateLogs({
							"workspace.subset.size": names.length,
							"workspace.sorted.count": result.length,
						}),
					);
					return result;
				}).pipe(Effect.withSpan("TopologicalSorter.sortSubset")),
			levels: () =>
				Effect.gen(function* () {
					const result = yield* kahnLevels(adjacency);
					yield* Effect.logDebug("Topological levels computed").pipe(
						Effect.annotateLogs("workspace.levels.count", result.length),
					);
					return result;
				}).pipe(Effect.withSpan("TopologicalSorter.levels")),
		};
	}).pipe(Effect.withSpan("TopologicalSorter.construct")),
);
