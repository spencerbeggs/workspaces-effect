# Dependency analysis

workspaces-effect builds a directed graph of the dependencies between your workspace packages. Query it directly, or hand it to the topological sorter for a build order — sequential or grouped into levels that run in parallel.

## Table of contents

- [Building the dependency graph](#building-the-dependency-graph)
- [Querying dependencies](#querying-dependencies)
- [Topological sorting](#topological-sorting)
- [Parallel build levels](#parallel-build-levels)
- [Subset sorting](#subset-sorting)
- [Cycle detection](#cycle-detection)
- [Error handling](#error-handling)

## Building the dependency graph

The `DependencyGraph` service reads every workspace `package.json` and builds the graph from what it finds. External npm dependencies are skipped.

Edges come from `dependencies`, `devDependencies` and `peerDependencies`. If package A lists package B in any of those maps and package B is itself a workspace package, the graph holds an edge from A to B.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { DependencyGraph, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  const allPackages = yield* graph.packages();
  console.log("Workspace packages:", allPackages);
  // example output (varies by repo): Workspace packages: ["@myorg/utils", "@myorg/core"]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

The graph is built eagerly when the layer initializes, so every query after that is an in-memory lookup with no filesystem or process I/O.

## Querying dependencies

### Direct dependencies

List the workspace packages a given package depends on:

```typescript
const deps = yield* graph.dependenciesOf("@myorg/ui");
// example output (varies): ["@myorg/core", "@myorg/utils"]
```

### Reverse dependencies

List the packages that depend on a given package:

```typescript
const dependents = yield* graph.dependentsOf("@myorg/core");
// example output (varies): ["@myorg/ui", "@myorg/api"]
```

### Full adjacency map

Read the entire graph as a map:

```typescript
const adjacency = yield* graph.adjacencyMap();
for (const [pkg, deps] of adjacency) {
  console.log(`${pkg} depends on: ${[...deps].join(", ")}`);
  // example output (varies): "@myorg/ui depends on: @myorg/core, @myorg/utils"
}
```

`dependenciesOf` and `dependentsOf` fail with `PackageNotFoundError` if the name is not in the workspace. `adjacencyMap` never fails.

## Topological sorting

`TopologicalSorter` runs Kahn's algorithm over the dependency graph. Leaf packages (those with no workspace dependencies) appear first in the result, followed by everything that depends on them.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { TopologicalSorter, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const sorter = yield* TopologicalSorter;
  const order = yield* sorter.sort();
  console.log("Build order:", order);
  // example output (varies): ["@myorg/utils", "@myorg/core", "@myorg/ui", "@myorg/app"]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Parallel build levels

`levels()` groups packages by execution level. Packages in the same level have no dependency on each other, so they can run concurrently.

```typescript
const levels = yield* sorter.levels();
for (const [i, level] of levels.entries()) {
  console.log(`Level ${i} (parallel):`, level);
}
// example output (varies):
// Level 0: ["@myorg/utils"]
// Level 1: ["@myorg/core"]
// Level 2: ["@myorg/ui", "@myorg/api"]
// Level 3: ["@myorg/app"]
```

Use this in CI to run as much in parallel as the dependency graph allows. Level 0 starts immediately. Each subsequent level waits for the previous one to finish.

## Subset sorting

Sort a specific package along with everything it transitively depends on. Use this to build a single package without rebuilding the rest of the workspace.

```typescript
const subset = yield* sorter.sortSubset(["@myorg/ui"]);
// Returns @myorg/ui plus everything it transitively depends on, in order
// example output (varies): ["@myorg/utils", "@myorg/core", "@myorg/ui"]
```

You name the targets; `sortSubset` computes the transitive closure.

## Cycle detection

Call `hasCycle()` to check for cycles before sorting:

```typescript
const hasCycle = yield* graph.hasCycle();
if (hasCycle) {
  console.log("Warning: workspace has cyclic dependencies");
}
```

Sorting a graph that contains a cycle fails with `CyclicDependencyError`. The error carries the set of package names involved in or blocked by the cycle.

```typescript
const order = yield* sorter.sort().pipe(
  Effect.catchTag("CyclicDependencyError", (e) =>
    Effect.logError(`Cycle detected: ${e.cycle.join(" -> ")}`),
  ),
);
```

## Error handling

| Error | Method | Cause |
| --- | --- | --- |
| `PackageNotFoundError` | `dependenciesOf`, `dependentsOf`, `sortSubset` | Named package not in workspace |
| `CyclicDependencyError` | `sort`, `sortSubset`, `levels` | Graph contains a cycle |

Catch either error with `Effect.catchTag`. See [Troubleshooting](./09-troubleshooting.md) for fixes.

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
