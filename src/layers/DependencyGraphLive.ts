/**
 * Live implementation of DependencyGraph service.
 *
 * Builds a directed graph of inter-workspace dependencies from the
 * WorkspaceDiscovery package list. Only includes edges between
 * workspace packages (external npm deps are excluded).
 */

import { Effect, Layer, Request, RequestResolver } from "effect";
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

/** @internal Request for dependenciesOf lookups. */
class DependenciesOfRequest extends Request.TaggedClass("DependenciesOfRequest")<
	ReadonlyArray<string>,
	PackageNotFoundError,
	{ readonly name: string }
> {}

/** @internal Request for dependentsOf lookups. */
class DependentsOfRequest extends Request.TaggedClass("DependentsOfRequest")<
	ReadonlyArray<string>,
	PackageNotFoundError,
	{ readonly name: string }
> {}

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
		const edgeCount = Array.from(graph.edges.values()).reduce((sum, deps) => sum + deps.size, 0);
		yield* Effect.logDebug("Dependency graph constructed").pipe(
			Effect.annotateLogs({
				"workspace.nodes.count": graph.nodes.size,
				"workspace.edges.count": edgeCount,
			}),
		);

		// Create a per-layer cache so that repeated calls within the same layer
		// instance are deduplicated, while test isolation is preserved (each test
		// builds a fresh layer → fresh cache, no cross-test contamination).
		const cache = yield* Request.makeCache({ capacity: 1024, timeToLive: "1 minute" });

		const DependenciesOfResolver = RequestResolver.fromEffect((req: DependenciesOfRequest) => {
			const deps = graph.edges.get(req.name);
			if (deps === undefined) {
				return Effect.fail(
					new PackageNotFoundError({
						name: req.name,
						available: Array.from(graph.nodes),
					}),
				);
			}
			return Effect.succeed(Array.from(deps).sort());
		});

		const DependentsOfResolver = RequestResolver.fromEffect((req: DependentsOfRequest) => {
			const dependents = graph.reverseEdges.get(req.name);
			if (dependents === undefined) {
				return Effect.fail(
					new PackageNotFoundError({
						name: req.name,
						available: Array.from(graph.nodes),
					}),
				);
			}
			return Effect.succeed(Array.from(dependents).sort());
		});

		return {
			dependenciesOf: (name: string) =>
				Effect.request(new DependenciesOfRequest({ name }), DependenciesOfResolver).pipe(
					Effect.withRequestCache(cache),
					Effect.tap(() =>
						Effect.logDebug("Resolved dependencies").pipe(
							Effect.annotateLogs({
								"workspace.package": name,
								"workspace.deps.count": graph.edges.get(name)?.size ?? 0,
							}),
						),
					),
					Effect.withSpan("DependencyGraph.dependenciesOf", {
						attributes: { "workspace.package": name },
					}),
				),

			dependentsOf: (name: string) =>
				Effect.request(new DependentsOfRequest({ name }), DependentsOfResolver).pipe(
					Effect.withRequestCache(cache),
					Effect.tap(() =>
						Effect.logDebug("Resolved dependents").pipe(
							Effect.annotateLogs({
								"workspace.package": name,
								"workspace.deps.count": graph.reverseEdges.get(name)?.size ?? 0,
							}),
						),
					),
					Effect.withSpan("DependencyGraph.dependentsOf", {
						attributes: { "workspace.package": name },
					}),
				),

			packages: () => Effect.succeed(Array.from(graph.nodes).sort()),

			hasCycle: () =>
				Effect.gen(function* () {
					const result = detectCycle(graph);
					yield* Effect.logDebug("Cycle detection complete").pipe(Effect.annotateLogs("workspace.hasCycle", result));
					return result;
				}).pipe(Effect.withSpan("DependencyGraph.hasCycle")),

			adjacencyMap: () => Effect.succeed(graph.edges),
		};
	}).pipe(Effect.withSpan("DependencyGraph.construct")),
);
