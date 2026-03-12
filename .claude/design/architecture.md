---
title: "Module Architecture Design"
module: core
status: draft
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - architecture
  - effect
  - workspaces
---

## Module Architecture Design

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Design Goals](#design-goals)
- [Service Architecture](#service-architecture)
- [Error Hierarchy](#error-hierarchy)
- [Schema Definitions](#schema-definitions)
- [Layer Composition](#layer-composition)
- [Platform Abstraction](#platform-abstraction)
- [Package Manager Support](#package-manager-support)
- [Rationale](#rationale)
- [Open Questions](#open-questions)

<!-- /TOC -->

## Overview

`@spencerbeggs/workspaces-effect` is an Effect-TS library for monorepo workspace
tooling. It provides composable services for workspace discovery, dependency graph
analysis, package resolution, and change detection across npm, pnpm, yarn Berry,
and Bun workspaces.

Inspired by Microsoft's
[workspace-tools](https://github.com/microsoft/workspace-tools), this library
replaces imperative APIs with Effect services, typed errors, schemas, and platform
abstractions. Users compose only the services they need and provide platform layers
(Node.js or Bun) at the edge.

## Current State

The project is in the design phase. The monorepo scaffold exists with build
tooling (Rslib, Turbo, Vitest, Biome) configured. No packages or source code
beyond placeholder stubs exist yet. The design docs system is initialized.

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
6. **Dual API** -- Effect programs as primary API, with thin Promise wrappers
   for non-Effect consumers
7. **Observability** -- Effect.withSpan on key operations for tracing integration

## Service Architecture

The library is organized into four service groups:

### Group 1: Discovery

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `WorkspaceRoot` | Find monorepo root from cwd | FileSystem, Path |
| `PackageManagerDetector` | Detect PM type and version | FileSystem, Path |
| `WorkspaceDiscovery` | List workspace packages | FileSystem, Path, WorkspaceRoot |

### Group 2: Package Analysis

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `PackageJsonReader` | Parse and validate package.json | FileSystem, Path |
| `DependencyGraph` | Build directed graph of inter-package deps | WorkspaceDiscovery, PackageJsonReader |
| `TopologicalSorter` | Topological sort for build ordering | DependencyGraph |

### Group 3: Resolution

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `GlobResolver` | Resolve workspace glob patterns to paths | FileSystem, Path |
| `PackageResolver` | Resolve package name to workspace path | WorkspaceDiscovery |
| `ChangeDetector` | Detect changed packages (git-based) | WorkspaceDiscovery, Command |

### Group 4: Configuration

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `WorkspaceConfigReader` | Read PM-specific workspace config | FileSystem, Path |
| `LockfileReader` | Parse lockfile metadata | FileSystem, Path |

### Service Interface Pattern

Following the `Context.Tag` class pattern (consistent with Effect docs):

```typescript
class WorkspaceDiscovery extends Context.Tag("WorkspaceDiscovery")<
  WorkspaceDiscovery,
  {
    readonly listPackages: () => Effect.Effect<
      ReadonlyArray<WorkspacePackage>,
      WorkspaceDiscoveryError
    >
    readonly getPackage: (name: string) => Effect.Effect<
      WorkspacePackage,
      PackageNotFoundError
    >
    readonly getRoot: () => Effect.Effect<
      WorkspaceRoot,
      WorkspaceRootNotFoundError
    >
  }
>() {}
```

**Tag pattern decision (resolved 2026-03-12)**: `Context.GenericTag` is
deprecated. The class-based `Context.Tag` pattern works correctly with
our Rslib + api-extractor DTS bundling pipeline. The `_base` constants
are inlined as `declare const` in the bundled `.d.ts` (not exported),
which is the expected behavior. "Forgotten exports" warnings from
api-extractor are cosmetic and do not affect the output.

## Error Hierarchy

All errors use `Data.TaggedError` with descriptive fields:

### Discovery Errors

```typescript
class WorkspaceRootNotFoundError extends Data.TaggedError(
  "WorkspaceRootNotFoundError"
)<{
  readonly searchPath: string
  readonly reason: string
}> {}

class PackageManagerDetectionError extends Data.TaggedError(
  "PackageManagerDetectionError"
)<{
  readonly searchPath: string
  readonly reason: string
}> {}

class WorkspaceDiscoveryError extends Data.TaggedError(
  "WorkspaceDiscoveryError"
)<{
  readonly root: string
  readonly reason: string
}> {}
```

### Package Errors

```typescript
class PackageJsonParseError extends Data.TaggedError(
  "PackageJsonParseError"
)<{
  readonly filePath: string
  readonly cause: unknown
}> {}

class PackageNotFoundError extends Data.TaggedError(
  "PackageNotFoundError"
)<{
  readonly name: string
  readonly available: ReadonlyArray<string>
}> {}
```

### Graph Errors

```typescript
class CyclicDependencyError extends Data.TaggedError(
  "CyclicDependencyError"
)<{
  readonly cycle: ReadonlyArray<string>
}> {}

class DependencyResolutionError extends Data.TaggedError(
  "DependencyResolutionError"
)<{
  readonly packageName: string
  readonly dependency: string
  readonly reason: string
}> {}
```

### Change Detection Errors

```typescript
class GitNotAvailableError extends Data.TaggedError(
  "GitNotAvailableError"
)<{
  readonly reason: string
}> {}

class ChangeDetectionError extends Data.TaggedError(
  "ChangeDetectionError"
)<{
  readonly operation: string
  readonly reason: string
}> {}
```

### Error Pattern Notes

Following the pattern from sibling repos:

- Export `*Base` constants for api-extractor DTS bundling
- Use computed `message` getters for human-readable output
- Include enough context for actionable error reporting

## Schema Definitions

### Core Types

```typescript
const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun")
type PackageManager = Schema.Schema.Type<typeof PackageManager>

const PackageName = Schema.NonEmptyString.pipe(Schema.brand("PackageName"))
type PackageName = Schema.Schema.Type<typeof PackageName>

const WorkspacePath = Schema.String.pipe(Schema.brand("WorkspacePath"))
type WorkspacePath = Schema.Schema.Type<typeof WorkspacePath>
```

### Package.json Schema

```typescript
const WorkspaceField = Schema.Union(
  Schema.Array(Schema.String),
  Schema.Struct({ packages: Schema.Array(Schema.String) })
)

const PackageJsonSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  workspaces: Schema.optional(WorkspaceField),
  dependencies: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  devDependencies: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  peerDependencies: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  packageManager: Schema.optional(Schema.String),
})
```

### Workspace Package

```typescript
class WorkspacePackage extends Schema.Class<WorkspacePackage>(
  "WorkspacePackage"
)({
  name: PackageName,
  version: Schema.String,
  path: WorkspacePath,
  relativePath: Schema.String,
  private: Schema.optional(Schema.Boolean),
  dependencies: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  devDependencies: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
}) {}
```

### Workspace Info

```typescript
class WorkspaceInfo extends Schema.Class<WorkspaceInfo>("WorkspaceInfo")({
  root: WorkspacePath,
  packageManager: PackageManager,
  packageManagerVersion: Schema.optional(Schema.String),
  patterns: Schema.Array(Schema.String),
  packages: Schema.Array(WorkspacePackage),
}) {}
```

## Layer Composition

### Live Layers (Platform-dependent)

```typescript
// Core layers
const WorkspaceRootLive: Layer.Layer<
  WorkspaceRoot, never, FileSystem | Path
>

const PackageManagerDetectorLive: Layer.Layer<
  PackageManagerDetector, never, FileSystem | Path
>

const WorkspaceDiscoveryLive: Layer.Layer<
  WorkspaceDiscovery, never, FileSystem | Path | WorkspaceRoot
>

// Composite layer providing all discovery services
const DiscoveryLive: Layer.Layer<
  WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery,
  never,
  FileSystem | Path
>

// Full library layer
const WorkspacesLive: Layer.Layer<
  WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery |
  PackageJsonReader | DependencyGraph | TopologicalSorter |
  GlobResolver | PackageResolver | ChangeDetector,
  never,
  FileSystem | Path | Command
>
```

### Platform Entry Points

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node"

const program = myWorkspaceEffect.pipe(
  Effect.provide(WorkspacesLive),
  Effect.provide(NodeContext.layer)
)

// Bun
import { BunContext } from "@effect/platform-bun"

const program = myWorkspaceEffect.pipe(
  Effect.provide(WorkspacesLive),
  Effect.provide(BunContext.layer)
)
```

### Test Layers

Every service gets a corresponding test layer:

```typescript
const WorkspaceDiscoveryTest = (
  packages: ReadonlyArray<WorkspacePackage>
): Layer.Layer<WorkspaceDiscovery> =>
  Layer.succeed(WorkspaceDiscovery, {
    listPackages: () => Effect.succeed(packages),
    getPackage: (name) => {
      const found = packages.find((p) => p.name === name)
      return found
        ? Effect.succeed(found)
        : Effect.fail(new PackageNotFoundError({
            name,
            available: packages.map((p) => p.name)
          }))
    },
    getRoot: () => Effect.succeed({ path: "/mock/root" }),
  })
```

## Platform Abstraction

The library depends on these `@effect/platform` services:

| Service | Usage |
| ------- | ----- |
| `FileSystem` | Read package.json, workspace configs, lockfiles |
| `Path` | Cross-platform path joining, resolution |
| `Command` | Git operations for change detection |

No direct `node:fs`, `node:path`, or `node:child_process` imports. This enables:

- Unit testing via `FileSystem.layerNoop()`
- Bun compatibility via `@effect/platform-bun`
- Future WASM/browser compatibility

## Package Manager Support

### Detection Strategy

Detection order (first match wins):

1. **pnpm** -- `pnpm-workspace.yaml` exists
2. **bun** -- `bun.lock` or `bun.lockb` exists AND `packageManager` starts
   with `bun@`
3. **yarn** -- `yarn.lock` exists AND `packageManager` starts with `yarn@`
4. **npm** -- fallback if `package.json` has `workspaces` field

### Workspace Config Parsing

| PM | Config Source | Patterns |
| -- | ------------ | -------- |
| pnpm | `pnpm-workspace.yaml` | `packages: ["pkgs/*"]` |
| npm | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| yarn | `package.json` | `workspaces: ["packages/*"]` or `workspaces.packages` |
| bun | `package.json` | `workspaces: ["packages/*"]` |

### Glob Resolution

Workspace patterns like `packages/*` are resolved to actual directories using
platform FileSystem. The `GlobResolver` service handles:

- Simple wildcards: `packages/*`
- Nested wildcards: `packages/**`
- Negation: `!packages/internal-*`
- Multiple patterns with merge/exclude

## Rationale

### Why Effect-TS?

- **Typed errors** eliminate "package.json not found" runtime surprises
- **Services + layers** enable dependency injection without frameworks
- **Platform abstraction** via `@effect/platform` provides cross-runtime support
- **Schema** provides runtime validation of external data (package.json, configs)
- **Observability** via spans enables tracing in CI/CD pipelines

### Why not wrap workspace-tools?

Microsoft's workspace-tools is a solid library but:

- Uses imperative APIs with thrown exceptions
- No typed error handling
- No platform abstraction (Node.js only)
- No service composition
- Limited observability

Building on Effect from the ground up provides a better foundation for the
Effect ecosystem while maintaining feature parity.

### Why separate services instead of one WorkspaceManager?

Composability. A CI action that only needs package listing shouldn't pull in
git change detection. Users compose the services they need:

```typescript
// Just discovery
Effect.provide(DiscoveryLive)

// Discovery + change detection
Effect.provide(Layer.merge(DiscoveryLive, ChangeDetectorLive))
```

## Open Questions

1. **Context.Tag vs Context.GenericTag**: RESOLVED. `GenericTag` is deprecated.
   Class-based `Context.Tag` works with Rslib DTS bundling. The `_base`
   symbols appear as "forgotten exports" warnings but are correctly inlined
   in the bundled `.d.ts`. Verified on 2026-03-12.

2. **Glob implementation**: Should we use `@effect/platform`'s glob support
   (if available) or implement our own glob resolver using FileSystem?
   Research the latest `@effect/platform` FileSystem API for glob support.

3. **Lockfile parsing depth**: How deep should lockfile reading go? Options:
   a. Metadata only (exists, PM version, integrity)
   b. Dependency resolution tree
   c. Full parse with integrity hashes

4. **Change detection scope**: Should `ChangeDetector` only detect changed
   files, or should it also determine "affected" packages (packages that
   depend on changed packages)?

5. **Dual API priority**: Should the Promise wrapper API be in the main
   package or a separate `/node` entry point (following type-registry-effect
   pattern)?

6. **pnpm catalogs**: Should we support reading pnpm catalog definitions
   from `pnpm-workspace.yaml`? This would add value for pnpm-heavy monorepos.

7. **Bun workspace quirks**: Bun's workspace implementation has some
   differences from npm/yarn. Research and document edge cases.

8. **Bun lockfile parsing**: RESEARCHED. `bun.lock` is JSONC format since
   Bun v1.2. Schema documented in `.claude/design/bun-lockfile.md`.
   Decision: support only text `bun.lock` (not binary `bun.lockb`).
   The `workspaces` map provides workspace discovery; the `packages` map
   (variable-length tuples) is needed for full dependency resolution.

9. **Lockfile abstraction**: Should we provide a unified `LockfileReader`
   interface that abstracts over all PM lockfile formats? Or PM-specific
   readers? A unified interface enables PM-agnostic analysis but may lose
   PM-specific details (e.g., pnpm catalogs, Bun catalogs).
