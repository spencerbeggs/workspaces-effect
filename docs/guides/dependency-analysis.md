# Dependency Analysis

workspaces-effect builds a directed graph of inter-workspace dependencies and
provides topological sorting for correct build ordering with parallel
execution levels.

## Table of Contents

- [Building the Dependency Graph](#building-the-dependency-graph)
- [Querying Dependencies](#querying-dependencies)
- [Topological Sorting](#topological-sorting)
- [Parallel Build Levels](#parallel-build-levels)
- [Subset Sorting](#subset-sorting)
- [Cycle Detection](#cycle-detection)
- [Error Handling](#error-handling)

## Building the Dependency Graph

The `DependencyGraph` service constructs a directed graph at layer creation
time from all workspace `package.json` files. Only edges between workspace
packages are included -- external npm dependencies are excluded.

Edges are derived from `dependencies`, `devDependencies`, and
`peerDependencies`. If package A lists package B in any of these maps and
package B is a workspace package, the graph contains an edge from A to B.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { DependencyGraph, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  const allPackages = yield* graph.packages();
  console.log("Workspace packages:", allPackages);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

Because the graph is built eagerly at layer construction time, all queries are
fast in-memory lookups with no filesystem or process I/O.

## Querying Dependencies

### Direct Dependencies

Find which workspace packages a given package depends on:

```typescript
const deps = yield* graph.dependenciesOf("@myorg/ui");
// ["@myorg/core", "@myorg/utils"]
```

### Reverse Dependencies

Find which packages depend on a given package (its dependents):

```typescript
const dependents = yield* graph.dependentsOf("@myorg/core");
// ["@myorg/ui", "@myorg/api"]
```

### Full Adjacency Map

Get the entire graph structure as a map:

```typescript
const adjacency = yield* graph.adjacencyMap();
for (const [pkg, deps] of adjacency) {
  console.log(`${pkg} depends on: ${[...deps].join(", ")}`);
}
```

All three methods fail with `PackageNotFoundError` if you pass a name that
does not exist in the workspace (except `adjacencyMap`, which never fails).

## Topological Sorting

The `TopologicalSorter` service uses Kahn's algorithm to sort packages in
dependency order. Packages with no workspace dependencies appear first.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { TopologicalSorter, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const sorter = yield* TopologicalSorter;
  const order = yield* sorter.sort();
  console.log("Build order:", order);
  // ["@myorg/utils", "@myorg/core", "@myorg/ui", "@myorg/app"]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Parallel Build Levels

The `levels()` method groups packages by execution level. All packages within
the same level can be built concurrently because none depend on each other:

```typescript
const levels = yield* sorter.levels();
for (const [i, level] of levels.entries()) {
  console.log(`Level ${i} (parallel):`, level);
}
// Level 0: ["@myorg/utils"]
// Level 1: ["@myorg/core"]
// Level 2: ["@myorg/ui", "@myorg/api"]
// Level 3: ["@myorg/app"]
```

This is useful for CI pipelines where you want maximum parallelism while
respecting dependency constraints. Level 0 can start immediately, level 1
starts after level 0 completes, and so on.

## Subset Sorting

Sort only specific packages plus their transitive dependencies. This is useful
when you want to build just one package and everything it needs:

```typescript
const subset = yield* sorter.sortSubset(["@myorg/ui"]);
// Returns @myorg/ui plus everything it transitively depends on, in order
// e.g., ["@myorg/utils", "@myorg/core", "@myorg/ui"]
```

The `sortSubset` method computes the transitive closure automatically -- you
only need to name the target packages.

## Cycle Detection

The graph exposes a `hasCycle()` check for proactive detection:

```typescript
const hasCycle = yield* graph.hasCycle();
if (hasCycle) {
  console.log("Warning: workspace has cyclic dependencies");
}
```

Attempting to sort a graph with cycles fails with `CyclicDependencyError`,
which includes the set of package names involved in or blocked by the cycle:

```typescript
const order = yield* sorter.sort().pipe(
  Effect.catchTag("CyclicDependencyError", (e) =>
    Effect.logError(`Cycle detected: ${e.cycle.join(" -> ")}`),
  ),
);
```

## Error Handling

| Error | Method | Cause |
| --- | --- | --- |
| `PackageNotFoundError` | `dependenciesOf`, `dependentsOf`, `sortSubset` | Named package not in workspace |
| `CyclicDependencyError` | `sort`, `sortSubset`, `levels` | Graph contains a cycle |

Both errors are caught with `Effect.catchTag`. See
[Troubleshooting](../troubleshooting.md) for detailed solutions.

```typescript
const program = Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  return yield* graph.dependenciesOf("@myorg/missing");
}).pipe(
  Effect.catchTag("PackageNotFoundError", (e) =>
    Effect.logWarning(`"${e.name}" not found. Available: ${e.available.join(", ")}`),
  ),
);
```
