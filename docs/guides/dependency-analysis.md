# Dependency Analysis

workspaces-effect builds a directed graph of inter-workspace dependencies and
provides topological sorting for correct build ordering.

## Table of Contents

- [Building the Dependency Graph](#building-the-dependency-graph)
- [Querying Dependencies](#querying-dependencies)
- [Topological Sorting](#topological-sorting)
- [Parallel Build Levels](#parallel-build-levels)
- [Cycle Detection](#cycle-detection)

## Building the Dependency Graph

The `DependencyGraph` service constructs a directed graph at layer creation
time from all workspace package.json files. Only edges between workspace
packages are included -- external npm dependencies are excluded.

Edges are derived from `dependencies`, `devDependencies`, and
`peerDependencies`.

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

## Querying Dependencies

### Direct Dependencies

Find which workspace packages a given package depends on:

```typescript
const deps = yield* graph.dependenciesOf("@myorg/ui");
// ["@myorg/core", "@myorg/utils"]
```

### Reverse Dependencies

Find which packages depend on a given package:

```typescript
const dependents = yield* graph.dependentsOf("@myorg/core");
// ["@myorg/ui", "@myorg/api"]
```

### Full Adjacency Map

Get the entire graph structure:

```typescript
const adjacency = yield* graph.adjacencyMap();
for (const [pkg, deps] of adjacency) {
  console.log(`${pkg} depends on: ${[...deps].join(", ")}`);
}
```

## Topological Sorting

The `TopologicalSorter` service uses Kahn's algorithm to sort packages in
dependency order. Packages with no dependencies appear first.

```typescript
import { TopologicalSorter, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const sorter = yield* TopologicalSorter;
  const order = yield* sorter.sort();
  console.log("Build order:", order);
  // ["@myorg/utils", "@myorg/core", "@myorg/ui", "@myorg/app"]
});
```

### Sorting a Subset

Sort only specific packages and their transitive dependencies:

```typescript
const subset = yield* sorter.sortSubset(["@myorg/ui"]);
// Returns @myorg/ui plus everything it transitively depends on, in order
```

## Parallel Build Levels

The `levels()` method groups packages by execution level. All packages within
the same level can be built concurrently because none depend on each other.

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
respecting dependency constraints.

## Cycle Detection

The graph exposes a `hasCycle()` check. Attempting to sort a graph with cycles
fails with `CyclicDependencyError`, which includes the cycle path:

```typescript
const hasCycle = yield* graph.hasCycle();

const order = yield* sorter.sort().pipe(
  Effect.catchTag("CyclicDependencyError", (e) =>
    Effect.logError(`Cycle: ${e.cycle.join(" -> ")}`),
  ),
);
```
