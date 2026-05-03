# Architecture overview

workspaces-effect ships nine Effect services across four groups. Each service is a `Context.Tag` paired with a live layer. Every method has `R = never` because inter-service and platform dependencies get wired up at layer construction — callers never thread transitive services through their own signatures. Two services (`LockfileReader` and `WorkspaceDiscovery`) defer I/O until the first method call, and their init errors show up in each method's E channel rather than at `Effect.provide` time. See [Error model](#error-model).

## Table of contents

- [Service groups](#service-groups)
- [Layer composition](#layer-composition)
- [Platform independence](#platform-independence)
- [Synchronous utilities](#synchronous-utilities)
- [Error model](#error-model)

## Service groups

### Group 1: discovery

Locate the workspace and identify what runs it.

| Service | Purpose |
| --- | --- |
| `WorkspaceRoot` | Find the monorepo root by walking up from `cwd` |
| `PackageManagerDetector` | Detect the package manager and runtime in use (npm, pnpm, yarn, bun) |
| `WorkspaceDiscovery` | List all workspace packages by resolving glob patterns (standalone fallback if no config) |

### Group 2: package analysis

Build the dependency graph between workspace packages and walk it.

| Service | Purpose |
| --- | --- |
| `DependencyGraph` | Build a directed graph of inter-package dependencies |
| `TopologicalSorter` | Sort packages for correct build ordering with parallel levels |

### Group 3: change detection

Map files to packages and figure out what a git diff actually affects.

| Service | Purpose |
| --- | --- |
| `PackageResolver` | Map file paths to their owning workspace package |
| `ChangeDetector` | Git-based change detection with transitive impact analysis |

### Group 4: configuration and lockfiles

Read lockfile metadata and decide which packages can publish where.

| Service | Purpose |
| --- | --- |
| `LockfileReader` | Parse lockfile metadata across all four formats |
| `PublishabilityDetector` | Detect which packages are publishable and where |

## Layer composition

Two composite layers cover the common shapes. Reach for individual service layers only when you want a strict subset.

### WorkspacesLive

Everything except the git-backed services (`PackageResolver`, `ChangeDetector`). Requires `FileSystem` and `Path` from `@effect/platform`.

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

**Included services:** `WorkspaceRoot`, `PackageManagerDetector`, `WorkspaceDiscovery`, `DependencyGraph`, `TopologicalSorter`, `LockfileReader`, `PublishabilityDetector`.

### WorkspacesFullLive

Every service, including the two that shell out to git. Adds `CommandExecutor` to the platform requirements.

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

**Additional services over `WorkspacesLive`:** `PackageResolver`, `ChangeDetector`.

### Individual layers

Each service exports its own live layer (`WorkspaceRootLive`, `DependencyGraphLive`, and so on) so you can build a narrower runtime when one of the composites is overkill. Individual layers declare their dependencies explicitly: `DependencyGraphLive` needs `WorkspaceDiscoveryLive`, which needs `WorkspaceRootLive`. Wire them with `Layer.provide`:

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

## Platform independence

The library never imports from `node:` modules in service code. It depends on `@effect/platform` abstractions instead:

| Platform service | Usage |
| --- | --- |
| `FileSystem` | Read package.json, workspace configs, lockfiles |
| `Path` | Cross-platform path operations |
| `Command` / `CommandExecutor` | Git operations for change detection |

The same program runs on Node.js or Bun; swap the platform layer at the edge:

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node";
program.pipe(Effect.provide(NodeContext.layer));

// Bun
import { BunContext } from "@effect/platform-bun";
program.pipe(Effect.provide(BunContext.layer));
```

Both context layers provide `FileSystem`, `Path` and `CommandExecutor`, so either one satisfies `WorkspacesLive` or `WorkspacesFullLive`.

## Synchronous utilities

Some callers cannot run an Effect — lint-staged handlers and synchronous config files are the usual culprits. Two plain functions are exported for those cases:

- `findWorkspaceRootSync(cwd?)` walks up from `cwd` (default `process.cwd()`) and returns the workspace root or `null`.
- `getWorkspacePackagesSync(root)` returns `ReadonlyArray<{ name: string; path: string }>` or `null`.

These use `node:fs` and `node:path` directly, so they are Node-only and bypass the platform abstraction. There is no caching, no logging, and no typed error channel; failures collapse to `null`. See the [Getting started](./01-getting-started.md#synchronous-utilities) guide for examples.

## Error model

Every error extends `Data.TaggedError`, so `Effect.catchTag` can pattern-match on the `_tag`. Errors carry typed fields you can read in handlers, plus a `message` getter for human output.

| Error | Service | When raised |
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

Catch them by tag:

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

### LockfileInitError union

`LockfileReader` postpones all of its setup work until the first method call: root discovery, package-manager detection, lockfile read, lockfile parse. The four errors that can come out of that lazy init are re-exported as one type alias so you can catch them in one place:

```typescript
import type { LockfileInitError } from "workspaces-effect";

// LockfileInitError =
//   | WorkspaceRootNotFoundError
//   | PackageManagerDetectionError
//   | LockfileReadError
//   | LockfileParseError
```

Every `LockfileReader` method (`readLockfile`, `resolvedVersion`, `workspaceDependencies`, `checkIntegrity`) lists `LockfileInitError` in its E channel; `checkIntegrity` adds `LockfileIntegrityError`. The Layer E channels for `LockfileReaderLive` and `WorkspaceDiscoveryLive` stay `never`, which means you handle init failures at the call site, not around `Effect.provide`. See [Lockfile parsing -> Lazy initialization](./05-lockfile-parsing.md#lazy-initialization).

For error fields and recovery suggestions, see [Troubleshooting](./09-troubleshooting.md).
