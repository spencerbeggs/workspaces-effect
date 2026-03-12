---
title: "Phase 4: Configuration & Lockfiles Design"
module: core
category: architecture
status: draft
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - configuration
  - lockfiles
  - phase4
related:
  - architecture.md
  - bun-lockfile.md
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
- [Open Questions](#open-questions)
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

## Service Decomposition

The original architecture proposed two services:

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| `WorkspaceConfigReader` | Read PM-specific workspace config | FileSystem, Path |
| `LockfileReader` | Parse lockfile metadata | FileSystem, Path |

### Revised thinking

`WorkspaceConfigReader` overlaps significantly with existing services:

- WorkspaceDiscoveryLive already reads `pnpm-workspace.yaml` and
  `package.json` workspaces field
- PackageManagerDetectorLive already reads `packageManager` field
- The remaining config (pnpm catalogs, overrides, etc.) is lockfile-adjacent

**Proposal**: Merge `WorkspaceConfigReader` into `LockfileReader` as a
broader "workspace state reader" that covers both lockfile data and
PM-specific config that isn't already handled by Phase 1 services.

Alternatively, keep `LockfileReader` focused on lockfiles only and add
PM-specific config features to existing services as needed.

**Decision needed**: One service vs two. See [Open Questions](#open-questions).

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

- **Format**: Custom YAML-like (yarn classic) or YAML (yarn berry)
- **Key fields**: Package entries with resolution, dependencies, checksum
- **Workspace encoding**: `resolution: "workspace:*"`
- **Inter-workspace deps**: `workspace:` protocol
- **Parser needed**: Custom parser or YAML parser (yarn berry)

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

Options:

1. **Strip trailing commas + JSON.parse** — simple regex replacement
2. **jsonc-parser** — VS Code's JSONC parser, handles comments too
3. **Custom Effect.try wrapper** — strip commas in preprocessing

**Recommendation**: Simple comma stripping + `JSON.parse`. The bun.lock
format is regular enough that a regex replacement handles it.

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

### Composite layer

```typescript
// All Phase 4 services
const ConfigurationLive: Layer.Layer<
  LockfileReader,
  LockfileReadError | LockfileParseError,
  WorkspaceRoot | PackageManagerDetector | FileSystem | Path
> = LockfileReaderLive
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

### Test matrix

| PM | Lockfile | Tests needed |
| -- | -------- | ------------ |
| pnpm | pnpm-lock.yaml | parse, workspace deps, resolved versions |
| npm | package-lock.json | parse, workspace deps, resolved versions |
| yarn | yarn.lock | parse, workspace deps, resolved versions |
| bun | bun.lock | parse (JSONC), workspace deps, tuple parsing |
| all | missing lockfile | LockfileReadError |
| all | malformed lockfile | LockfileParseError |

## Open Questions

1. **One service vs two**: Should `LockfileReader` also cover PM-specific
   config (pnpm catalogs, overrides, trusted deps), or keep a separate
   `WorkspaceConfigReader`? Leaning toward single service since lockfiles
   already encode most config state.

2. **YAML parser dependency**: Adding `js-yaml` or `yaml` adds a runtime
   dependency. Is this acceptable, or should we use a simpler line-based
   parser for pnpm-lock.yaml? The current pnpm-workspace.yaml parser in
   WorkspaceDiscoveryLive is line-based but very limited.

3. **Lockfile version support**: Which lockfile versions do we support?
   - pnpm-lock.yaml: v9.0+ only? Or also v6/v7?
   - package-lock.json: v3 only? Or also v2?
   - yarn.lock: Berry only? Or also Classic?

4. **Parse depth**: Full lockfile parse vs lazy/streaming?
   - For small monorepos, full parse is fine
   - For large monorepos (1000+ packages), full parse may be expensive
   - Could use streaming YAML parser for pnpm-lock.yaml

5. **Integrity checking**: How deep should `checkIntegrity` go?
   - Basic: does lockfile exist and parse?
   - Medium: do workspace entries match package.json?
   - Deep: do resolved versions satisfy constraints?

6. **pnpm catalogs**: Should we parse catalog definitions from
   `pnpm-workspace.yaml`? This is a pnpm 9+ feature for centralized
   version management.

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

- [ ] pnpm-lock.yaml v9 full schema (importers, packages, settings)
- [ ] package-lock.json v3 schema (packages flat map)
- [ ] yarn.lock Berry format (YAML variant)
- [ ] YAML parser options for Effect (js-yaml vs yaml vs manual)
- [ ] JSONC stripping approach for bun.lock
- [x] How sibling repos handle lockfile reading (pnpm-config-dependency-action)
- [ ] Effect Stream patterns for lazy lockfile parsing
- [x] pnpm catalogs format and use cases
