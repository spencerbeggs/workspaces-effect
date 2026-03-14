# Architecture Overview

workspaces-effect provides 9 composable Effect services organized into four
groups. Each service is an Effect `Context.Tag` with a live layer
implementation. Services have `R = never` on their methods -- all dependencies
are resolved at layer construction time.

## Table of Contents

- [Service Groups](#service-groups)
- [Layer Composition](#layer-composition)
- [Platform Independence](#platform-independence)
- [Error Model](#error-model)

## Service Groups

### Group 1: Discovery

These services find and identify your monorepo workspace.

| Service | Purpose |
| --- | --- |
| `WorkspaceRoot` | Find the monorepo root by walking up from `cwd` |
| `PackageManagerDetector` | Detect which package manager is in use (npm, pnpm, yarn, bun) |
| `WorkspaceDiscovery` | List all workspace packages by resolving glob patterns |

### Group 2: Package Analysis

These services analyze relationships between workspace packages.

| Service | Purpose |
| --- | --- |
| `DependencyGraph` | Build a directed graph of inter-package dependencies |
| `TopologicalSorter` | Sort packages for correct build ordering with parallel levels |

### Group 3: Change Detection

These services detect what changed and which packages are affected.

| Service | Purpose |
| --- | --- |
| `PackageResolver` | Map file paths to their owning workspace package |
| `ChangeDetector` | Git-based change detection with transitive impact analysis |

### Group 4: Configuration and Lockfiles

These services read lockfile data and analyze publishability.

| Service | Purpose |
| --- | --- |
| `LockfileReader` | Parse lockfile metadata across all four formats |
| `PublishabilityDetector` | Detect which packages are publishable and where |

## Layer Composition

Two composite layers cover most use cases, so you do not need to wire
individual services manually.

### WorkspacesLive

Provides all services except git-dependent ones (ChangeDetector and
PackageResolver). Requires `FileSystem` and `Path` from `@effect/platform`.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  // Use any non-git service here
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

**Included services:** WorkspaceRoot, PackageManagerDetector,
WorkspaceDiscovery, DependencyGraph, TopologicalSorter, LockfileReader,
PublishabilityDetector.

### WorkspacesFullLive

Provides all 9 services including git-dependent ones. Additionally requires
`CommandExecutor` from `@effect/platform`.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { WorkspacesFullLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  // Use any service here, including ChangeDetector
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

**Additional services:** PackageResolver, ChangeDetector.

### Individual Layers

Each service also exports its own live layer (e.g., `WorkspaceRootLive`,
`DependencyGraphLive`) for fine-grained composition when you only need a
subset of functionality.

## Platform Independence

The library depends on `@effect/platform` abstractions, not Node.js APIs
directly:

| Platform Service | Usage |
| --- | --- |
| `FileSystem` | Read package.json, workspace configs, lockfiles |
| `Path` | Cross-platform path operations |
| `Command` / `CommandExecutor` | Git operations for change detection |

This means the same code works on both Node.js and Bun by providing the
appropriate platform layer:

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node";
program.pipe(Effect.provide(NodeContext.layer));

// Bun
import { BunContext } from "@effect/platform-bun";
program.pipe(Effect.provide(BunContext.layer));
```

## Error Model

All errors use `Data.TaggedError` for pattern matching with `Effect.catchTag`.
Each error has a descriptive `message` getter and typed fields for programmatic
access.

| Error | When Raised |
| --- | --- |
| `WorkspaceRootNotFoundError` | No workspace root found from search path |
| `PackageManagerDetectionError` | Cannot determine package manager type |
| `WorkspaceDiscoveryError` | Package discovery fails |
| `PackageJsonParseError` | Malformed package.json |
| `PackageNotFoundError` | Named package not in workspace |
| `CyclicDependencyError` | Cycle detected in dependency graph |
| `DependencyResolutionError` | Dependency cannot be resolved |
| `GitNotAvailableError` | Git not installed or not a git repo |
| `ChangeDetectionError` | Git operation fails |
| `LockfileReadError` | Lockfile cannot be read from disk |
| `LockfileParseError` | Lockfile cannot be parsed |
| `LockfileIntegrityError` | Integrity check fails |

```typescript
import { Effect } from "effect";
import { DependencyGraph, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  return yield* graph.dependenciesOf("my-package");
}).pipe(
  Effect.catchTag("PackageNotFoundError", (e) =>
    Effect.succeed(`Package "${e.name}" not found`),
  ),
);
```
