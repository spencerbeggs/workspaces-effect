/**
 * Live implementation of DependencyGraph service.
 *
 * Builds a directed graph of inter-workspace dependencies from the
 * WorkspaceDiscovery package list. Only includes edges between
 * workspace packages (external npm deps are excluded).
 */

import { Effect, Layer } from "effect";
import { PackageNotFoundError } from "../errors/index.js";
import type { WorkspacePackage } from "../schemas/core.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";

/** Internal graph state with forward and reverse edge maps. */
interface GraphState {
	readonly edges: ReadonlyMap<string, ReadonlySet<string>>;
	readonly reverseEdges: ReadonlyMap<string, ReadonlySet<string>>;
	readonly nodes: ReadonlySet<string>;
}

/**
 * Build the dependency graph from workspace packages.
 * Only includes edges where the dependency name matches a workspace package.
 */
const buildGraph = (packages: ReadonlyArray<WorkspacePackage>): GraphState => {
	const packageNames = new Set(packages.map((p) => p.name));
	const edges = new Map<string, Set<string>>();
	const reverseEdges = new Map<string, Set<string>>();

	// Initialize empty edge sets for all packages
	for (const pkg of packages) {
		edges.set(pkg.name, new Set());
		reverseEdges.set(pkg.name, new Set());
	}

	// Build edges from dependencies and devDependencies
	for (const pkg of packages) {
		const allDeps: Record<string, string> = {
			...(pkg.dependencies as Record<string, string>),
			...(pkg.devDependencies as Record<string, string>),
		};

		for (const depName of Object.keys(allDeps)) {
			if (packageNames.has(depName) && depName !== pkg.name) {
				const fwd = edges.get(pkg.name);
				const rev = reverseEdges.get(depName);
				if (fwd) fwd.add(depName);
				if (rev) rev.add(pkg.name);
			}
		}
	}

	return {
		edges: edges as ReadonlyMap<string, ReadonlySet<string>>,
		reverseEdges: reverseEdges as ReadonlyMap<string, ReadonlySet<string>>,
		nodes: packageNames,
	};
};

/**
 * Detect if the graph has any cycles using DFS.
 */
const detectCycle = (graph: GraphState): boolean => {
	const visited = new Set<string>();
	const inStack = new Set<string>();

	const dfs = (node: string): boolean => {
		if (inStack.has(node)) return true;
		if (visited.has(node)) return false;

		visited.add(node);
		inStack.add(node);

		const deps = graph.edges.get(node);
		if (deps) {
			for (const dep of deps) {
				if (dfs(dep)) return true;
			}
		}

		inStack.delete(node);
		return false;
	};

	for (const node of graph.nodes) {
		if (dfs(node)) return true;
	}
	return false;
};

/** Live layer for DependencyGraph. Depends on WorkspaceDiscovery. */
export const DependencyGraphLive = Layer.effect(
	DependencyGraph,
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery.listPackages();
		const graph = buildGraph(packages);

		return {
			dependenciesOf: (name: string) => {
				const deps = graph.edges.get(name);
				if (deps === undefined) {
					return Effect.fail(
						new PackageNotFoundError({
							name,
							available: Array.from(graph.nodes),
						}),
					);
				}
				return Effect.succeed(Array.from(deps).sort());
			},

			dependentsOf: (name: string) => {
				const dependents = graph.reverseEdges.get(name);
				if (dependents === undefined) {
					return Effect.fail(
						new PackageNotFoundError({
							name,
							available: Array.from(graph.nodes),
						}),
					);
				}
				return Effect.succeed(Array.from(dependents).sort());
			},

			packages: () => Effect.succeed(Array.from(graph.nodes).sort()),

			hasCycle: () => Effect.succeed(detectCycle(graph)),

			adjacencyMap: () => Effect.succeed(graph.edges),
		};
	}),
);
