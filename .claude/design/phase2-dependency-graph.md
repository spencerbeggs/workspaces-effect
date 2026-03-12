---
title: "Phase 2: Dependency Graph Design"
module: core
status: current
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - dependency-graph
  - topological-sort
  - phase-2
related:
  - architecture.md
  - phase3-change-detection.md
---

## Phase 2: Dependency Graph Design

<!-- TOC -->

- [Overview](#overview)
- [Design Decisions](#design-decisions)
- [Service Interfaces](#service-interfaces)
- [Graph Data Structure](#graph-data-structure)
- [Topological Sort Algorithm](#topological-sort-algorithm)
- [Error Types](#error-types)
- [Layer Implementations](#layer-implementations)
- [Testing Strategy](#testing-strategy)
- [Open Questions](#open-questions)

<!-- /TOC -->

## Overview

Phase 2 adds dependency graph construction and topological sorting to
support build ordering and affected-package analysis. These services
build on the Phase 1 WorkspaceDiscovery output.

## Design Decisions

### PackageJsonReader — merge into WorkspaceDiscovery

The original architecture planned a separate `PackageJsonReader` service.
However, `WorkspaceDiscoveryLive` already reads and parses package.json
for every workspace package. Adding a separate reader would:

- Duplicate filesystem reads
- Add an unnecessary service boundary
- Complicate the dependency chain

**Decision**: Enrich the existing `WorkspacePackage` schema to include
all fields needed for graph construction. The `DependencyGraph` service
will consume `WorkspaceDiscovery.listPackages()` directly.

If a standalone package.json reading service is needed later (e.g., for
reading package.json files outside workspaces), it can be added then.

### Graph representation — adjacency map

Use a simple adjacency map (`Map<string, Set<string>>`) rather than
Effect's `HashMap` for the internal graph. Reasons:

- Graph is built once and queried many times
- Native Map/Set have better performance for string keys
- No need for structural equality (package names are strings)
- Effect's HashMap shines for complex keys with custom equality

The graph is exposed through service methods, not as a raw data
structure. This hides the implementation choice.

### Inter-workspace dependencies only

The graph only includes edges between workspace packages. External
npm dependencies are not included in the graph. This keeps the graph
focused on what matters for build ordering.

A dependency from `pkg-a` to `pkg-b` is considered inter-workspace
if `pkg-b` is in the workspace package list, regardless of the version
specifier (workspace:*, ^1.0.0, etc.).

### Dependency types to consider

For build ordering, we include:

- `dependencies` — always (runtime deps must be built first)
- `devDependencies` — always (dev deps needed at build time)
- `peerDependencies` — optional flag (peers may or may not need
  building first, depending on the use case)

Default: include `dependencies` and `devDependencies`, exclude
`peerDependencies`.

## Service Interfaces

### DependencyGraph

```typescript
class DependencyGraph extends Context.Tag(
  "@spencerbeggs/workspaces-effect/DependencyGraph"
)<
  DependencyGraph,
  {
    /** Get all direct dependencies of a package (packages it depends on). */
    readonly dependenciesOf: (
      name: string,
    ) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

    /** Get all direct dependents of a package (packages that depend on it). */
    readonly dependentsOf: (
      name: string,
    ) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

    /** Get all packages in the graph. */
    readonly packages: () => Effect.Effect<ReadonlyArray<string>>;

    /** Check if adding an edge would create a cycle. */
    readonly hasCycle: () => Effect.Effect<boolean>;

    /** Get the full graph as an adjacency map (package -> dependencies). */
    readonly adjacencyMap: () => Effect.Effect<
      ReadonlyMap<string, ReadonlySet<string>>
    >;
  }
>() {}
```

### TopologicalSorter

```typescript
class TopologicalSorter extends Context.Tag(
  "@spencerbeggs/workspaces-effect/TopologicalSorter"
)<
  TopologicalSorter,
  {
    /** Sort all packages in topological order (dependencies first). */
    readonly sort: () => Effect.Effect<
      ReadonlyArray<string>,
      CyclicDependencyError
    >;

    /** Sort a subset of packages and their transitive dependencies. */
    readonly sortSubset: (
      names: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyArray<string>,
      CyclicDependencyError | PackageNotFoundError
    >;

    /** Get packages grouped by parallel execution level. */
    readonly levels: () => Effect.Effect<
      ReadonlyArray<ReadonlyArray<string>>,
      CyclicDependencyError
    >;
  }
>() {}
```

## Graph Data Structure

### Internal representation

```typescript
interface GraphState {
  /** Forward edges: package -> set of its dependencies */
  readonly edges: Map<string, Set<string>>;
  /** Reverse edges: package -> set of packages that depend on it */
  readonly reverseEdges: Map<string, Set<string>>;
  /** All package names in the graph */
  readonly nodes: Set<string>;
}
```

### Building the graph

```typescript
const buildGraph = (
  packages: ReadonlyArray<WorkspacePackage>,
  options?: { includePeerDeps?: boolean },
): GraphState => {
  const packageNames = new Set(packages.map((p) => p.name));
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();
  const nodes = new Set<string>();

  for (const pkg of packages) {
    nodes.add(pkg.name);
    edges.set(pkg.name, new Set());
    reverseEdges.set(pkg.name, new Set());
  }

  for (const pkg of packages) {
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...(options?.includePeerDeps ? pkg.peerDependencies : {}),
    };

    for (const depName of Object.keys(allDeps)) {
      if (packageNames.has(depName)) {
        edges.get(pkg.name)!.add(depName);
        reverseEdges.get(depName)!.add(pkg.name);
      }
    }
  }

  return { edges, reverseEdges, nodes };
};
```

## Topological Sort Algorithm

Use **Kahn's algorithm** (BFS-based) because:

1. Naturally produces parallel execution levels
2. Detects cycles (nodes remaining after algorithm = cycle participants)
3. Deterministic ordering (sort candidates alphabetically at each step)

```text
Algorithm:
1. Compute in-degree for each node
2. Add all nodes with in-degree 0 to queue (level 0)
3. For each node in queue:
   a. Add to sorted output
   b. For each outgoing edge (dependency), decrement in-degree
   c. If in-degree becomes 0, add to next level
4. If sorted count < total nodes, cycle exists
5. Cycle = remaining nodes with non-zero in-degree
```

### Parallel levels

The `levels()` method returns packages grouped by execution level:

```text
Level 0: [packages with no inter-workspace deps] — build first
Level 1: [packages depending only on level 0] — build second
Level 2: [packages depending on level 0-1] — build third
...
```

This enables maximal parallelism in build systems.

## Error Types

### New errors for Phase 2

```typescript
class CyclicDependencyError extends Data.TaggedError(
  "CyclicDependencyError"
)<{
  readonly cycle: ReadonlyArray<string>;
}> {
  get message(): string {
    return `Cyclic dependency detected: ${this.cycle.join(" -> ")}`;
  }
}

class DependencyResolutionError extends Data.TaggedError(
  "DependencyResolutionError"
)<{
  readonly packageName: string;
  readonly dependency: string;
  readonly reason: string;
}> {
  get message(): string {
    return `Cannot resolve "${this.dependency}" from "${this.packageName}": ${this.reason}`;
  }
}
```

## Layer Implementations

### DependencyGraphLive

Depends on: `WorkspaceDiscovery`

```typescript
const DependencyGraphLive = Layer.effect(
  DependencyGraph,
  Effect.gen(function* () {
    const discovery = yield* WorkspaceDiscovery;
    const packages = yield* discovery.listPackages().pipe(
      Effect.mapError((e) => /* wrap in appropriate error */),
    );
    const graph = buildGraph(packages);

    return {
      dependenciesOf: (name) => /* lookup in graph.edges */,
      dependentsOf: (name) => /* lookup in graph.reverseEdges */,
      packages: () => Effect.succeed(Array.from(graph.nodes)),
      hasCycle: () => Effect.succeed(detectCycle(graph)),
      adjacencyMap: () => Effect.succeed(graph.edges),
    };
  }),
);
```

Key: The graph is built eagerly when the layer is constructed. This is
appropriate because:

- The workspace list is fixed for a given run
- Graph construction is fast (O(packages * deps))
- All queries benefit from the precomputed reverse edges

### TopologicalSorterLive

Depends on: `DependencyGraph`

```typescript
const TopologicalSorterLive = Layer.effect(
  TopologicalSorter,
  Effect.gen(function* () {
    const graph = yield* DependencyGraph;
    const adjacency = yield* graph.adjacencyMap();

    return {
      sort: () => kahnSort(adjacency),
      sortSubset: (names) => kahnSortSubset(adjacency, names),
      levels: () => kahnLevels(adjacency),
    };
  }),
);
```

## Testing Strategy

### Graph topologies to test

1. **Linear chain**: A -> B -> C (should sort as [C, B, A])
2. **Diamond**: A -> B, A -> C, B -> D, C -> D (levels: [[D], [B,C], [A]])
3. **Isolated nodes**: A, B, C with no edges (all at level 0)
4. **Simple cycle**: A -> B -> A (CyclicDependencyError)
5. **Complex cycle**: A -> B -> C -> A with D -> B (partial cycle)
6. **Single package**: just A (trivial sort)
7. **Real-world-like**: 5-10 packages with realistic dep patterns
8. **Self-dependency**: A -> A (edge case)

### Test approach

All tests use `Layer.succeed(WorkspaceDiscovery, {...})` with mock
data — no filesystem needed for Phase 2 tests.

```typescript
const testDiscovery = (packages: WorkspacePackage[]) =>
  Layer.succeed(WorkspaceDiscovery, {
    listPackages: () => Effect.succeed(packages),
    getPackage: (name) => {
      const found = packages.find((p) => p.name === name);
      return found
        ? Effect.succeed(found)
        : Effect.fail(new PackageNotFoundError({ name, available: [] }));
    },
  });
```

## Resolved Questions

1. **Eager vs lazy graph construction**: Resolved as eager. Graph is built
   at layer construction time. Appropriate for CLI tools where workspace
   list is fixed per run and all queries benefit from precomputed
   forward + reverse edges.

2. **peerDependencies**: Excluded by default. Only `dependencies` and
   `devDependencies` contribute edges. Can be revisited if needed.

3. **Optional dependencies**: Excluded from graph. Optional by definition
   means they should not affect build ordering.

4. **Reverse dependency lookup**: `dependentsOf` works as designed for
   Phase 3 change detection ("what packages are affected by a change
   in X?").

## Open Questions

1. **peerDependencies configurability**: Should there be a
   `DependencyGraphOptions` config to optionally include peerDeps?
   Deferred until a concrete use case arises.

2. **Graph caching across runs**: For watch-mode or daemon scenarios,
   should the graph be incrementally updated rather than rebuilt?
   Not needed for CLI usage; revisit if daemon mode is added.
