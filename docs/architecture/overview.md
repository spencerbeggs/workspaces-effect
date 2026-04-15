# Architecture Overview

workspaces-effect provides 9 composable Effect services organized into four
groups. Each service is an Effect `Context.Tag` with a live layer
implementation. All service methods have `R = never` -- dependencies are
resolved at layer construction time, so consuming code never needs to provide
transitive services manually.

## Table of Contents

- [Service Groups](#service-groups)
- [Layer Composition](#layer-composition)
- [Platform Independence](#platform-independence)
- [Synchronous Utilities](#synchronous-utilities)
- [Error Model](#error-model)

## Service Groups

### Group 1: Discovery

Find and identify the monorepo workspace.

| Service | Purpose |
| --- | --- |
| `WorkspaceRoot` | Find the monorepo root by walking up from `cwd` |
| `PackageManagerDetector` | Detect the package manager and runtime in use (npm, pnpm, yarn, bun) |
| `WorkspaceDiscovery` | List all workspace packages by resolving glob patterns (standalone fallback if no config) |

### Group 2: Package Analysis

Analyze relationships between workspace packages.

| Service | Purpose |
| --- | --- |
| `DependencyGraph` | Build a directed graph of inter-package dependencies |
| `TopologicalSorter` | Sort packages for correct build ordering with parallel levels |

### Group 3: Change Detection

Detect what changed and which packages are affected.

| Service | Purpose |
| --- | --- |
| `PackageResolver` | Map file paths to their owning workspace package |
| `ChangeDetector` | Git-based change detection with transitive impact analysis |

### Group 4: Configuration and Lockfiles

Read lockfile data and analyze publishability.

| Service | Purpose |
| --- | --- |
| `LockfileReader` | Parse lockfile metadata across all four formats |
| `PublishabilityDetector` | Detect which packages are publishable and where |

## Layer Composition

Two composite layers cover most use cases. You rarely need to wire individual
service layers manually.

### WorkspacesLive

Provides 7 services -- everything except `PackageResolver` and
`ChangeDetector`. Requires `FileSystem` and `Path` from `@effect/platform`.

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
  // Use any service here, including ChangeDetector and PackageResolver
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

**Additional services over WorkspacesLive:** PackageResolver, ChangeDetector.

### Individual Layers

Each service exports its own live layer (e.g., `WorkspaceRootLive`,
`DependencyGraphLive`) for fine-grained composition when you only need a
subset. Individual layers declare their dependencies explicitly -- for example,
`DependencyGraphLive` depends on `WorkspaceDiscoveryLive`, which in turn
depends on `WorkspaceRootLive`. You wire them with `Layer.provide`:

```typescript
import { Layer } from "effect";
import {
  WorkspaceRootLive,
  WorkspaceDiscoveryLive,
  DependencyGraphLive,
} from "workspaces-effect";

const customLayer = DependencyGraphLive.pipe(
  Layer.provide(WorkspaceDiscoveryLive),
  Layer.provide(WorkspaceRootLive),
);
```

## Platform Independence

The library depends on `@effect/platform` abstractions instead of Node.js APIs
directly:

| Platform Service | Usage |
| --- | --- |
| `FileSystem` | Read package.json, workspace configs, lockfiles |
| `Path` | Cross-platform path operations |
| `Command` / `CommandExecutor` | Git operations for change detection |

This means the same code works on Node.js and Bun by swapping the platform
layer:

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node";
program.pipe(Effect.provide(NodeContext.layer));

// Bun
import { BunContext } from "@effect/platform-bun";
program.pipe(Effect.provide(BunContext.layer));
```

`NodeContext.layer` and `BunContext.layer` both provide `FileSystem`, `Path`,
and `CommandExecutor`, so either works with both `WorkspacesLive` and
`WorkspacesFullLive`.

## Synchronous Utilities

For non-Effect contexts that cannot use services and layers (e.g., lint-staged
handlers, configuration files, build tool hooks), two synchronous functions are
exported directly:

- `findWorkspaceRootSync(cwd?)` -- finds the workspace root by walking up from
  `cwd` (defaults to `process.cwd()`). Returns `string | null`.
- `getWorkspacePackagesSync(root)` -- lists workspace packages as
  `ReadonlyArray<{ name: string; path: string }> | null`.

These use `node:fs` and `node:path` directly instead of `@effect/platform`
abstractions, so they are Node.js-only. They provide no caching, observability,
or typed errors -- return `null` on failure. See the
[Getting Started](../guides/getting-started.md#synchronous-utilities) guide for
usage examples.

## Error Model

All errors extend `Data.TaggedError`, enabling pattern matching with
`Effect.catchTag`. Each error has a descriptive `message` getter and typed
fields for programmatic access.

| Error | Service | When Raised |
| --- | --- | --- |
| `WorkspaceRootNotFoundError` | WorkspaceRoot | No workspace root found from search path |
| `PackageManagerDetectionError` | PackageManagerDetector | Cannot determine package manager type |
| `WorkspaceDiscoveryError` | WorkspaceDiscovery | Package discovery fails |
| `PackageJsonParseError` | WorkspaceDiscovery | Malformed or unreadable package.json |
| `PackageNotFoundError` | WorkspaceDiscovery, DependencyGraph | Named package not in workspace |
| `CyclicDependencyError` | TopologicalSorter, ChangeDetector | Cycle detected in dependency graph |
| `DependencyResolutionError` | DependencyGraph | Dependency cannot be resolved |
| `GitNotAvailableError` | ChangeDetector | Git not installed or not a git repo |
| `ChangeDetectionError` | ChangeDetector | Git operation fails |
| `LockfileReadError` | LockfileReader | Lockfile cannot be read from disk |
| `LockfileParseError` | LockfileReader | Lockfile content cannot be parsed |
| `LockfileIntegrityError` | LockfileReader | Integrity check cannot complete |

Errors are caught with `Effect.catchTag` using the error's `_tag` string:

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

For a complete list of error fields and solutions, see
[Troubleshooting](../troubleshooting.md).
