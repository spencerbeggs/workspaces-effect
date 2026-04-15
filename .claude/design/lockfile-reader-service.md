---
title: "LockfileReader Service Interface Design"
module: core
category: architecture
status: current
completeness: 95
created: 2026-03-12
updated: 2026-04-15
last-synced: 2026-04-15
authors:
  - C. Spencer Beggs
tags:
  - lockfile
  - service
  - phase4
related:
  - architecture.md
  - phase4-configuration-lockfiles.md
  - lockfile-schemas.md
  - effect-patterns-core.md
---

## LockfileReader Service Interface Design

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Rationale](#rationale)
- [Error Types](#error-types)
- [LockfileReader Service Interface](#lockfilereader-service-interface)
- [Service Pattern Trade-offs](#service-pattern-trade-offs)
- [Layer Construction Flow](#layer-construction-flow)
- [PublishabilityDetector Service](#publishabilitydetector-service)
- [Usage Examples](#usage-examples)
- [Testing Strategy](#testing-strategy)
- [Open Questions](#open-questions)

<!-- /TOC -->

## Overview

This document defines the `LockfileReader` service interface for Phase 4
of workspaces-effect. The service provides a unified, PM-agnostic API for
querying lockfile data across all four supported package managers (pnpm,
npm, yarn Berry, bun). It also introduces `PublishabilityDetector` as a
separate composable service for determining which workspace packages are
publishable.

This is a design specification -- all code is spec-level, not production.

## Current State

The lockfile schemas (raw and unified) are defined in `lockfile-schemas.md`.
The overall Phase 4 architecture and parsing strategy are defined in
`phase4-configuration-lockfiles.md`. Existing services (WorkspaceRoot,
DependencyGraph, etc.) use the `Context.Tag` + `Layer.effect` pattern.
The `Effect.Service` combined pattern has been researched and documented
in `effect-patterns-core.md` but has not yet been used in production code.

This document bridges the gap between the schema definitions and the
service implementation by specifying the exact interface, error types,
layer construction, and composition patterns.

## Rationale

### Why a unified service rather than per-PM services

Each lockfile format is structurally different (YAML, JSON, JSONC, different
key conventions), but consumers overwhelmingly want the same operations:
"what version is locked?", "what are the workspace dependencies?", "is the
integrity valid?". A unified interface with PM-specific parsing behind the
scenes follows the same pattern as `PackageManagerDetector` -- one service
tag, multiple internal strategies.

### Why eager parsing at layer construction

Consistent with `DependencyGraphLive` and `TopologicalSorterLive`, the
lockfile is read and parsed once when the layer is constructed. All service
methods query the precomputed `LockfileData`. This is appropriate because:

- Lockfile content is immutable for the duration of a program run
- Full parsing cost is low (single file read + YAML/JSON parse)
- Avoids repeated I/O on every method call
- Errors surface early (at layer construction, not at query time)

### Why separate PublishabilityDetector

Publishability detection is orthogonal to lockfile reading. Some consumers
need lockfile data without caring about publishability, and vice versa.
Making it a separate service with a default implementation allows users to
override the detection strategy (e.g., monorepos with custom `publishConfig`
conventions or release tooling that marks packages differently).

## Error Types

**Implementation note (2026-03-14):** The actual implementation simplified the error hierarchy. `LockfileReadError` covers both missing and unreadable lockfiles. `LockfileParseError` covers parse and version errors. `PackageNotInLockfileError` was not needed because `resolvedVersion` returns `Option.Option<ResolvedPackage>` (Option.none for missing packages) instead of failing.

New errors for lockfile operations. All follow the existing `Data.TaggedError`
with `Base` export pattern established in `src/errors/index.ts`.

```typescript
import { Data } from "effect"

// ── Lockfile Errors ─────────────────────────────────────────────────

/** @internal */
export const LockfileNotFoundErrorBase = Data.TaggedError("LockfileNotFoundError")

/**
 * Emitted when the expected lockfile does not exist at the workspace root.
 * The `expectedPath` indicates where the lockfile was expected based on
 * the detected package manager.
 */
export class LockfileNotFoundError extends LockfileNotFoundErrorBase<{
  readonly expectedPath: string
  readonly manager: "npm" | "pnpm" | "yarn" | "bun"
}> {
  get message(): string {
    return `Lockfile not found at "${this.expectedPath}" for ${this.manager}`
  }
}

/** @internal */
export const LockfileParseErrorBase = Data.TaggedError("LockfileParseError")

/**
 * Emitted when the lockfile exists but cannot be parsed.
 * Covers YAML/JSON/JSONC syntax errors and Schema validation failures.
 * The `manager` field identifies which parser was used.
 */
export class LockfileParseError extends LockfileParseErrorBase<{
  readonly lockfilePath: string
  readonly manager: "npm" | "pnpm" | "yarn" | "bun"
  readonly reason: string
  readonly cause: unknown
}> {
  get message(): string {
    return `Failed to parse ${this.manager} lockfile at "${this.lockfilePath}": ${this.reason}`
  }
}

/** @internal */
export const LockfileVersionErrorBase = Data.TaggedError("LockfileVersionError")

/**
 * Emitted when the lockfile version is not supported.
 * We support: pnpm v9.0+, npm v3, yarn Berry, bun.lock text format.
 */
export class LockfileVersionError extends LockfileVersionErrorBase<{
  readonly lockfilePath: string
  readonly manager: "npm" | "pnpm" | "yarn" | "bun"
  readonly version: string
  readonly supportedVersions: ReadonlyArray<string>
}> {
  get message(): string {
    return (
      `Unsupported ${this.manager} lockfile version "${this.version}" ` +
      `at "${this.lockfilePath}". Supported: ${this.supportedVersions.join(", ")}`
    )
  }
}

/** @internal */
export const PackageNotInLockfileErrorBase = Data.TaggedError("PackageNotInLockfileError")

/**
 * Emitted when a queried package is not present in the lockfile.
 * Distinct from PackageNotFoundError (which is workspace-scoped).
 */
export class PackageNotInLockfileError extends PackageNotInLockfileErrorBase<{
  readonly packageName: string
  readonly manager: "npm" | "pnpm" | "yarn" | "bun"
}> {
  get message(): string {
    return `Package "${this.packageName}" not found in ${this.manager} lockfile`
  }
}
```

### Error hierarchy rationale

| Error | When raised | Where raised |
| --- | --- | --- |
| `LockfileNotFoundError` | Lockfile missing from workspace root | Layer construction |
| `LockfileParseError` | YAML/JSON/JSONC syntax error or Schema validation failure | Layer construction |
| `LockfileVersionError` | Lockfile version too old or unrecognized | Layer construction |
| `PackageNotInLockfileError` | Package name not in parsed lockfile data | `resolvedVersion`, `checkIntegrity` |

The first three are **construction-time** errors (in the Layer's E channel).
Only `PackageNotInLockfileError` is a **query-time** error (in method return types).

## LockfileReader Service Interface

### Interface definition

```typescript
import type { Effect, Option } from "effect"
import { Context } from "effect"
import type {
  LockfileData,
  ResolvedPackage,
  WorkspaceDependency,
} from "../schemas/lockfile.js"
import type { PackageNotInLockfileError } from "../errors/index.js"

/**
 * Service for reading and querying lockfile data.
 *
 * Parses the lockfile for the detected package manager at layer
 * construction time and provides a unified query API. All methods
 * operate on the precomputed data (no additional I/O).
 */
export class LockfileReader extends Context.Tag(
  "workspaces-effect/LockfileReader",
)<
  LockfileReader,
  {
    /**
     * Get the full parsed lockfile data.
     *
     * Returns the unified LockfileData model containing all resolved
     * packages, workspace dependencies, and PM-specific extensions.
     * No additional I/O -- data was parsed at layer construction.
     */
    readonly lockfileData: () => Effect.Effect<LockfileData>

    /**
     * Resolve a version specifier to its locked version for a package.
     *
     * @param packageName - The package name (e.g., "react", "@scope/ui")
     * @returns Option.some(ResolvedPackage) if found, Option.none if not in lockfile
     *
     * **Implementation note (2026-03-14):** The actual signature uses
     * `Option.Option<ResolvedPackage>` with error channel `never` instead of
     * failing with `PackageNotInLockfileError`. Returns `Option.none` for
     * unknown packages. Uses `Effect.request` with `Request.makeCache`
     * internally for deduplication of repeated lookups.
     */
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<Option.Option<ResolvedPackage>>

    /**
     * Verify integrity hash for a package.
     *
     * Checks that the package exists in the lockfile and has an integrity
     * hash. Returns the hash if present, None if the package exists but
     * has no integrity field (common for workspace packages).
     *
     * @param packageName - The package name to check
     * @returns Option of the SRI integrity hash string
     */
    readonly checkIntegrity: (
      packageName: string,
    ) => Effect.Effect<Option.Option<string>, PackageNotInLockfileError>

    /**
     * Get all dependencies declared by a specific workspace.
     *
     * Returns the dependency entries from the lockfile's importer/workspace
     * section for the given workspace path. This includes dependencies,
     * devDependencies, and peerDependencies with their specifiers and
     * resolved versions.
     *
     * @param workspacePath - Relative path from workspace root (e.g., ".", "packages/ui")
     * @returns Array of WorkspaceDependency entries for that workspace
     */
    readonly importersFor: (
      workspacePath: string,
    ) => Effect.Effect<ReadonlyArray<WorkspaceDependency>>

    /**
     * Get catalog entries from the lockfile.
     *
     * Catalogs are a pnpm and bun feature for centralized version
     * management. Returns an empty record for npm and yarn, which
     * do not support catalogs.
     *
     * @returns Record of catalog name -> (package name -> version specifier)
     *          The default catalog uses the key "default".
     */
    readonly catalogEntries: () => Effect.Effect<
      Readonly<Record<string, Readonly<Record<string, string>>>>
    >

    /**
     * Get dependency overrides/resolutions from the lockfile.
     *
     * Returns the overrides (pnpm/npm), resolutions (yarn), or
     * overrides (bun) configured in the lockfile. Returns an empty
     * record if no overrides are configured.
     *
     * @returns Record of package specifier -> override version
     */
    readonly overrides: () => Effect.Effect<
      Readonly<Record<string, string>>
    >
  }
>() {}
```

### Method design decisions

| Method | Returns | Error channel | Notes |
| --- | --- | --- | --- |
| `lockfileData()` | `LockfileData` | never | Already parsed; infallible query |
| `resolvedVersion(name)` | `Option<ResolvedPackage>` | never | Returns Option.none for unknown packages; uses Request/RequestResolver internally |
| `checkIntegrity(name)` | `Option<string>` | `PackageNotInLockfileError` | Option because workspace pkgs lack hashes |
| `importersFor(path)` | `ReadonlyArray<WorkspaceDependency>` | never | Returns empty array if path not found |
| `catalogEntries()` | `Record<string, Record<string, string>>` | never | Empty record for non-catalog PMs. Note: pnpm v10 stores catalog entries as `{ specifier, version }` objects internally; `catalogEntries()` normalizes to plain strings. |
| `overrides()` | `Record<string, string>` | never | Empty record if no overrides |

Design principle: methods that perform lookups by user-provided keys
(package names) can fail with `PackageNotInLockfileError`. Methods that
return aggregate data return empty collections instead of failing, since
an empty result is a valid answer ("no catalogs configured" is not an error).

## Service Pattern Trade-offs

### Current pattern: Context.Tag + Layer.effect (used by all existing services)

```typescript
// Service definition
export class LockfileReader extends Context.Tag(
  "workspaces-effect/LockfileReader",
)<LockfileReader, { /* ... */ }>() {}

// Layer definition (separate file)
export const LockfileReaderLive = Layer.effect(
  LockfileReader,
  Effect.gen(function* () {
    const root = yield* WorkspaceRoot
    const detector = yield* PackageManagerDetector
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    // ... parse lockfile ...
    return { /* methods */ }
  }),
)
```

**Advantages:**

- Consistent with all existing services in the codebase
- Tag and Layer are independently testable and composable
- Layer dependencies are explicit in the Layer definition, not the Tag
- Tag file stays small and import-light (only types)
- Well-understood by the team

**Disadvantages:**

- Two separate declarations for one logical unit
- Layer naming is a convention, not enforced

### Alternative: Effect.Service combined pattern (new in Effect)

```typescript
class LockfileReader extends Effect.Service<LockfileReader>()(
  "workspaces-effect/LockfileReader",
  {
    effect: Effect.gen(function* () {
      const root = yield* WorkspaceRoot
      const detector = yield* PackageManagerDetector
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      // ... parse lockfile ...
      return { /* methods */ } as const
    }),
    dependencies: [
      WorkspaceRootLive,
      PackageManagerDetectorLive,
      NodeFileSystem.layer,
      NodePath.layer,
    ],
  },
) {}

// Auto-generated:
// LockfileReader.Default                      -- Layer<LockfileReader, E, never>
// LockfileReader.DefaultWithoutDependencies   -- Layer<LockfileReader, E, R>
```

**Advantages:**

- Single declaration for Tag + default Layer
- `Default` layer auto-wires dependencies
- `DefaultWithoutDependencies` still available for manual composition
- Less boilerplate for simple services

**Disadvantages:**

- Bakes platform-specific layers (NodeFileSystem, NodePath) into the
  service definition, which contradicts our "users provide platform
  layers at the edge" principle
- Not yet used anywhere in the codebase -- introduces a new pattern
  that must be learned and maintained alongside the existing one
- The `dependencies` array couples the service to concrete layer
  implementations, reducing composability
- Error channel handling with `Layer.unwrapEffect` (needed for our
  construction-time errors) is less clear with this pattern
- api-extractor/DTS bundling compatibility is unverified for this pattern

### Recommendation

**Use `Context.Tag` + `Layer.effect` for LockfileReader.** Rationale:

1. Consistency with all 7 existing services in the codebase
2. Platform independence -- we should not bake NodeFileSystem into the
   service definition
3. The `Effect.Service` pattern's main advantage (auto-wired `Default`
   layer) is less valuable for library code where consumers control
   the platform layers
4. Construction-time errors in the Layer E channel are more natural
   with the explicit `Layer.effect` pattern

Consider migrating to `Effect.Service` in a future iteration if/when:

- The codebase grows enough that the boilerplate savings justify the
  pattern change
- api-extractor compatibility is confirmed
- A clean way to handle platform layer injection with `Effect.Service`
  is established

## Layer Construction Flow

### LockfileReaderLive

```typescript
import { Effect, Layer, Option, pipe } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { LockfileReader } from "./LockfileReader.js"
import { WorkspaceRoot } from "./WorkspaceRoot.js"
import { PackageManagerDetector } from "./PackageManagerDetector.js"
import type { PackageManagerType } from "../schemas/core.js"
import {
  LockfileNotFoundError,
  LockfileParseError,
  LockfileVersionError,
  PackageNotInLockfileError,
} from "../errors/index.js"

/**
 * Maps package manager to its lockfile filename.
 */
const lockfileNameFor = (pm: PackageManagerType): string => {
  switch (pm) {
    case "pnpm": return "pnpm-lock.yaml"
    case "npm": return "package-lock.json"
    case "yarn": return "yarn.lock"
    case "bun": return "bun.lock"
  }
}

/**
 * Live layer for LockfileReader.
 *
 * Construction flow:
 * 1. Detect package manager (via PackageManagerDetector)
 * 2. Resolve lockfile path (workspace root + lockfile name)
 * 3. Read lockfile content (via FileSystem)
 * 4. Parse raw content (YAML/JSON/JSONC depending on PM)
 * 5. Validate against PM-specific raw schema (Schema.decode)
 * 6. Transform to unified LockfileData model
 * 7. Store parsed data; service methods query it
 *
 * Errors at any step propagate in the Layer's E channel.
 */
export const LockfileReaderLive: Layer.Layer<
  LockfileReader,
  LockfileNotFoundError | LockfileParseError | LockfileVersionError,
  WorkspaceRoot | PackageManagerDetector | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  LockfileReader,
  Effect.gen(function* () {
    // 1. Resolve dependencies
    const root = yield* WorkspaceRoot
    const detector = yield* PackageManagerDetector
    const fs = yield* FileSystem.FileSystem
    const pathSvc = yield* Path.Path

    // 2. Detect PM and resolve lockfile path
    const pmInfo = yield* detector.detect()
    const pm = pmInfo.packageManager
    const lockfileName = lockfileNameFor(pm)
    const lockfilePath = pathSvc.join(pmInfo.root, lockfileName)

    // 3. Check lockfile existence
    const exists = yield* fs.exists(lockfilePath).pipe(
      Effect.orElseSucceed(() => false),
    )
    if (!exists) {
      return yield* Effect.fail(
        new LockfileNotFoundError({
          expectedPath: lockfilePath,
          manager: pm,
        }),
      )
    }

    // 4. Read lockfile content
    const content = yield* fs.readFileString(lockfilePath).pipe(
      Effect.mapError(() =>
        new LockfileParseError({
          lockfilePath,
          manager: pm,
          reason: "Failed to read file",
          cause: null,
        }),
      ),
    )

    // 5-6. Parse and validate (PM-specific)
    //
    // Uses the parsing pipeline from lockfile-schemas.md:
    //   string -> raw parse (YAML/JSON/JSONC) -> Schema.decode -> transform
    //
    // Each PM has a composed schema: e.g., PnpmLockfileFromString
    // which chains format parsing + schema validation.
    const data = yield* parseLockfileContent(content, pm, lockfilePath)

    // 7. Build lookup indexes for efficient queries
    const packagesByName = new Map<string, Array<ResolvedPackage>>()
    for (const pkg of data.packages) {
      const existing = packagesByName.get(pkg.name)
      if (existing) {
        existing.push(pkg)
      } else {
        packagesByName.set(pkg.name, [pkg])
      }
    }

    // Build importer index: workspace path -> dependencies
    const importerIndex = new Map<string, Array<WorkspaceDependency>>()
    for (const dep of data.workspaceDependencies) {
      const existing = importerIndex.get(dep.from)
      if (existing) {
        existing.push(dep)
      } else {
        importerIndex.set(dep.from, [dep])
      }
    }

    // Extract catalogs and overrides from PM-specific extensions
    const catalogs = extractCatalogs(data)
    const overridesMap = extractOverrides(data)

    // ── Service implementation ────────────────────────────────

    return {
      lockfileData: () => Effect.succeed(data),

      resolvedVersion: (packageName, specifier) =>
        Effect.gen(function* () {
          const candidates = packagesByName.get(packageName)
          if (!candidates || candidates.length === 0) {
            return yield* Effect.fail(
              new PackageNotInLockfileError({
                packageName,
                manager: pm,
              }),
            )
          }

          // If specifier provided, try to narrow
          if (specifier) {
            const match = candidates.find((c) =>
              // Simplified: check if the specifier appears in deps
              // Real implementation would do semver range matching
              c.version === specifier || candidates.length === 1
            )
            return match ?? candidates[0]!
          }

          return candidates[0]!
        }),

      checkIntegrity: (packageName) =>
        Effect.gen(function* () {
          const candidates = packagesByName.get(packageName)
          if (!candidates || candidates.length === 0) {
            return yield* Effect.fail(
              new PackageNotInLockfileError({
                packageName,
                manager: pm,
              }),
            )
          }
          const pkg = candidates[0]!
          return pkg.integrity
            ? Option.some(pkg.integrity)
            : Option.none()
        }),

      importersFor: (workspacePath) =>
        Effect.succeed(importerIndex.get(workspacePath) ?? []),

      catalogEntries: () => Effect.succeed(catalogs),

      overrides: () => Effect.succeed(overridesMap),
    }
  }),
)
```

### Dynamic parser selection with Layer.unwrapEffect

An alternative construction approach uses `Layer.unwrapEffect` to select
the parser layer dynamically based on the detected PM. This is useful if
the per-PM parsing logic is complex enough to warrant separate layers:

```typescript
/**
 * Alternative: Layer.unwrapEffect for dynamic parser selection.
 *
 * This pattern creates a Layer whose internal behavior is determined
 * at runtime by an Effect. Useful when different PMs need substantially
 * different construction logic.
 */
const LockfileReaderDynamic = Layer.unwrapEffect(
  Effect.gen(function* () {
    const detector = yield* PackageManagerDetector
    const pmInfo = yield* detector.detect()

    // Select parser layer based on detected PM
    switch (pmInfo.packageManager) {
      case "pnpm":
        return PnpmLockfileReaderLayer
      case "npm":
        return NpmLockfileReaderLayer
      case "yarn":
        return YarnLockfileReaderLayer
      case "bun":
        return BunLockfileReaderLayer
    }
  }),
)
// Type: Layer<LockfileReader, ..., PackageManagerDetector | ...>
```

**Trade-off:** This is cleaner when per-PM layers have different
dependencies (e.g., pnpm and yarn need a YAML parser, npm does not).
However, for our case the parsing differences are small enough that a
single `Layer.effect` with an internal `switch` is simpler. Consider
`Layer.unwrapEffect` if the per-PM logic grows to >50 lines each.

### Dependency graph

```text
LockfileReaderLive
  |-- WorkspaceRoot (to find monorepo root)
  |-- PackageManagerDetector (to know which lockfile to read)
  |-- FileSystem.FileSystem (to read lockfile)
  |-- Path.Path (to join paths)
```

### Composite layer wiring

```typescript
import { Layer } from "effect"

// Phase 4 standalone
const LockfileReaderFull = LockfileReaderLive.pipe(
  Layer.provide(Layer.mergeAll(
    WorkspaceRootLive,
    PackageManagerDetectorLive,
  )),
)
// Type: Layer<LockfileReader, E, FileSystem | Path>

// Full stack: all discovery + lockfile
const FullStackLive = Layer.mergeAll(
  WorkspaceRootLive,
  PackageManagerDetectorLive,
  WorkspaceDiscoveryLive,
  LockfileReaderLive,
).pipe(
  Layer.provide(NodeContext.layer), // Users provide this
)
```

## PublishabilityDetector Service

A composable service for detecting which workspace packages are
publishable. Separated from LockfileReader because publishability
is a higher-level concern that combines package.json metadata with
optional lockfile data and custom business rules.

### Interface

```typescript
import type { Effect } from "effect"
import { Context } from "effect"
import type { WorkspacePackage } from "../schemas/core.js"

/**
 * Result of a publishability check for a single package.
 */
interface PublishabilityResult {
  /** The package that was checked. */
  readonly package: WorkspacePackage
  /** Whether the package is publishable. */
  readonly publishable: boolean
  /** Human-readable reason for the determination. */
  readonly reason: string
}

/**
 * Service for detecting which workspace packages are publishable.
 *
 * The default strategy checks:
 * 1. `private` field is not true
 * 2. `publishConfig` exists (optional, strengthens confidence)
 *
 * Users can provide their own layer to override this behavior
 * for monorepos with custom publishing conventions.
 */
export class PublishabilityDetector extends Context.Tag(
  "workspaces-effect/PublishabilityDetector",
)<
  PublishabilityDetector,
  {
    /**
     * Check if a single package is publishable.
     */
    readonly isPublishable: (
      pkg: WorkspacePackage,
    ) => Effect.Effect<PublishabilityResult>

    /**
     * Filter a list of packages to only publishable ones.
     */
    readonly filterPublishable: (
      packages: ReadonlyArray<WorkspacePackage>,
    ) => Effect.Effect<ReadonlyArray<WorkspacePackage>>
  }
>() {}
```

### Default implementation layer

```typescript
/**
 * Default publishability detection strategy.
 *
 * A package is considered publishable if:
 * - `private` is not true (or is absent)
 * - If `publishConfig` is present, it further confirms publishability
 *
 * This layer has no dependencies -- it operates purely on
 * WorkspacePackage data.
 */
export const PublishabilityDetectorDefault: Layer.Layer<
  PublishabilityDetector
> = Layer.succeed(PublishabilityDetector, {
  isPublishable: (pkg) => {
    if (pkg.private) {
      return Effect.succeed({
        package: pkg,
        publishable: false,
        reason: "Package is marked private",
      })
    }
    return Effect.succeed({
      package: pkg,
      publishable: true,
      reason: "Package is not private",
    })
  },

  filterPublishable: (packages) =>
    Effect.gen(function* () {
      const results: Array<WorkspacePackage> = []
      for (const pkg of packages) {
        if (!pkg.private) {
          results.push(pkg)
        }
      }
      return results
    }),
})
```

### Custom implementation example

```typescript
/**
 * Example: custom publishability detector for a monorepo that
 * requires packages to have both a `publishConfig.registry` and
 * a `files` field in package.json.
 *
 * Users provide this instead of PublishabilityDetectorDefault.
 */
const CustomPublishabilityDetector = Layer.succeed(
  PublishabilityDetector,
  {
    isPublishable: (pkg) => {
      // Custom logic using extended package.json fields
      // ...
      return Effect.succeed({ package: pkg, publishable: true, reason: "..." })
    },
    filterPublishable: (packages) =>
      // Custom filtering logic
      Effect.succeed(packages.filter((p) => !p.private)),
  },
)

// Swap in the custom layer
const program = myEffect.pipe(
  Effect.provide(CustomPublishabilityDetector),
)
```

### Why not embed in LockfileReader

PublishabilityDetector is intentionally separate because:

1. **Different data source**: Publishability comes from `package.json`
   metadata, not lockfile data. It depends on WorkspaceDiscovery, not
   LockfileReader.
2. **User-replaceable**: Different monorepos have different conventions
   for what "publishable" means. A separate service Tag lets users
   provide their own layer.
3. **Independent lifecycle**: Publishability detection can be used
   without a lockfile (e.g., in repos that don't commit lockfiles).
4. **Composable**: Consumers can combine LockfileReader +
   PublishabilityDetector when they need both, or use either alone.

## Usage Examples

### Basic lockfile query

```typescript
import { Effect } from "effect"
import { LockfileReader } from "workspaces-effect"

const program = Effect.gen(function* () {
  const lockfile = yield* LockfileReader

  // Get all lockfile data
  const data = yield* lockfile.lockfileData()
  console.log(`${data.packages.length} packages locked by ${data.packageManager}`)

  // Look up a specific package
  const react = yield* lockfile.resolvedVersion("react", "^19.0.0")
  console.log(`react resolved to ${react.version}`)

  // Check integrity
  const integrity = yield* lockfile.checkIntegrity("react")
  // integrity: Option<string>

  // Get workspace importer deps
  const uiDeps = yield* lockfile.importersFor("packages/ui")
  console.log(`packages/ui has ${uiDeps.length} lockfile dependencies`)

  // Get catalogs (pnpm/bun only)
  const catalogs = yield* lockfile.catalogEntries()

  // Get overrides
  const overrides = yield* lockfile.overrides()
})
```

### Error handling at the layer boundary

```typescript
import { Effect, Layer, pipe } from "effect"

// LockfileReaderLive has errors in the Layer E channel.
// Handle them when building the full layer stack:
const SafeLockfileLive = pipe(
  LockfileReaderLive,
  Layer.provide(Layer.mergeAll(
    WorkspaceRootLive,
    PackageManagerDetectorLive,
  )),
  // Catch construction errors and provide a fallback
  Layer.catchAll((error) => {
    // Log the error and provide a no-op lockfile reader
    // that returns empty data for all queries
    return Layer.succeed(LockfileReader, {
      lockfileData: () => Effect.succeed(emptyLockfileData),
      resolvedVersion: (name) =>
        Effect.fail(new PackageNotInLockfileError({ packageName: name, manager: "npm" })),
      checkIntegrity: (name) =>
        Effect.fail(new PackageNotInLockfileError({ packageName: name, manager: "npm" })),
      importersFor: () => Effect.succeed([]),
      catalogEntries: () => Effect.succeed({}),
      overrides: () => Effect.succeed({}),
    })
  }),
)
```

### Combining with PublishabilityDetector

```typescript
const auditProgram = Effect.gen(function* () {
  const lockfile = yield* LockfileReader
  const publishability = yield* PublishabilityDetector
  const discovery = yield* WorkspaceDiscovery

  const allPackages = yield* discovery.listPackages()
  const publishable = yield* publishability.filterPublishable(allPackages)

  // For each publishable package, check lockfile integrity
  for (const pkg of publishable) {
    const deps = yield* lockfile.importersFor(pkg.relativePath)
    console.log(`${pkg.name}: ${deps.length} locked dependencies`)
  }
})
```

## Testing Strategy

### Mock layer for LockfileReader

```typescript
import { Effect, Layer, Option } from "effect"
import { LockfileReader } from "../services/LockfileReader.js"

/**
 * Factory function for creating test LockfileReader layers.
 * Accepts partial overrides for specific methods.
 */
const makeLockfileReaderTest = (
  overrides: Partial<Context.Tag.Service<LockfileReader>> = {},
): Layer.Layer<LockfileReader> =>
  Layer.succeed(LockfileReader, {
    lockfileData: () =>
      Effect.succeed(
        new LockfileData({
          packageManager: "pnpm",
          lockfileVersion: "9.0",
          packages: [],
          workspaceDependencies: [],
        }),
      ),
    resolvedVersion: (name) =>
      Effect.fail(
        new PackageNotInLockfileError({ packageName: name, manager: "pnpm" }),
      ),
    checkIntegrity: (name) =>
      Effect.fail(
        new PackageNotInLockfileError({ packageName: name, manager: "pnpm" }),
      ),
    importersFor: () => Effect.succeed([]),
    catalogEntries: () => Effect.succeed({}),
    overrides: () => Effect.succeed({}),
    ...overrides,
  })
```

### Testing the Live layer with mock FileSystem

```typescript
import { FileSystem, Path } from "@effect/platform"

const MOCK_PNPM_LOCK = `
lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
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
packages:
  react@19.0.0:
    resolution: {integrity: sha512-abc123}
`

const testLiveLayer = LockfileReaderLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(WorkspaceRoot, {
        find: () => Effect.succeed("/project"),
      }),
      Layer.succeed(PackageManagerDetector, {
        detect: () =>
          Effect.succeed({
            root: "/project",
            packageManager: "pnpm" as const,
          }),
      }),
      FileSystem.layerNoop({
        exists: (path) =>
          Effect.succeed(path === "/project/pnpm-lock.yaml"),
        readFileString: (path) => {
          if (path === "/project/pnpm-lock.yaml")
            return Effect.succeed(MOCK_PNPM_LOCK)
          return Effect.die(`unexpected read: ${path}`)
        },
      }),
      Path.layer,
    ),
  ),
)

// Test: resolvedVersion returns correct data
describe("LockfileReaderLive (pnpm)", () => {
  it("resolves a package version from the lockfile", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* LockfileReader
        return yield* reader.resolvedVersion("react")
      }).pipe(Effect.provide(testLiveLayer)),
    )
    expect(result.version).toBe("19.0.0")
    expect(result.integrity).toBe("sha512-abc123")
  })

  it("returns PackageNotInLockfileError for unknown packages", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reader = yield* LockfileReader
        return yield* reader.resolvedVersion("nonexistent")
      }).pipe(Effect.provide(testLiveLayer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

### Test matrix

| Scenario | PM | What to verify |
| --- | --- | --- |
| Parse valid lockfile | pnpm | Packages, workspace deps, catalogs |
| Parse valid lockfile | npm | Packages, workspace link entries |
| Parse valid lockfile | yarn | Packages, workspace: protocol entries |
| Parse valid lockfile | bun | JSONC parsing, tuple decoding, catalogs |
| Missing lockfile | all | `LockfileNotFoundError` at construction |
| Malformed content | all | `LockfileParseError` at construction |
| Unsupported version | pnpm | `LockfileVersionError` for v5.x |
| Unknown package query | all | `PackageNotInLockfileError` from `resolvedVersion` |
| Workspace importer lookup | all | Correct deps returned for path |
| Catalogs (pnpm) | pnpm | Non-empty catalog entries |
| Catalogs (npm) | npm | Empty catalog entries (no error) |
| Overrides | pnpm, npm | Correct override map |
| Integrity check | all | Option.some for registry pkgs, Option.none for workspace |

## Open Questions

1. **Should `importersFor` fail on unknown workspace path?** Current design
   returns an empty array. Alternative: fail with a new error type. The
   empty-array approach is more forgiving and consistent with `catalogEntries`
   and `overrides`. Revisit if consumers need strict validation.

2. **Specifier matching in `resolvedVersion`**: The specifier parameter
   is designed for disambiguation when multiple versions of a package are
   locked (e.g., `react@18.3.0` and `react@19.0.0` in different workspaces).
   The exact matching semantics (exact string match vs. semver range
   satisfaction) need to be decided during implementation.

3. **Should `LockfileVersionError` be separate from `LockfileParseError`?**
   Currently separate because the failure mode is different (the file
   parsed correctly but contains an unsupported version). If this distinction
   proves unnecessary in practice, merge into `LockfileParseError` with a
   `reason` field.

4. **Extended package.json fields for PublishabilityDetector**: RESOLVED
   (2026-04-15). `WorkspacePackage` now includes `publishConfig` field
   (using the `PublishConfig` Schema.Class with `access`, `registry`,
   `directory`, `tag`, `linkDirectory`). `PublishTarget` Schema.Class added
   for resolved publish target metadata. `DetectedPackageManager` now
   includes `runtime: "node" | "bun"` field.

5. **Effect.Service migration timing**: RESOLVED (2026-03-14). Not migrating.
   `Context.Tag` + `Layer.effect` is the established pattern. `Effect.Service`
   doesn't exist as documented.
