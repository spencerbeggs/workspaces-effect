---
title: "Phase 4: Configuration & Lockfiles Design"
module: core
category: architecture
status: draft
completeness: 75
created: 2026-03-12
updated: 2026-03-13
last-synced: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - configuration
  - lockfiles
  - phase4
related:
  - architecture.md
  - bun-lockfile.md
  - lockfile-schemas.md
  - effect-best-practices.md
  - research-notes.md
---

## Phase 4: Configuration & Lockfiles Design

<!-- TOC -->

- [Overview](#overview)
- [Goals](#goals)
- [Service Decomposition](#service-decomposition)
- [LockfileReader Service](#lockfilereader-service)
- [Lockfile Format Coverage](#lockfile-format-coverage)
- [Schema Design](#schema-design)
- [Error Types](#error-types)
- [Parsing Strategy](#parsing-strategy)
- [Layer Composition](#layer-composition)
- [Testing Strategy](#testing-strategy)
- [Open Questions (mostly resolved)](#open-questions-mostly-resolved)
- [Research Needed](#research-needed)

<!-- /TOC -->

## Overview

Phase 4 adds lockfile reading and PM-specific configuration parsing to
the library. This enables consumers to understand the resolved dependency
state of a monorepo without running `install`, which is valuable for:

- CI/CD pipelines that need to know exact versions
- Dependency audit tools
- Change impact analysis that considers version constraints
- Workspace-aware dependency deduplication analysis

## Goals

1. **Read lockfiles** from all 4 supported PMs (pnpm, npm, yarn, bun)
2. **Provide a unified interface** for common lockfile queries
3. **Support PM-specific features** where valuable (pnpm catalogs, etc.)
4. **Parse YAML/JSON/JSONC** using Effect Schema for validation
5. **Keep it lightweight** — parse only what consumers need

## Use Cases

1. **Dependency audit** — "What exact versions are installed across the
   monorepo?" Enables security scanning and license compliance.
2. **Version consistency** — "Are all workspace packages using the same
   version of react?" Catches version skew.
3. **Change impact analysis** — "Which packages are affected by this
   lockfile change?" Complements Phase 3 ChangeDetector.
4. **Integrity checking** — "Is the lockfile in sync with package.json?"
   Detects stale lockfiles.
5. **Workspace dependency resolution** — "What resolved version does
   package A see for its dependency on package B?" Useful for build
   ordering and compatibility analysis.

## Service Decomposition

The original architecture proposed two services:

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `WorkspaceConfigReader` | Read PM-specific workspace config | FileSystem, Path |
| `LockfileReader` | Parse lockfile metadata | FileSystem, Path |

### Decision: One service (LockfileReader)

`WorkspaceConfigReader` overlaps significantly with existing services:

- WorkspaceDiscoveryLive already reads `pnpm-workspace.yaml` and
  `package.json` workspaces field
- PackageManagerDetectorLive already reads `packageManager` field
- The remaining config (pnpm catalogs, overrides, etc.) is lockfile-adjacent

**Decision**: Merge `WorkspaceConfigReader` into `LockfileReader`. PM-specific
config (catalogs, overrides, trusted deps) is accessible via an optional
`pmSpecific` extension field on `LockfileData`.

## LockfileReader Service

### Interface (draft)

```typescript
class LockfileReader extends Context.Tag(
  "@spencerbeggs/workspaces-effect/LockfileReader"
)<
  LockfileReader,
  {
    /** Read and parse the lockfile for the detected package manager. */
    readonly readLockfile: () => Effect.Effect<
      LockfileData,
      LockfileReadError | LockfileParseError
    >

    /** Get the resolved version of a specific package. */
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<
      Option.Option<ResolvedPackage>,
      LockfileReadError | LockfileParseError
    >

    /** Get all workspace inter-dependencies from the lockfile. */
    readonly workspaceDependencies: () => Effect.Effect<
      ReadonlyArray<WorkspaceDependency>,
      LockfileReadError | LockfileParseError
    >

    /** Check lockfile integrity (does it match current package.json state?). */
    readonly checkIntegrity: () => Effect.Effect<
      LockfileIntegrity,
      LockfileReadError | LockfileParseError
    >
  }
>() {}
```

### Progressive disclosure

Similar to ChangeDetector, the service provides progressive levels:

1. `readLockfile()` — full parsed lockfile data
2. `resolvedVersion(name)` — single package lookup
3. `workspaceDependencies()` — workspace-specific view
4. `checkIntegrity()` — health check

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

### Unified lockfile data model (draft)

```typescript
class ResolvedPackage extends Schema.Class<ResolvedPackage>(
  "ResolvedPackage"
)({
  /** Package name */
  name: Schema.NonEmptyString,
  /** Resolved version */
  version: Schema.String,
  /** Integrity hash (SRI format) */
  integrity: Schema.optional(Schema.String),
  /** Whether this is a workspace package */
  isWorkspace: Schema.Boolean,
  /** Direct dependencies (name -> version constraint) */
  dependencies: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { default: () => ({}) },
  ),
}) {}

class WorkspaceDependency extends Schema.Class<WorkspaceDependency>(
  "WorkspaceDependency"
)({
  /** Source workspace package name */
  from: Schema.NonEmptyString,
  /** Target workspace package name */
  to: Schema.NonEmptyString,
  /** Dependency type */
  depType: Schema.Literal(
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ),
  /** Version constraint */
  constraint: Schema.String,
}) {}

class LockfileData extends Schema.Class<LockfileData>(
  "LockfileData"
)({
  /** Package manager that owns this lockfile */
  packageManager: PackageManager,
  /** Lockfile format version */
  lockfileVersion: Schema.String,
  /** All resolved packages */
  packages: Schema.Array(ResolvedPackage),
  /** Workspace inter-dependencies */
  workspaceDependencies: Schema.Array(WorkspaceDependency),
  /** PM-specific extension data (catalogs, overrides, etc.) */
  pmSpecific: Schema.optional(Schema.Union(
    PnpmExtension,
    BunExtension,
  )),
}) {}

/** pnpm-specific data not captured in the unified model. */
class PnpmExtension extends Schema.Class<PnpmExtension>(
  "PnpmExtension"
)({
  _tag: Schema.Literal("pnpm"),
  /** pnpm catalog definitions for centralized version management. */
  catalogs: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: Schema.String }),
  })),
  /** Dependency overrides from pnpm-lock.yaml. */
  overrides: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  /** pnpm settings (autoInstallPeers, excludeLinksFromLockfile). */
  settings: Schema.optional(Schema.Struct({
    autoInstallPeers: Schema.optional(Schema.Boolean),
    excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
  })),
}) {}

/** Bun-specific data not captured in the unified model. */
class BunExtension extends Schema.Class<BunExtension>(
  "BunExtension"
)({
  _tag: Schema.Literal("bun"),
  /** Bun catalog entries. */
  catalog: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  /** Named catalogs. */
  catalogs: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  })),
  /** Dependency overrides. */
  overrides: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  /** Trusted dependencies allowed to run lifecycle scripts. */
  trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
}) {}
```

### PM-specific schemas

Each lockfile format needs its own raw schema for parsing, then a
transformation to the unified `LockfileData` model:

```typescript
// Raw pnpm lockfile schema
const PnpmLockfileRaw = Schema.Struct({
  lockfileVersion: Schema.String,
  settings: Schema.optional(Schema.Struct({
    autoInstallPeers: Schema.optional(Schema.Boolean),
    excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
  })),
  importers: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      dependencies: Schema.optional(/* ... */),
      devDependencies: Schema.optional(/* ... */),
    }),
  }),
  packages: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      resolution: Schema.Struct({ integrity: Schema.optional(Schema.String) }),
      // ...
    }),
  })),
})

// Transform raw -> unified
const pnpmToLockfileData = (raw: PnpmLockfileRaw): LockfileData => { ... }
```

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

### YAML parsing challenge

Effect has no built-in YAML parser. Options:

1. **js-yaml** — mature, widely used, MIT license
2. **yaml** — newer, better YAML 1.2 support, ISC license
3. **Manual line parser** — like current pnpm-workspace.yaml parser in
   WorkspaceDiscoveryLive (very limited, only handles simple arrays)
4. **Effect Schema.transformOrFail** — wrap any parser in Schema pipeline

**Recommendation**: Use `yaml` package for full YAML support. Wrap in
`Effect.try` for error handling and `Schema.decodeUnknown` for validation.

### JSONC parsing for bun.lock

**Decision**: Use `jsonc-effect` v0.1.0 (npm) / `@spencerbeggs/jsonc-effect` (GitHub).
**Status**: Library complete and published.

A pure Effect-TS JSONC parser — no dependency on Microsoft's `jsonc-parser`.
Scanner, parser, AST, formatter all implemented natively in Effect.

Key API for bun.lock parsing:

```typescript
import { makeJsoncSchema } from "jsonc-effect"

// Composes JSONC parsing + Schema validation in one step
const BunLockfileFromJsonc = makeJsoncSchema(BunLockfileRaw)

// Usage: JSONC string → validated BunLockfileRaw
const parsed = yield* Schema.decodeUnknown(BunLockfileFromJsonc)(content)
```

Full API: `parse`, `parseTree`, `stripComments`, `createScanner`,
`makeJsoncSchema`, `findNode`, `visit` (Stream), `format`, `modify`.
Typed errors: `JsoncParseError`, `JsoncNodeNotFoundError`, `JsoncModificationError`.

Rationale:

- Pure Effect — zero impedance mismatch, no wrapper overhead
- Only runtime dependency is `effect`
- Full JSONC support: comments (line + block), trailing commas
- Effect-native: typed errors, Schema integration, Stream visitor
- Reusable across repos (tsconfig.json, biome.jsonc, VS Code settings)

### YAML parsing for pnpm-lock.yaml and yarn.lock

**Decision**: Use `yaml` v2.x package as direct production dependency, wrapped
in Effect.try + Schema.decodeUnknown.

`yaml` is currently only a transitive devDependency (via `@effect/cli`, `vite`).
Must be added to `dependencies` for the published package.

Future consideration: `yaml-effect` sister package with typed errors,
`makeYamlSchema()`, Stream-based multi-document iteration. Deferred because
YAML 1.2 is significantly more complex than JSONC to reimplement from scratch.

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
  LockfileReadError | LockfileParseError,
  WorkspaceRoot | PackageManagerDetector | FileSystem | Path
>
```

Dependencies:

- **WorkspaceRoot**: to find the monorepo root where lockfiles live
- **PackageManagerDetector**: to know which lockfile format to read
- **FileSystem**: to read the lockfile
- **Path**: for path resolution

**Note on error channel**: Unlike most layers in this library (which have
`E = never`), `LockfileReaderLive` propagates errors in the E channel
because lockfile parsing can fail at layer construction time. This is
intentional — consumers must handle the possibility that the lockfile
doesn't exist or can't be parsed. Use `Layer.unwrapEffect` or
`Effect.provide` with error handling.

Alternatively, we could make the layer construction never-fail by reading
the lockfile lazily on first method call. This trades API ergonomics
(errors in method calls instead of layer construction) for consistency
with other layers. **Decision**: Keep errors in layer E channel for now.
This matches the reality that lockfile availability is an environmental
concern, not a per-query concern.

### Composite layer

```typescript
// All Phase 4 services (includes Discovery for WorkspaceRoot)
const ConfigurationLive: Layer.Layer<
  LockfileReader,
  LockfileReadError | LockfileParseError,
  WorkspaceRoot | PackageManagerDetector | FileSystem | Path
> = LockfileReaderLive

// Full stack: Discovery + Configuration
const FullConfigLive = ConfigurationLive.pipe(
  Layer.provide(DiscoveryLive),
)
// Type: Layer.Layer<LockfileReader, LockfileReadError | LockfileParseError, FileSystem | Path>
```

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

Fixtures should be inline strings in test files (like existing tests),
not separate files, to keep tests self-contained.

### Test matrix

| PM | Lockfile | Tests needed |
| -- | -------- | ------------ |
| pnpm | pnpm-lock.yaml | parse, workspace deps, resolved versions, catalogs |
| npm | package-lock.json | parse, workspace deps, resolved versions |
| yarn | yarn.lock (Berry) | parse, workspace deps, resolved versions |
| bun | bun.lock | parse (JSONC), workspace deps, tuple parsing |
| all | missing lockfile | LockfileReadError |
| all | malformed lockfile | LockfileParseError |

## Open Questions (mostly resolved)

1. **One service vs two**: RESOLVED. Single `LockfileReader` service.
   PM-specific config accessible via `pmSpecific` extension field.

2. **YAML parser dependency**: RESOLVED. Use `yaml` package (`yaml@2.8.2`
   already in transitive deps via `@effect/cli`). Zero additional download.

3. **Lockfile version support**: RESOLVED. Current versions only:
   pnpm v9.0+, npm v3, yarn Berry, bun.lock text. Older versions deferred.

4. **Parse depth**: RESOLVED. Eager full parse at layer construction.
   Consistent with DependencyGraphLive/TopologicalSorterLive patterns.
   Lazy option deferred to future optimization pass if needed.

5. **Integrity checking**: Partially resolved. Start with medium depth:
   - Does lockfile exist and parse? (basic)
   - Do workspace entries match package.json? (medium)
   - Deep constraint satisfaction checking deferred.

6. **pnpm catalogs**: RESOLVED. Yes, parse catalogs from lockfile. Available
   via `PnpmExtension.catalogs` on `LockfileData.pmSpecific`. The lockfile
   already contains resolved catalog snapshots.

## Sibling Repo Findings

### pnpm-config-dependency-action lockfile service

The `pnpm-config-dependency-action` repo provides a real-world example of
pnpm lockfile reading with Effect:

**Dependencies used**:

- `@pnpm/lockfile.fs` (v1001.1.29) — reads pnpm-lock.yaml
- `@pnpm/lockfile.types` (v1002.0.9) — TypeScript types
- `workspace-tools` — for workspace package discovery

**Key API**: `readWantedLockfile(root, { ignoreIncompatible: true })`
returns `LockfileObject | null`.

**LockfileObject structure** (from @pnpm/lockfile.types):

- `importers` — workspace packages keyed by relative path (`.`, `packages/ui`)
- `catalogs` — catalog snapshots for centralized version management
- `packages` — resolved dependency map
- `specifiers` — version specifiers from package.json

**Key insight: specifier vs version**:

- `specifier` = what's in package.json (e.g., `^19.0.0`, `catalog:`)
- `version` = resolved version (e.g., `19.0.0`)

**Catalog detection**: Check if specifier starts with `catalog:` or
`catalog:<name>` to identify catalog-managed dependencies.

**Platform dependency**: `@pnpm/lockfile.fs` uses Node.js APIs internally.
For our platform-independent library, we should parse YAML ourselves.

### Design decision: No @pnpm dependency

Using `@pnpm/lockfile.fs` would:

- Tie us to Node.js (breaks platform independence)
- Add a heavy dependency chain
- Limit Bun compatibility

Instead, parse pnpm-lock.yaml ourselves using a YAML parser + Schema
validation. The pnpm lockfile structure is well-documented and stable.

## Research Needed

- [x] pnpm-lock.yaml v9 full schema → see `lockfile-schemas.md`
- [x] package-lock.json v3 schema → see `lockfile-schemas.md`
- [ ] yarn.lock Berry format → research agent dispatched
- [x] YAML parser options → decided: `yaml` package (already transitive dep)
- [x] JSONC parsing approach → decided: `jsonc-effect` (v0.1.0, published)
- [x] How sibling repos handle lockfile reading (pnpm-config-dependency-action)
- [x] Effect Stream patterns for lazy lockfile parsing → deferred (eager first)
- [x] pnpm catalogs format and use cases
- [ ] Effect Schema.transformOrFail patterns → research agent dispatched
- [ ] Validate schemas against real lockfile data
- [ ] Prototype YAML parsing pipeline (pnpm, yarn Berry)
- [ ] Prototype JSONC parsing pipeline (bun.lock via jsonc-effect)
- [ ] Add `yaml` as direct production dependency (currently transitive only)
- [ ] Add `jsonc-effect` as direct production dependency
