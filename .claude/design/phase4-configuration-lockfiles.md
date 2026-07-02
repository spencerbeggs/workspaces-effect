---
title: "Configuration and lockfiles design"
module: core
category: architecture
status: current
completeness: 90
created: 2026-03-12
updated: 2026-07-02
last-synced: 2026-07-02
authors:
  - C. Spencer Beggs
tags:
  - configuration
  - lockfiles
related:
  - architecture.md
  - bun-lockfile.md
  - lockfile-schemas.md
  - lockfile-reader-service.md
  - effect-patterns-parsing.md
  - research-notes.md
  - point-in-time-workspace.md
---

## Configuration and lockfiles design

The lockfiles and configuration service group (Group 4) lets consumers read the resolved dependency state of a monorepo without running `install` — for dependency audits, version-consistency checks, change-impact analysis and integrity checks. It comprises `LockfileReader` and `CatalogResolver` (plus the pure `PublishabilityDetector`, documented in `lockfile-reader-service.md`). This doc covers the lockfile-reading and catalog design; the schema definitions live in `lockfile-schemas.md`.

<!-- TOC -->

- [Overview](#overview)
- [Service Decomposition](#service-decomposition)
- [LockfileReader Service](#lockfilereader-service)
- [Lockfile Format Coverage](#lockfile-format-coverage)
- [Schema Design](#schema-design)
- [Error Types](#error-types)
- [Parsing Strategy](#parsing-strategy)
- [Layer Composition](#layer-composition)
- [CatalogResolver Service](#catalogresolver-service)
- [Testing Strategy](#testing-strategy)

<!-- /TOC -->

## Overview

`LockfileReader` reads the lockfile for the detected package manager, parses it into the unified `LockfileData` model, and answers version (`resolvedVersion`), workspace-dependency (`workspaceDependencies`) and integrity (`checkIntegrity`) queries against the parsed result, with `readLockfile` exposing the full data. PM-specific config (catalogs, overrides, trusted deps) is accessible via an optional `pmSpecific` extension on `LockfileData`. `CatalogResolver` builds on it to resolve pnpm `catalog:` / `workspace:` specifiers.

## Service Decomposition

There is no separate workspace-config-reader service. Workspace config is already read elsewhere — `WorkspaceDiscoveryLive` reads `pnpm-workspace.yaml` and the `package.json` `workspaces` field, and `PackageManagerDetectorLive` reads `packageManager`. The remaining config (catalogs, overrides, trusted deps) is lockfile-adjacent, so it lives on `LockfileReader` via the `pmSpecific` extension rather than a service of its own.

## LockfileReader Service

The service tag lives in `src/services/LockfileReader.ts`. Its methods are `readLockfile`, `resolvedVersion`, `workspaceDependencies` and `checkIntegrity` — progressive levels from full parsed data down to a single-package lookup and a health check. Initialization (root walk, PM detection, lockfile read/parse) is deferred to the first method call via `Effect.cached`, so the init failure modes surface from each method's `E` channel as the exported `LockfileInitError` union rather than from `Layer.provide`. See `lockfile-reader-service.md` for the full interface and `effect-patterns-core.md` for the lazy-init pattern.

## Lockfile Format Coverage

### pnpm-lock.yaml

- **Format**: YAML (lockfileVersion 9.0+)
- **Key fields**: `importers` (workspace packages), `packages` (resolved),
  `settings`, `catalogs`
- **Workspace encoding**: `importers` keyed by relative path
- **Inter-workspace deps**: `link:` prefix in specifiers
- **Parser needed**: YAML parser (Effect has no built-in YAML support)

### package-lock.json

- **Format**: JSON (lockfileVersion 3)
- **Key fields**: `packages` (flat map by node_modules path)
- **Workspace encoding**: `"link": true` entries
- **Inter-workspace deps**: `file:` prefix in resolved field
- **Parser needed**: `JSON.parse` (standard)

### yarn.lock

**Yarn Classic (v1)** — Custom format, NOT valid YAML:

- Entries keyed by `"name@version-range":`
- Fields: `version`, `resolved`, `integrity`, `dependencies`
- No workspace-specific encoding
- Would need custom parser

**Yarn Berry (v2+)** — YAML format:

- Entries keyed by `"name@npm:version-range"` or `"name@workspace:*"`
- Fields: `version`, `resolution`, `dependencies`, `checksum`
- Workspace encoding: `resolution: "workspace:*"`
- Inter-workspace deps: `workspace:` protocol
- Can use YAML parser

**Decision**: Support Yarn Berry only (project states "yarn Berry"). Yarn
Classic workspaces have a very different format. If Classic support is
needed, add it as a separate parser later.

### bun.lock

- **Format**: JSONC (JSON with trailing commas, since Bun 1.2)
- **Key fields**: `workspaces`, `packages` (tuple format), `catalog`
- **Workspace encoding**: `workspaces` map keyed by path
- **Inter-workspace deps**: Path as version value, `workspace:` protocol
- **Parser needed**: JSONC parser (strip commas before JSON.parse)
- **Full schema**: See `bun-lockfile.md`

## Schema Design

The unified `LockfileData` model (`ResolvedPackage`, `WorkspaceDependency`, plus the PM-specific `PnpmExtension` / `BunExtension` extensions accessible via `pmSpecific`) and the raw per-PM schemas are defined in `src/schemas/lockfile.ts` and documented in `lockfile-schemas.md`. Each format has a raw schema matching its on-disk shape and a transformation to the unified model.

One pnpm-specific shape is worth flagging: `PnpmExtension.catalogs` values are a union of a plain version string (pnpm v9) or a `{ specifier, version }` object (pnpm v10, where catalogs live in `pnpm-workspace.yaml`), so the schema accepts both.

## Error Types

```typescript
class LockfileReadError extends Data.TaggedError(
  "LockfileReadError"
)<{
  readonly lockfilePath: string
  readonly reason: string
}> {
  get message(): string {
    return `Failed to read lockfile at ${this.lockfilePath}: ${this.reason}`
  }
}

class LockfileParseError extends Data.TaggedError(
  "LockfileParseError"
)<{
  readonly lockfilePath: string
  readonly format: string
  readonly cause: unknown
}> {
  get message(): string {
    return `Failed to parse ${this.format} lockfile at ${this.lockfilePath}`
  }
}
```

## Parsing Strategy

Each format is parsed to a JS object, validated against its raw schema, then transformed to the unified model. The format parsers come from pure-Effect sibling packages so the pipeline stays Effect-native with typed errors and no impedance mismatch:

- **YAML** (`pnpm-lock.yaml`, `yarn.lock`): `yaml-effect` — see `src/layers/parsers/pnpm.ts` and `src/layers/parsers/yarn.ts`.
- **JSONC** (`bun.lock`): `jsonc-effect`, which handles comments and trailing commas that `JSON.parse` rejects — see `src/layers/parsers/bun.ts`.
- **JSON** (`package-lock.json`): standard `JSON.parse` via `Schema.parseJson` — see `src/layers/parsers/npm.ts`.

See `effect-patterns-parsing.md` for the `Schema.transformOrFail` / `Schema.compose` pipeline patterns these parsers use.

### Parsing pipeline pattern

```typescript
const parseLockfile = (content: string, format: LockfileFormat) =>
  Effect.gen(function* () {
    // Step 1: Parse raw content to JS object
    const raw = yield* Effect.try({
      try: () => parseRaw(content, format),
      catch: (e) => new LockfileParseError({
        lockfilePath: path,
        format,
        cause: e,
      }),
    })

    // Step 2: Validate against PM-specific schema
    const validated = yield* Schema.decodeUnknown(getRawSchema(format))(raw)
      .pipe(Effect.mapError((e) => new LockfileParseError({
        lockfilePath: path,
        format,
        cause: e,
      })))

    // Step 3: Transform to unified model
    return toUnifiedModel(validated, format)
  })
```

## Layer Composition

### LockfileReaderLive

```typescript
const LockfileReaderLive: Layer.Layer<
  LockfileReader,
  never,
  WorkspaceRoot | PackageManagerDetector | FileSystem | Path
>
```

Dependencies: `WorkspaceRoot` (find the monorepo root), `PackageManagerDetector` (pick the lockfile format), and `FileSystem` / `Path` from `@effect/platform`.

The layer's `E` channel is `never`: initialization (root walk, PM detection, lockfile read/parse) is deferred to the first method call via `Effect.cached`, so those failure modes surface from each method's `E` channel as the `LockfileInitError` union rather than from `Layer.provide`. See `lockfile-reader-service.md` and `effect-patterns-core.md`.

### Composite layer

`LockfileReaderLive` ships as part of the top-level `WorkspacesLive` composite
in `src/layers/WorkspacesLive.ts`, alongside the other six core services:

```typescript
// All services except git-dependent ones
// Requires: FileSystem + Path
export const WorkspacesLive = Layer.mergeAll(
  WorkspaceRootLive,
  PackageManagerDetectorLive,
  WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive)),
  DependencyGraphLive.pipe(
    Layer.provide(WorkspaceDiscoveryLive),
    Layer.provide(WorkspaceRootLive),
  ),
  TopologicalSorterLive.pipe(
    Layer.provide(DependencyGraphLive),
    Layer.provide(WorkspaceDiscoveryLive),
    Layer.provide(WorkspaceRootLive),
  ),
  LockfileReaderLive.pipe(
    Layer.provide(WorkspaceRootLive),
    Layer.provide(PackageManagerDetectorLive),
  ),
  PublishabilityDetectorLive, // pure layer, no dependencies
  CatalogResolverLive.pipe(
    Layer.provide(WorkspaceRootLive),
    Layer.provide(LockfileReaderLive.pipe(/* WorkspaceRoot + PackageManagerDetector */)),
    Layer.provide(WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive))),
  ),
)

// Full stack: adds git-dependent services
// Requires: FileSystem + Path + CommandExecutor
export const WorkspacesFullLive = Layer.mergeAll(
  WorkspacesLive,
  PackageResolverLive.pipe(Layer.provide(WorkspacesLive)),
  ChangeDetectorLive.pipe(
    Layer.provide(PackageResolverLive),
    Layer.provide(WorkspacesLive),
  ),
  PointInTimeWorkspaceLive.pipe(Layer.provide(WorkspacesLive)),
)
```

See `architecture.md` (Layer Composition) for the canonical description of
the composite layer shapes.

## CatalogResolver Service

`CatalogResolver` (`src/services/CatalogResolver.ts`, `CatalogResolverLive` in `src/layers/CatalogResolverLive.ts`) is the second service in this group. It assembles a workspace's complete pnpm catalog set and resolves `catalog:` / `workspace:` specifiers in a manifest, depending on `WorkspaceDiscovery` (for the `workspace:` graph) and reading lockfile catalog snapshots through the shared worktree-catalog pipeline (`src/layers/point-in-time/worktree-catalogs.ts`) rather than `LockfileReader`, on which it no longer depends. Assembly unions three precedence-ordered sources: lockfile catalogs, inline `pnpm-workspace.yaml` catalogs, then catalogs injected by pnpm **config dependencies**. The crux is that pnpm never persists config-dependency catalogs to a durable file — they live only in the transient `.pnpm-workspace-state-v1.json` — so the service replays each plugin-named config dependency's installed `pnpmfile` `updateConfig` hook out-of-band to recover them without that cache. Helper modules live under `src/layers/catalog/` (`workspace-manifest.ts`, `assemble.ts`, `config-dependency-hooks.ts`, `resolve.ts`). The service interface (`catalogs`, `resolve`, `resolveSpecifier`) and its `CatalogResolverError` type live in `src/services/CatalogResolver.ts`. Failures surface as the typed `CatalogAssemblyError` / `CatalogResolutionError`; see `architecture.md` (Group 4) for the full design paragraph.

It narrowly reuses the lightweight pnpm catalog primitives (`@pnpm/catalogs.{types,config,protocol-parser,resolver}`) for inline-catalog projection, protocol parsing and single-spec resolution, while avoiding the heavy `@pnpm/config.reader` / `@pnpm/hooks.pnpmfile` runtime chain (hook replay uses a hand-rolled light loader). The lockfile parsers themselves take no `@pnpm` dependency — they parse `pnpm-lock.yaml` directly through the YAML pipeline, keeping the core platform-independent.

Since the point-in-time work (2.0.0), the catalog-normalization core is shared with `PointInTimeWorkspace` through two extractions: `CatalogSet` (`src/schemas/CatalogSet.ts`), a pure `Schema.Class` value object carrying the single normalization/resolution semantic — `CatalogResolverLive` now routes lockfile-catalog normalization (string-or-`{specifier, version}` entries) through `CatalogSet.fromLockfileCatalogs` instead of hand-rolling it — and `workspaceManifestFromYaml` (`src/layers/catalog/workspace-manifest.ts`), a filesystem-free text parser for the catalog/config-dependency/packages slice of `pnpm-workspace.yaml` that the filesystem-bound `readWorkspaceManifest` now delegates to.

Since the point-in-time hardening, the worktree manifest/lockfile read is also shared: `readWorktreeCatalogState` (`src/layers/point-in-time/worktree-catalogs.ts`) is the single reader of the working tree's catalog sources. Point-in-time snapshots take its merged (lockfile-then-inline) set; `CatalogResolverLive` overlays config-dependency hook replay on top, seeding the hooks with the inline set. Hook replay is an overlay only the live resolver applies by default. The exported `CatalogResolverError` union is `CatalogAssemblyError | WorkspaceRootNotFoundError`: a missing or malformed lockfile degrades to empty lockfile catalogs, while any other lockfile read failure fails as `CatalogAssemblyError`. See `point-in-time-workspace.md` "Shared cores".

## Testing Strategy

### Mock lockfile content

Test with fixture strings representing each lockfile format:

```typescript
const MOCK_PNPM_LOCK = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.0.0
  packages/ui:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.0.0
`

const testLayer = LockfileReaderLive.pipe(
  Layer.provide(Layer.mergeAll(
    mockRoot("/project"),
    mockDetector("pnpm"),
    FileSystem.layerNoop({
      readFileString: (path) => {
        if (path === "/project/pnpm-lock.yaml")
          return Effect.succeed(MOCK_PNPM_LOCK)
        return Effect.die(`unexpected read: ${path}`)
      },
      exists: (path) => Effect.succeed(
        path === "/project/pnpm-lock.yaml"
      ),
    }),
    Path.layer,
  )),
)
```

### Test fixtures strategy

Generate realistic lockfile fixtures for each PM format. For PMs we
don't have real monorepos for (yarn Berry, bun), create minimal fixture
files that exercise the parsing logic:

- **pnpm**: Extract from our own `pnpm-lock.yaml` (real data)
- **npm**: Create a minimal `package-lock.json` v3 with workspace entries
- **yarn Berry**: Generate a minimal `yarn.lock` with `workspace:*` entries
- **bun**: Generate a minimal `bun.lock` JSONC with workspace tuples

Unit test fixtures use inline strings in test files for self-contained
parser tests. Integration tests use real fixture directories at
`__test__/integration/fixtures/{pm}/v{N}/` containing actual lockfiles
and package.json files for each package manager. Shared test utilities
(mock filesystem helpers, layer builders, fixture loaders) live in
`__test__/utils/`.

### Test matrix

| PM | Lockfile | Tests needed |
| -- | -------- | ------------ |
| pnpm | pnpm-lock.yaml | parse, workspace deps, resolved versions, catalogs |
| npm | package-lock.json | parse, workspace deps, resolved versions |
| yarn | yarn.lock (Berry) | parse, workspace deps, resolved versions |
| bun | bun.lock | parse (JSONC), workspace deps, tuple parsing |
| all | missing lockfile | LockfileReadError |
| all | malformed lockfile | LockfileParseError |

## Design notes

- **Supported versions**: pnpm v9.0+, npm v3, yarn Berry, bun.lock text format. Older formats are not parsed.
- **Integrity checking**: `checkIntegrity` verifies that workspace entries in `package.json` are reflected in the lockfile (medium depth); deep constraint-satisfaction checking is out of scope. It filters on `isWorkspace && relativePath !== undefined` and locates each `package.json` via `relativePath`, not `name`, because package names do not reliably map to filesystem paths.
- **pnpm catalogs**: catalogs are read from the lockfile snapshot and exposed via `PnpmExtension.catalogs`. In pnpm v10 catalogs are defined in `pnpm-workspace.yaml` and the lockfile stores entries as `{ specifier, version }` objects, so the schema value type is a union of `string | { specifier, version }`.
- **No `@pnpm` dependency in the parsers**: the lockfile parsers parse `pnpm-lock.yaml` through the YAML pipeline rather than pulling in `@pnpm/lockfile.fs` (which is Node-only), preserving platform independence. `CatalogResolver` is the sole narrow exception (see above).
