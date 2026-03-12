---
title: "Research Notes: Sibling Repos & Effect Patterns"
module: core
status: draft
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - research
  - patterns
  - effect
---

## Research Notes: Sibling Repos & Effect Patterns

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Pattern Catalog](#pattern-catalog)
- [Sibling Repo Analysis](#sibling-repo-analysis)
- [Effect Documentation Insights](#effect-documentation-insights)
- [Workspace Detection Patterns](#workspace-detection-patterns)
- [Rationale](#rationale)

<!-- /TOC -->

## Overview

This document captures patterns, best practices, and design decisions from
analyzing 7 sibling repositories and the Effect documentation. These findings
directly inform the architecture of `@spencerbeggs/workspaces-effect`.

## Current State

Research completed on 2026-03-12 across the following sources:

| Source | Type | Effect Usage |
| ------ | ---- | ------------ |
| runtime-resolver | Sibling repo | Heavy (19 services, 27 layers) |
| semver-effect | Sibling repo | Heavy (Data.TaggedClass, dual API) |
| type-registry-effect | Sibling repo | Heavy (3-service architecture) |
| github-action-effects | Sibling repo | Heavy (27 services) |
| pnpm-config-dependency-action | Sibling repo | Moderate (Schema.TaggedError) |
| claude-tools | Sibling repo | None (Bun/Zod) |
| Effect LLM docs | Documentation | Reference |

## Pattern Catalog

### P1: Service Definition with Context.GenericTag

**Used by**: runtime-resolver, semver-effect, type-registry-effect,
github-action-effects

```typescript
export interface MyService {
  readonly method: (arg: A) => Effect.Effect<B, E>
}
export const MyService = Context.GenericTag<MyService>("MyService")
```

**Why GenericTag over class Context.Tag**: `api-extractor` cannot follow
class-based `Context.Tag` patterns through DTS bundling. `GenericTag` produces
resolvable type signatures in `.d.ts` rollup output.

**Decision for workspaces-effect**: Use `GenericTag` pattern until we verify
class `Context.Tag` works with our Rslib build. All sibling repos have
converged on `GenericTag`.

### P2: Data.TaggedError with Base Export

**Used by**: All Effect sibling repos

```typescript
export const MyErrorBase = Data.TaggedError("MyError")
export class MyError extends MyErrorBase<{
  readonly field: string
  readonly reason: string
}> {
  get message(): string {
    return `MyError: ${this.reason} (field: ${this.field})`
  }
}
```

**Why export Base**: `api-extractor` needs the base class exported as
`@internal` for DTS bundling to work. The concrete class references the base.

**Pattern**: Computed `message` getter provides human-readable output without
requiring consumers to format errors themselves.

### P3: Layer.effect for Service Construction

**Used by**: All Effect sibling repos

```typescript
export const MyServiceLive: Layer.Layer<MyService, never, Dep1 | Dep2> =
  Layer.effect(
    MyService,
    Effect.gen(function* () {
      const dep1 = yield* Dep1
      const dep2 = yield* Dep2
      return MyService.of({
        method: (arg) => /* uses dep1, dep2 */
      })
    })
  )
```

**Key principle**: Service interfaces have `R = never` (no requirements).
Dependencies are resolved at Layer construction time, not in the service
interface.

### P4: Paired Live + Test Layers

**Used by**: github-action-effects, type-registry-effect

```typescript
// Live
export const WorkspaceDetectorLive: Layer.Layer<
  WorkspaceDetector, never, FileSystem
> = Layer.effect(...)

// Test
export const WorkspaceDetectorTest = {
  layer: (state: TestState): Layer.Layer<WorkspaceDetector> =>
    Layer.succeed(WorkspaceDetector, makeTestClient(state)),
  empty: (): Layer.Layer<WorkspaceDetector> =>
    Layer.succeed(WorkspaceDetector, makeTestClient(defaultState)),
}
```

**Value**: Tests compose mock layers without touching real filesystem or
network. The `.empty()` factory provides safe defaults.

### P5: Data.TaggedClass for Domain Types

**Used by**: semver-effect (SemVer, Comparator, Range),
type-registry-effect (PackageSpec)

```typescript
class WorkspacePackage extends Data.TaggedClass("WorkspacePackage")<{
  readonly name: string
  readonly version: string
  readonly path: string
}> {
  [Equal.symbol](that: Equal.Equal): boolean { /* semantic equality */ }
  [Hash.symbol](): number { /* structural hash */ }
}
```

**Value**: Automatic structural equality. Custom `Equal`/`Hash` for domain
semantics (e.g., semver ignores build metadata in equality).

### P6: Function.dual for Pipe-friendly APIs

**Used by**: semver-effect

```typescript
export const isInWorkspace: {
  (root: string): (pkg: WorkspacePackage) => boolean
  (pkg: WorkspacePackage, root: string): boolean
} = Fn.dual(2, (pkg: WorkspacePackage, root: string): boolean =>
  pkg.path.startsWith(root)
)
```

**When to use**: Public utility functions that users might want to pipe.
Service methods don't need dual since they're accessed via `yield*`.

### P7: Schema.transformOrFail for Parsing

**Used by**: semver-effect (FromString schema)

```typescript
const PackageJsonFromString: Schema.Schema<PackageJson, string> =
  Schema.transformOrFail(Schema.String, PackageJsonSchema, {
    strict: true,
    decode: (s, _, ast) =>
      Effect.try({
        try: () => JSON.parse(s),
        catch: (e) => new ParseResult.Type(ast, s, String(e))
      }).pipe(Effect.flatMap(Schema.decodeUnknown(PackageJsonSchema))),
    encode: (v) => Effect.succeed(JSON.stringify(v, null, 2)),
  })
```

### P8: Error Accumulation (No Short-Circuit)

**Used by**: github-action-effects (ErrorAccumulator)

```typescript
// Process all packages, collect successes and failures
Effect.forEach(
  packages,
  (pkg) => validatePkg(pkg).pipe(
    Effect.map((v) => ({ _tag: "ok" as const, value: v })),
    Effect.catchAll((e) => Effect.succeed({ _tag: "err" as const, pkg, error: e })),
  ),
  { concurrency: 5 },
).pipe(Effect.map(partitionResults))
```

**When to use**: Workspace operations that should report all failures, not
stop at the first one (e.g., validating all package.json files).

### P9: Graceful Degradation

**Used by**: type-registry-effect, runtime-resolver

```typescript
// Try API, fall back to cached/bundled data
const data = yield* fetchFromApi().pipe(
  Effect.catchTags({
    NetworkError: () => Effect.succeed(bundledDefaults),
    ParseError: () => Effect.succeed(bundledDefaults),
  })
)
```

**Relevance**: Workspace detection should degrade gracefully -- if git is
unavailable, change detection should report the limitation rather than fail.

### P10: Effect.withSpan for Observability

**Used by**: github-action-effects, type-registry-effect

```typescript
const findRoot = (cwd: string) =>
  findRootImpl(cwd).pipe(
    Effect.withSpan("WorkspaceRoot.find", {
      attributes: { "workspace.cwd": cwd }
    })
  )
```

## Sibling Repo Analysis

### runtime-resolver

**Architecture**: 19 services, 27 layers organized by responsibility
(resolvers, caches, fetchers, auth).

**Key takeaway**: Cache strategy pattern -- three implementations per runtime
(Auto, Fresh, Offline). We could apply this for workspace discovery caching
(cached vs fresh scan).

**Testing**: Compose test layers with test data, use `Effect.runPromise` in
vitest tests. Uses `forks` pool for Effect-TS compatibility.

### semver-effect

**Architecture**: ~3,100 lines across 33 files. Recursive descent parser.

**Key takeaway**: `Function.dual` for all public utility functions enables
both `SemVer.gt(a, b)` and `pipe(a, SemVer.gt(b))` styles. Custom
`Equal`/`Hash` on `Data.TaggedClass` for spec-compliant semantics.

**Testing**: `Effect.runSync` and `Effect.runSyncExit` for synchronous
operations. Both data-first and data-last styles tested.

### type-registry-effect

**Architecture**: Three-service pattern (CacheService, PackageFetcher,
TypeResolver) composed via `Layer.mergeAll`.

**Key takeaway**: Platform dependencies (FileSystem, HttpClient) resolved
within layers, not exposed in service interfaces. Promise API in separate
`/node` entry point.

**Patterns adopted**: VirtualPackage class for synthetic data injection.
Concurrent loading with graceful degradation.

### github-action-effects

**Architecture**: 27 services spanning core I/O, GitHub API, build tooling,
observability.

**Key takeaway for workspaces-effect**:

- `WorkspaceDetector` service -- detects pnpm/npm/yarn/bun, lists packages
- `PackageManagerAdapter` -- unified PM interface (install, exec, cache paths)
- `ChangesetAnalyzer` -- changeset file parsing
- Bracket patterns (`acquireUseRelease`) for resource cleanup
- DryRun guard pattern for mutation protection

**Testing**: Paired Live + Test layers with `.empty()` factories.

### pnpm-config-dependency-action

**Architecture**: Single-phase GitHub Action with 8 services for workspace
YAML manipulation.

**Key takeaway**: Direct pnpm-workspace.yaml manipulation (read, sort,
format, write). Config dependency parsing (`version+sha512-hash` format).
Lockfile capture/comparison using `@pnpm/lockfile.fs`.

**Workspace discovery**: Uses `workspace-tools.getPackageInfosAsync()` for
package enumeration.

### claude-tools

**Architecture**: Bun-based plugin monorepo with detection pipeline.

**Key takeaway**: Multi-stage detection pipeline with parallel + sequential
phases. Dependency injection for testing via `DetectionContext` interface
(shell, fs, env).

**Detection pipeline stages**:

1. Project root (find package.json, workspace root)
2. System info (OS, arch, shell)
3. Package manager (from packageManager field)
4. Runtimes (node, bun, deno versions)
5. Tools (Biome, Turbo, shellcheck)
6. Configs (config file detection)
7. Git info
8. Project scripts
9. Workspace packages

**Pattern**: Mock executors enable deterministic testing of detection logic.

## Effect Documentation Insights

### FileSystem.layerNoop for Testing

The Effect docs describe `FileSystem.layerNoop()` which allows providing a
mock filesystem for testing:

```typescript
const mockFs = FileSystem.layerNoop({
  readFileString: (path) => Effect.succeed('{"name": "test"}'),
  exists: (path) => Effect.succeed(true),
  readDirectory: (path) => Effect.succeed(["pkg-a", "pkg-b"]),
})
```

This is the primary testing strategy for workspace discovery services.

### Schema.Config for Validated Configuration

```typescript
const config = Schema.Config("WORKSPACE_ROOT", Schema.String.pipe(
  Schema.minLength(1)
))
```

Useful for configurable workspace root paths or PM overrides.

### ManagedRuntime for Framework Integration

```typescript
const runtime = ManagedRuntime.make(WorkspacesLive.pipe(
  Layer.provide(NodeContext.layer)
))
// Use throughout application lifecycle
await runtime.runPromise(myEffect)
await runtime.dispose()
```

Relevant for CLI tools or long-running processes that use workspace services.

### Stream for Directory Traversal

```typescript
Stream.fromEffect(fs.readDirectory(root)).pipe(
  Stream.flatMap((entries) => Stream.fromIterable(entries)),
  Stream.mapEffect((entry) => fs.stat(path.join(root, entry))),
  Stream.filter((stat) => stat.type === "Directory")
)
```

Potentially useful for recursive workspace package discovery in deeply nested
monorepos.

## Workspace Detection Patterns

### Detection Priority (from sibling repos)

All repos that detect workspaces use this priority order:

1. **pnpm**: Check for `pnpm-workspace.yaml`
2. **bun**: Check for `bun.lock`/`bun.lockb` + `packageManager` field
3. **yarn**: Check for `yarn.lock` + `packageManager` field
4. **npm**: Fallback if `package.json` has `workspaces` field

### Config Sources by PM

| PM | Primary Config | Patterns Field |
| -- | -------------- | -------------- |
| pnpm | `pnpm-workspace.yaml` | `packages` array |
| npm | `package.json` | `workspaces` (array or object) |
| yarn | `package.json` | `workspaces` (array or object) |
| bun | `package.json` | `workspaces` array |

### Package Discovery

Two approaches seen in sibling repos:

1. **workspace-tools**: `getPackageInfosAsync(root)` -- used by
   pnpm-config-dependency-action and claude-tools
2. **Manual glob**: Read patterns, glob filesystem, read each package.json --
   used by github-action-effects WorkspaceDetectorLive

For `workspaces-effect`, we should implement manual glob resolution using
`@effect/platform` FileSystem for platform independence, rather than
depending on `workspace-tools`.

### Root Detection

Walk up from cwd looking for:

1. `pnpm-workspace.yaml` (pnpm monorepo root)
2. `package.json` with `workspaces` field (npm/yarn/bun root)
3. `package.json` without workspaces (single-package root)

The root is the highest ancestor directory containing a workspace marker.

## Rationale

### Pattern Selection Criteria

Patterns were selected based on:

1. **Consistency with sibling repos** -- users of one library should find
   familiar patterns in others
2. **Effect ecosystem conventions** -- follow Effect docs and community norms
3. **Build tooling compatibility** -- api-extractor and Rslib DTS bundling
4. **Testability** -- every pattern must support unit testing without external
   dependencies
5. **Composability** -- users take only what they need
