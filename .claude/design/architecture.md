---
title: "Module Architecture Design"
module: core
category: architecture
status: current
completeness: 100
created: 2026-03-12
updated: 2026-03-14
last-synced: 2026-03-14
related:
  - phase2-dependency-graph.md
  - phase3-change-detection.md
  - phase4-configuration-lockfiles.md
  - effect-patterns-core.md
  - effect-patterns-parsing.md
  - effect-patterns-testing.md
  - code-review-findings.md
  - research-notes.md
  - bun-lockfile.md
authors:
  - C. Spencer Beggs
tags:
  - architecture
  - effect
  - workspaces
---

## Module Architecture Design

## Overview

`workspaces-effect` is an Effect-TS library for monorepo workspace tooling.
It provides composable services for workspace discovery, dependency graph
analysis, package resolution, change detection, lockfile reading, and
publishability detection across npm, pnpm, yarn Berry, and Bun workspaces.

Inspired by Microsoft's
[workspace-tools](https://github.com/microsoft/workspace-tools), this library
replaces imperative APIs with Effect services, typed errors, schemas, and
platform abstractions. Users compose only the services they need and provide
platform layers (Node.js or Bun) at the edge.

## Current State

All phases complete. 174 tests passing, all typechecking. Full observability
(spans + structured logging) across all services.

- **Phase 1 (Discovery)**: WorkspaceRootLive, PackageManagerDetectorLive,
  WorkspaceDiscoveryLive
- **Phase 2 (Package Analysis)**: DependencyGraphLive, TopologicalSorterLive
- **Phase 3 (Change Detection)**: PackageResolverLive, ChangeDetectorLive
- **Phase 4 (Configuration & Lockfiles)**: LockfileReaderLive,
  PublishabilityDetectorLive, integrity checker, parsers for pnpm/npm/yarn/bun
- **Composite layers**: WorkspacesLive (no git), WorkspacesFullLive (with git)
- **Internal patterns**: Request/RequestResolver with per-layer caching for
  DependencyGraph and LockfileReader lookups
- **Observability**: Effect.withSpan on all service methods and layer
  construction; structured logging at Info/Debug/Trace levels

## Design Goals

1. **First-class Effect library** -- services, layers, typed errors, schemas,
   observability via spans
2. **Platform-independent core** -- depend on `@effect/platform` abstractions
   (FileSystem, Path, Command), not Node.js APIs directly
3. **Multi-PM support** -- npm, pnpm, yarn Berry, Bun workspaces through a
   unified interface
4. **Composable** -- users take only the services they need; no monolithic
   "workspace manager" class
5. **Testable** -- every service has a test layer; FileSystem.layerNoop enables
   unit testing without disk
6. **Observability** -- Effect.withSpan on key operations for tracing integration

## Service Architecture

The library provides 9 services organized into four groups:

### Group 1: Discovery

| Service | Purpose | Dependencies |
| --- | --- | --- |
| `WorkspaceRoot` | Find monorepo root from cwd | FileSystem, Path |
| `PackageManagerDetector` | Detect PM type and version | FileSystem, Path |
| `WorkspaceDiscovery` | List workspace packages | FileSystem, Path, WorkspaceRoot |

### Group 2: Package Analysis

| Service | Purpose | Dependencies |
| --- | --- | --- |
| `DependencyGraph` | Build directed graph of inter-package deps | WorkspaceDiscovery |
| `TopologicalSorter` | Topological sort for build ordering | DependencyGraph |

DependencyGraph uses Request/RequestResolver internally for `dependenciesOf`
and `dependentsOf` with per-layer caching. See `phase2-dependency-graph.md`.

### Group 3: Change Detection

| Service | Purpose | Dependencies |
| --- | --- | --- |
| `PackageResolver` | Map file paths to owning workspace packages | WorkspaceDiscovery |
| `ChangeDetector` | Git-based change detection + affected computation | PackageResolver, DependencyGraph, CommandExecutor |

### Group 4: Configuration & Lockfiles

| Service | Purpose | Dependencies |
| --- | --- | --- |
| `LockfileReader` | Parse lockfile metadata + PM-specific config | FileSystem, Path, WorkspaceRoot, PackageManagerDetector |
| `PublishabilityDetector` | Detect which workspace packages are publishable | (none -- pure logic) |

LockfileReader uses Request/RequestResolver internally for `resolvedVersion`
with per-layer caching. See `phase4-configuration-lockfiles.md`.

PublishabilityDetector checks `private` field and `publishConfig.access`.
Users can provide custom layers to override detection strategy.

### Service Interface Pattern

Class-based `Context.Tag` pattern (GenericTag deprecated):

```typescript
class LockfileReader extends Context.Tag(
  "workspaces-effect/LockfileReader"
)<
  LockfileReader,
  {
    readonly readLockfile: () => Effect.Effect<LockfileData>
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<Option.Option<ResolvedPackage>>
    readonly workspaceDependencies: () => Effect.Effect<
      ReadonlyArray<WorkspaceDependency>
    >
  }
>() {}
```

Key principles:

- Service methods have `R = never` (dependencies resolved at layer construction)
- Tag identifiers use `workspaces-effect/ServiceName` namespace
- `_base` symbols from Context.Tag are correctly inlined by api-extractor DTS bundling

## Error Hierarchy

11 error types using `Data.TaggedError` with exported `*Base` constants for
api-extractor DTS bundling. All have computed `message` getters.

| Error | Phase | When Raised |
| --- | --- | --- |
| `WorkspaceRootNotFoundError` | Discovery | No workspace root found from search path |
| `PackageManagerDetectionError` | Discovery | Cannot determine PM type |
| `WorkspaceDiscoveryError` | Discovery | Package discovery fails |
| `PackageJsonParseError` | Discovery | Malformed package.json |
| `PackageNotFoundError` | Analysis | Named package not in workspace |
| `CyclicDependencyError` | Analysis | Cycle detected in dependency graph |
| `DependencyResolutionError` | Analysis | Dependency cannot be resolved |
| `GitNotAvailableError` | Change Detection | Git not installed or not a git repo |
| `ChangeDetectionError` | Change Detection | Git operation fails |
| `LockfileReadError` | Lockfiles | Lockfile cannot be read from disk |
| `LockfileParseError` | Lockfiles | Lockfile cannot be parsed |
| `LockfileIntegrityError` | Lockfiles | Integrity check fails |

## Layer Composition

### Composite Layers

Two pre-wired composite layers cover most use cases:

```typescript
// All services except git-dependent ones
// Requires: FileSystem + Path
const WorkspacesLive: Layer.Layer<
  WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery |
  DependencyGraph | TopologicalSorter |
  LockfileReader | PublishabilityDetector,
  never,
  FileSystem | Path
>

// All services including git-dependent ones
// Requires: FileSystem + Path + CommandExecutor
const WorkspacesFullLive: Layer.Layer<
  WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery |
  DependencyGraph | TopologicalSorter |
  LockfileReader | PublishabilityDetector |
  PackageResolver | ChangeDetector,
  never,
  FileSystem | Path | CommandExecutor
>
```

Individual `*Live` layers remain available for fine-grained composition.

### Platform Entry Points

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node"
program.pipe(Effect.provide(WorkspacesLive), Effect.provide(NodeContext.layer))

// Bun
import { BunContext } from "@effect/platform-bun"
program.pipe(Effect.provide(WorkspacesLive), Effect.provide(BunContext.layer))
```

## Platform Abstraction

The library depends on these `@effect/platform` services:

| Service | Usage |
| --- | --- |
| `FileSystem` | Read package.json, workspace configs, lockfiles |
| `Path` | Cross-platform path joining, resolution |
| `Command` | Git operations for change detection |

No direct `node:fs`, `node:path`, or `node:child_process` imports.

## Package Manager Support

Detection order (first match wins):

1. **pnpm** -- `pnpm-workspace.yaml` exists
2. **bun** -- `bun.lock` or `bun.lockb` exists AND `packageManager` starts
   with `bun@`
3. **yarn** -- `yarn.lock` exists AND `packageManager` starts with `yarn@`
4. **npm** -- fallback if `package.json` has `workspaces` field

| PM | Config Source | Patterns |
| --- | --- | --- |
| pnpm | `pnpm-workspace.yaml` | `packages: ["pkgs/*"]` |
| npm | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| yarn | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| bun | `package.json` | `workspaces: ["packages/*"]` |

## Resolved Design Decisions

All major design decisions have been resolved. See phase-specific docs for
details. Key decisions:

- **Context.Tag** over GenericTag (deprecated) and Effect.Service (not used)
- **Eager graph/index construction** in `Layer.effect` for all data services
- **Native Map/Set** for internal data structures (better perf for string keys)
- **Request/RequestResolver** for `dependenciesOf`, `dependentsOf`, `resolvedVersion`
- **Per-layer Request.makeCache** for deduplication without global cache contamination
- **CommandExecutor resolved at layer construction** for R=never service methods
- **WorkspacesLive / WorkspacesFullLive** as composite layers (replaces old
  DiscoveryLive, ConfigurationLive, FullConfigLive, ChangeDetectionLive)
- **PublishabilityDetector** as separate composable service (not embedded in LockfileReader)
- **Unified LockfileReader** (merged WorkspaceConfigReader)
- **GlobResolver** deferred (WorkspaceDiscoveryLive handles workspace patterns)
