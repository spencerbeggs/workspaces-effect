---
title: "Module Architecture Design"
module: core
category: architecture
status: current
completeness: 100
created: 2026-03-12
updated: 2026-06-13
last-synced: 2026-06-13
related:
  - phase2-dependency-graph.md
  - phase3-change-detection.md
  - phase4-configuration-lockfiles.md
  - lockfile-reader-service.md
  - lockfile-schemas.md
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

The library exposes ten services across four groups, two composite layers (`WorkspacesLive` without git, `WorkspacesFullLive` with git), and a synchronous escape-hatch API. Observability is wired across every service via `Effect.withSpan` plus structured logging at Debug/Trace level only, so the library is silent under Effect's default logger; consumers opt in with `Logger.withMinimumLogLevel(LogLevel.Debug)`. See the README "Observability" section for subscription examples.

Two layers defer their I/O to first method call: `LockfileReaderLive` and `WorkspaceDiscoveryLive` wrap their initialization (root walk, PM detection, lockfile read/parse, package scan) in `Effect.cached`, keeping layer construction O(1) and paying the cost once per layer instance. The pure in-memory data services (`DependencyGraphLive`, `TopologicalSorterLive`) build their structures eagerly in `Layer.effect`. Lazy init means initialization failures surface from the first method call rather than from `Layer.provide`; see the lazy-init decision below and `effect-patterns-core.md`.

Tests live in a top-level `__test__/` directory following the `@savvy-web/vitest` discovery convention, with shared utilities in `__test__/utils/` and real lockfile fixtures in `__test__/integration/fixtures/`. See `effect-patterns-testing.md`.

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

The library provides 10 services organized into four groups:

### Group 1: Discovery

| Service | Purpose | Dependencies |
| --- | --- | --- |
| `WorkspaceRoot` | Find monorepo root from cwd | FileSystem, Path |
| `PackageManagerDetector` | Detect PM type and version | FileSystem, Path |
| `WorkspaceDiscovery` | List workspace packages, importer map | FileSystem, Path, WorkspaceRoot |

`WorkspaceDiscovery` (see `src/services/WorkspaceDiscovery.ts`) lists packages, resolves a package by name, exposes an importer map keyed by `relativePath`, and refreshes its cache. Two behaviors are load-bearing for consumers:

- `listPackages` includes the **root workspace package** as the first entry (its `relativePath` is `"."`); filter on the `isRootWorkspace` getter when only child packages are wanted.
- Methods accept an optional `cwd`. When provided, the workspace root is resolved fresh from that directory and results are cached per resolved root; when omitted, the root resolved from `process.cwd()` on first call is reused. `refresh()` discards the per-root package cache (forcing the next call to re-read every `package.json`) while preserving the resolved-root memo, for cases where package files mutate mid-process such as running `changeset version` then reading the bumped versions back.

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
| `CatalogResolver` | Assemble a workspace's complete pnpm catalog set and resolve `catalog:`/`workspace:` specifiers | FileSystem, Path, WorkspaceRoot, LockfileReader, WorkspaceDiscovery |

LockfileReader uses Request/RequestResolver internally for `resolvedVersion`
with per-layer caching. See `phase4-configuration-lockfiles.md`.

CatalogResolver assembles the complete catalog set by unioning three sources
(precedence lockfile, then inline `pnpm-workspace.yaml` catalogs, then
config-dependency-injected catalogs), then resolves `catalog:`/`workspace:`
specifiers in a manifest. The novel piece is recovering catalogs injected by
pnpm **config dependencies** (declared under `configDependencies`): pnpm never
persists those to a durable file (they live only in the transient
`.pnpm-workspace-state-v1.json`), so CatalogResolver durably replays each
plugin-named config dependency's installed `pnpmfile` `updateConfig` hook
out-of-band — the same mechanism pnpm uses at install time, but driven from the
installed pnpmfile rather than the state cache. It reuses the pnpm catalog
primitives (`@pnpm/catalogs.{types,config,protocol-parser,resolver}`) for
inline-catalog projection, protocol parsing, and single-spec resolution, and the
workspace graph (`WorkspaceDiscovery`) for `workspace:` resolution. Assembly is
lazy (`Effect.cached`, first-call) and surfaces `CatalogAssemblyError` /
`CatalogResolutionError` as typed, `catchTag`-able failures. Hook replay uses a
hand-rolled light loader (no `@pnpm/config.reader` / `@pnpm/hooks.pnpmfile`
runtime dependency). The implementation lives in `src/layers/CatalogResolverLive.ts`
with helpers under `src/layers/catalog/`.

PublishabilityDetector checks `private` field and `publishConfig.access`.
Users can provide custom layers to override detection strategy.
`PublishConfig` is a `Schema.Class` with fields: `access`, `registry`,
`directory`, `tag`, `linkDirectory`. `PublishTarget` is a separate
`Schema.Class` representing resolved publish target metadata with fields:
`name`, `registry`, `directory`, `access`, `provenance`.

### Service Interface Pattern

Class-based `Context.Tag` pattern (GenericTag deprecated):

```typescript
class LockfileReader extends Context.Tag(
  "@spencerbeggs/workspaces-effect/LockfileReader"
)<
  LockfileReader,
  {
    readonly readLockfile: () => Effect.Effect<LockfileData, LockfileInitError>
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<Option.Option<ResolvedPackage>, LockfileInitError>
    readonly workspaceDependencies: () => Effect.Effect<
      ReadonlyArray<WorkspaceDependency>,
      LockfileInitError
    >
  }
>() {}
```

Key principles:

- Service methods have `R = never` (dependencies resolved at layer construction)
- Tag identifiers use the `@spencerbeggs/workspaces-effect/ServiceName` namespace
- `_base` symbols from Context.Tag are correctly inlined by api-extractor DTS bundling

## WorkspacePackage data model

`WorkspacePackage` is a `Schema.Class` in `src/schemas/core.ts` representing a workspace package with its metadata and dependencies. It carries the four dependency maps, an optional `publishConfig` (the `PublishConfig` `Schema.Class`), and the `path` / `packageJsonPath` / `relativePath` location fields. `packageJsonPath` is a stored field computed at construction in `WorkspaceDiscoveryLive` via `@effect/platform` `Path.join` (not a getter), so separators are platform-correct.

Computed getters (`isRootWorkspace`, `isPublic`, `scope`, `unscopedName`, `allDependencies`) and dependency-query instance methods (`hasDependency`, `dependencyVersion`, `dependencyDiff` and friends) are defined on the class. Each instance method also exists as a standalone `Function.dual()` in `src/utils/workspace-package.ts`, wired as a static method on the class in `src/index.ts` (the `semver-effect` pattern), so callers get instance, data-first and data-last styles:

```typescript
pkg.hasDependency("effect")               // instance
WorkspacePackage.hasDependency(pkg, "x")  // static data-first
pipe(pkg, WorkspacePackage.hasDependency("x")) // static data-last
```

`readPackageJson` is a related standalone effectful utility (not dual) that reads and decodes a package's `package.json`, also wired as a static method. `DependencyDiff` (the result type of `dependencyDiff`) is defined in `src/schemas/core.ts`.

## Error hierarchy

All errors use `Data.TaggedError` with exported `*Base` constants for api-extractor DTS bundling and computed `message` getters. The full set lives under `src/errors/` and is exported from the barrel; group them by where they arise:

- Discovery: `WorkspaceRootNotFoundError`, `PackageManagerDetectionError`, `WorkspaceDiscoveryError`, `PackageJsonParseError`
- Analysis: `PackageNotFoundError`, `CyclicDependencyError`, `DependencyResolutionError`
- Change detection: `GitNotAvailableError`, `ChangeDetectionError`
- Lockfiles and catalogs: `LockfileReadError`, `LockfileParseError`, `LockfileIntegrityError`, `CatalogAssemblyError`, `CatalogResolutionError`

`LockfileInitError` is an exported union (`WorkspaceRootNotFoundError | PackageManagerDetectionError | LockfileReadError | LockfileParseError`) describing the deferred failure modes of the lazily-initialized lockfile/discovery layers; see the lazy-init decision below.

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

No direct `node:fs`, `node:path`, or `node:child_process` imports in the
Effect service layer. The sole exception is `src/sync.ts` which provides
synchronous non-Effect utilities and intentionally uses `node:fs` and
`node:path` (see "Sync API" section below).

## Sync API

`src/sync.ts` provides two synchronous, non-Effect utility functions for
consumers that cannot use Effect pipelines (e.g., lint-staged handlers,
Vitest config files, or simple scripts). Exported from the package barrel
as `findWorkspaceRootSync` and `getWorkspacePackagesSync`.

| Function | Signature | Description |
| --- | --- | --- |
| `findWorkspaceRootSync` | `(cwd?: string) => string \| null` | Walk up from `cwd` looking for `pnpm-workspace.yaml` or `package.json` with `workspaces` field; stop ascent at the first `.git` (project boundary) and return that directory when a `package.json` is alongside, else throw. Returns `null` only when `cwd` is not inside any git project. |
| `getWorkspacePackagesSync` | `(root: string) => ReadonlyArray<{ name: string; path: string }> \| null` | Resolve workspace patterns and return `{ name, path }` for each child package |

### Design Rationale

- **Non-Effect escape hatch**: Effect pipelines require async context and
  layer provision. Some integration points (e.g., lint-staged `--filter`,
  Vitest dynamic project lists) need a synchronous answer with zero setup.
- **Direct `node:` imports**: Uses `node:fs` (`existsSync`, `readFileSync`,
  `readdirSync`) and `node:path` (`dirname`, `join`, `resolve`) directly.
  This is intentional -- the sync API operates outside the Effect runtime and
  cannot use `@effect/platform` FileSystem/Path services.
- **Root package excluded**: Unlike the Effect-based `listPackages()`,
  `getWorkspacePackagesSync` returns only packages matched by workspace
  patterns (no root package). This avoids confusion in lint-staged contexts
  where root package changes are not meaningful.
- **Git project boundary**: `findWorkspaceRootSync` stops the walk at the first `.git` it encounters. If a `package.json` lives alongside `.git` it returns that directory (single-package repo support); if not it throws — a project without a root manifest is an error, not a silent miss. `null` is reserved for "cwd is not inside any git project", which lets downstream consumers stop special-casing single-package repos.
- **Silent error handling**: Parse/read errors are swallowed (returns `null`
  or empty array) rather than thrown. A typo in workspace patterns produces
  an empty result rather than an error, which prevents breaking downstream
  pipelines.
- **pnpm-workspace.yaml parsing**: Implements its own minimal YAML parser
  for the `packages:` field rather than pulling in a YAML dependency,
  keeping the sync codepath dependency-free.

### Differences from Effect API

| Aspect | Effect API (`WorkspaceDiscovery`) | Sync API |
| --- | --- | --- |
| Runtime | Effect pipeline with layers | Plain synchronous Node.js |
| Root package | Included (first entry) | Excluded |
| Error handling | Typed `WorkspaceDiscoveryError` | Returns `null` or `[]` |
| Version field | Requires `name` and `version` | Requires `name` only |
| Platform | `@effect/platform` (Node or Bun) | `node:fs`/`node:path` only |
| Caching | Per-layer memoization | None |

## Package Manager Support

Detection order (first match wins):

1. **pnpm** -- `pnpm-workspace.yaml` exists (runtime: `"node"`)
2. **bun** -- `bun.lock` or `bun.lockb` exists AND `packageManager` starts
   with `bun@` (runtime: `"bun"`)
3. **yarn** -- `yarn.lock` exists AND `packageManager` starts with `yarn@`
   (runtime: `"node"`)
4. **npm** -- fallback if `package.json` has `workspaces` field
   (runtime: `"node"`)

`DetectedPackageManager.runtime` is `"bun"` for bun workspaces and `"node"`
for all other package managers. This enables downstream consumers to select
the correct platform context (NodeContext vs BunContext).

| PM | Config Source | Patterns |
| --- | --- | --- |
| pnpm | `pnpm-workspace.yaml` | `packages: ["pkgs/*"]` |
| npm | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| yarn | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| bun | `package.json` | `workspaces: ["packages/*"]` |

## Key design decisions

- **Context.Tag** over GenericTag (deprecated) and Effect.Service (not used)
- **Eager graph/index construction** in `Layer.effect` for the pure in-memory data services (`DependencyGraphLive`, `TopologicalSorterLive`); **lazy `Effect.cached` initialization** for the I/O-bound layers (`LockfileReaderLive`, `WorkspaceDiscoveryLive`) so layer construction stays O(1) and the heavy work runs once on first method call. See the lazy-init pattern in `effect-patterns-core.md`.
- **Native Map/Set** for internal data structures (better perf for string keys)
- **Request/RequestResolver** with per-layer `Request.makeCache` for `dependenciesOf`, `dependentsOf` and `resolvedVersion`, giving deduplication without a global cache
- **CommandExecutor resolved at layer construction** for R=never service methods
- **`WorkspacesLive` / `WorkspacesFullLive`** as the two composite layers; individual `*Live` layers stay available for fine-grained composition
- **PublishabilityDetector** as a separate composable service, not embedded in LockfileReader
- **Unified LockfileReader** rather than per-PM services or a separate workspace-config reader
- **Workspace patterns handled in `WorkspaceDiscoveryLive`** rather than a separate glob-resolver service
- **Static method wiring** in `src/index.ts` following the `semver-effect` pattern, avoiding circular imports between schema classes and the dual-API functions in `src/utils/`
- **Root package included in `listPackages()`** as the first entry; filter on the `isRootWorkspace` getter when not wanted
- **Sync API as escape hatch** — `src/sync.ts` uses `node:` imports directly, an intentional exception to the platform-abstraction rule because synchronous callers (lint-staged, Vitest config) cannot boot an Effect runtime. The sync API does not participate in caching, observability or typed errors.
