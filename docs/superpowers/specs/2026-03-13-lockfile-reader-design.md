# LockfileReader Service Design

## Overview

Phase 4 of `@spencerbeggs/workspaces-effect` adds lockfile reading and
PM-specific configuration parsing. The `LockfileReader` service provides a
unified interface for reading lockfiles from all 4 supported package managers
(pnpm, npm, yarn Berry, bun), querying resolved dependency state, and checking
lockfile/package.json consistency.

### Use Cases

- CI/CD pipelines needing exact resolved versions without running `install`
- Dependency audit and license compliance tools
- Change impact analysis considering version constraints
- Workspace-aware dependency deduplication analysis
- Detecting stale lockfiles that don't match `package.json`

### Dependencies

| Package | Version | Purpose |
| --------- | --------- | --------- |
| `jsonc-effect` | `^0.1.0` | JSONC parsing for `bun.lock` |
| `semver-effect` | `^0.1.0` | Version constraint satisfaction |
| `yaml` | `^2.8.0` | YAML parsing for `pnpm-lock.yaml` and `yarn.lock` |

All three are pure Effect-compatible libraries. `jsonc-effect` and
`semver-effect` are sibling repos with `effect` as their only runtime
dependency.

### Supersedes

This spec supersedes the earlier drafts in
`.claude/design/lockfile-reader-service.md` and refines
`.claude/design/phase4-configuration-lockfiles.md`. Key departures:

- **Simplified interface**: 4 methods instead of 6. Dropped
  `importersFor()`, `catalogEntries()`, `overrides()` — consumers
  access PM-specific data via `readLockfile().pmSpecific` instead
  of dedicated methods. This reduces API surface and avoids
  PM-specific methods that only apply to pnpm/bun.
- **`resolvedVersion()` returns `Option`** instead of failing with
  `PackageNotInLockfileError`. Absence is normal for lockfile
  lookups, not exceptional.
- **Error hierarchy simplified**: `LockfileReadError` replaces
  `LockfileNotFoundError`. `LockfileVersionError` is folded into
  `LockfileParseError` (unsupported versions produce a parse error
  with descriptive `cause`). `LockfileIntegrityError` is new.
- **`optionalDependencies`** added to all dep type enumerations
  (missing from the earlier Phase 4 design doc).

## File Layout

```text
src/
├── services/
│   └── LockfileReader.ts              # Service interface (Context.Tag)
├── layers/
│   ├── LockfileReaderLive.ts          # Layer: orchestration, caching, dispatch
│   ├── LockfileReaderLive.test.ts     # Integration tests for all 4 formats
│   ├── ConfigurationLive.ts           # Composite layer + FullConfigLive
│   ├── parsers/
│   │   ├── pnpm.ts                    # parsePnpmLockfile → LockfileData
│   │   ├── pnpm.test.ts
│   │   ├── npm.ts                     # parseNpmLockfile → LockfileData
│   │   ├── npm.test.ts
│   │   ├── yarn.ts                    # parseYarnLockfile → LockfileData
│   │   ├── yarn.test.ts
│   │   ├── bun.ts                     # parseBunLockfile → LockfileData
│   │   ├── bun.test.ts
│   │   └── shared.ts               # extractWorkspaceDeps, etc.
│   ├── integrity.ts                # checkLockfileIntegrity
│   └── integrity.test.ts
├── schemas/
│   └── lockfile.ts                    # LockfileData, ResolvedPackage, etc.
├── errors/
│   └── lockfile.ts                 # LockfileReadError, etc.
```

### Module Boundaries

- **Parsers** are pure functions: `(content: string, lockfilePath: string) =>
  Effect<LockfileData, LockfileParseError>`. No service dependencies.
  Independently testable with fixture strings.
- **Integrity** is a standalone function (not a Layer, not in Context):
  `(lockfileData, root, fs, path) =>
  Effect<LockfileIntegrity, LockfileIntegrityError>`. Receives platform
  services as explicit arguments. Uses `semver-effect` for constraint
  checking. Performs I/O (reads `package.json` files).
- **LockfileReaderLive** is orchestration only: reads the file, dispatches to
  the right parser, runs integrity checks.

## Service Interface

```typescript
class LockfileReader extends Context.Tag(
  "@spencerbeggs/workspaces-effect/LockfileReader"
)<
  LockfileReader,
  {
    /** Full parsed lockfile data (cached from construction). */
    readonly readLockfile: () => Effect.Effect<LockfileData>

    /** Lookup a specific package's resolved version. */
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<Option.Option<ResolvedPackage>>

    /** All inter-workspace dependency relationships. */
    readonly workspaceDependencies: () => Effect.Effect<
      ReadonlyArray<WorkspaceDependency>
    >

    /** Check lockfile/package.json consistency. */
    readonly checkIntegrity: () => Effect.Effect<
      LockfileIntegrity,
      LockfileIntegrityError
    >
  }
>() {}
```

### Design Rationale

- `readLockfile()`, `resolvedVersion()`, `workspaceDependencies()` have **no
  error channel**. The lockfile is parsed eagerly at layer construction and
  cached. These methods are pure lookups against cached data.
- `resolvedVersion()` returns `Option` rather than failing. "Package not in
  lockfile" is absence, not an error.
- `checkIntegrity()` has an error channel because it reads `package.json`
  files at call time (via FileSystem captured at layer construction).

### Layer Type Signature

```typescript
const LockfileReaderLive: Layer.Layer<
  LockfileReader,
  LockfileReadError | LockfileParseError,
  WorkspaceRoot | PackageManagerDetector | FileSystem.FileSystem | Path.Path
>
```

Errors in the E channel because the lockfile must exist and parse at
construction time. This matches `DependencyGraphLive` and
`TopologicalSorterLive` patterns. The service is independent of
`WorkspaceDiscovery` — shared utilities can be extracted if needed.

## Schemas

### Unified Data Model

```typescript
class ResolvedPackage extends Schema.Class<ResolvedPackage>(
  "ResolvedPackage"
)({
  name: Schema.NonEmptyString,
  version: Schema.String,
  integrity: Schema.optional(Schema.String),
  isWorkspace: Schema.Boolean,
  dependencies: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { default: () => ({}) },
  ),
}) {}

class WorkspaceDependency extends Schema.Class<WorkspaceDependency>(
  "WorkspaceDependency"
)({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  depType: Schema.Literal(
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ),
  constraint: Schema.String,
}) {}

class LockfileData extends Schema.Class<LockfileData>(
  "LockfileData"
)({
  packageManager: PackageManager,
  lockfileVersion: Schema.String,
  packages: Schema.Array(ResolvedPackage),
  workspaceDependencies: Schema.Array(WorkspaceDependency),
  pmSpecific: Schema.optional(Schema.Union(
    PnpmExtension,
    BunExtension,
  )),
}) {}
```

### PM-Specific Extensions

```typescript
class PnpmExtension extends Schema.Class<PnpmExtension>(
  "PnpmExtension"
)({
  _tag: Schema.Literal("pnpm"),
  catalogs: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: Schema.String }),
  })),
  overrides: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  settings: Schema.optional(Schema.Struct({
    autoInstallPeers: Schema.optional(Schema.Boolean),
    excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
  })),
}) {}

class BunExtension extends Schema.Class<BunExtension>(
  "BunExtension"
)({
  _tag: Schema.Literal("bun"),
  catalog: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  catalogs: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  })),
  overrides: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
}) {}
```

Uses `_tag` discriminant for `Schema.Union` dispatch. npm and yarn don't
have extension-worthy PM-specific features yet.

### Integrity Result

```typescript
class LockfileIntegrity extends Schema.Class<LockfileIntegrity>(
  "LockfileIntegrity"
)({
  valid: Schema.Boolean,
  missingWorkspaces: Schema.Array(Schema.String),
  extraWorkspaces: Schema.Array(Schema.String),
  unsatisfiedConstraints: Schema.Array(Schema.Struct({
    workspace: Schema.String,
    dependency: Schema.String,
    constraint: Schema.String,
    resolved: Schema.String,
    depType: Schema.Literal(
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ),
  })),
}) {}
```

Structured result rather than boolean. Consumers can inspect exactly what's
wrong.

## Error Types

```typescript
/** @internal */
export const LockfileReadErrorBase = Data.TaggedError("LockfileReadError");

export class LockfileReadError extends LockfileReadErrorBase<{
  readonly lockfilePath: string;
  readonly reason: string;
}> {
  get message(): string {
    return `Failed to read lockfile at ${this.lockfilePath}: ${this.reason}`;
  }
}

/** @internal */
export const LockfileParseErrorBase = Data.TaggedError("LockfileParseError");

export class LockfileParseError extends LockfileParseErrorBase<{
  readonly lockfilePath: string;
  readonly format: "pnpm" | "npm" | "yarn" | "bun";
  readonly cause: unknown;
}> {
  get message(): string {
    return `Failed to parse ${this.format} lockfile at ${this.lockfilePath}`;
  }
}

/** @internal */
export const LockfileIntegrityErrorBase = Data.TaggedError("LockfileIntegrityError");

export class LockfileIntegrityError extends LockfileIntegrityErrorBase<{
  readonly reason: string;
  readonly cause: unknown;
}> {
  get message(): string {
    return `Integrity check failed: ${this.reason}`;
  }
}
```

### When Each Fires

- **`LockfileReadError`** — lockfile doesn't exist or can't be read. Layer
  construction (E channel).
- **`LockfileParseError`** — lockfile exists but content is malformed. Layer
  construction (E channel).
- **`LockfileIntegrityError`** — `checkIntegrity()` can't complete (e.g.,
  workspace `package.json` unreadable). Distinct from integrity *failures*
  (which are data in `LockfileIntegrity.valid = false`).

## Parser Module Design

### Shared Utilities (`parsers/shared.ts`)

```typescript
/** Extract workspace inter-dependencies from workspace entries. */
export const extractWorkspaceDeps = (
  workspaces: Map<string, {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  }>,
  workspaceNames: Set<string>,
): ReadonlyArray<WorkspaceDependency>

/** Detect if a version specifier refers to a workspace package. */
export const isWorkspaceSpecifier = (specifier: string): boolean
// Matches: "workspace:*", "workspace:^", "link:", "file:", path references

/** Normalize package name from lockfile key formats. */
export const normalizePackageName = (key: string, format: string): string
```

### Per-PM Parser Signatures

```typescript
// Each is a pure function: string → Effect<LockfileData, LockfileParseError>

export const parsePnpmLockfile: (
  content: string, lockfilePath: string,
) => Effect.Effect<LockfileData, LockfileParseError>
// Uses: yaml → Schema.decodeUnknown(PnpmLockfileRaw) → transform

export const parseNpmLockfile: (
  content: string, lockfilePath: string,
) => Effect.Effect<LockfileData, LockfileParseError>
// Uses: JSON.parse → Schema.decodeUnknown(NpmLockfileRaw) → transform

export const parseYarnLockfile: (
  content: string, lockfilePath: string,
) => Effect.Effect<LockfileData, LockfileParseError>
// Uses: yaml → Schema.decodeUnknown(YarnLockfileRaw) → transform

export const parseBunLockfile: (
  content: string, lockfilePath: string,
) => Effect.Effect<LockfileData, LockfileParseError>
// Uses: makeJsoncSchema(BunLockfileRaw) from jsonc-effect → transform
```

### Parsing Pipeline (consistent 3-step pattern)

```typescript
export const parsePnpmLockfile = (content: string, lockfilePath: string) =>
  Effect.gen(function* () {
    // Step 1: Parse raw content to JS object
    const raw = yield* Effect.try({
      try: () => YAML.parse(content),
      catch: (e) => new LockfileParseError({
        lockfilePath, format: "pnpm", cause: e,
      }),
    })

    // Step 2: Validate against PM-specific raw schema
    const validated = yield* Schema.decodeUnknown(PnpmLockfileRaw)(raw).pipe(
      Effect.mapError((e) => new LockfileParseError({
        lockfilePath, format: "pnpm", cause: e,
      })),
    )

    // Step 3: Transform to unified LockfileData
    return toLockfileData(validated)
  })
```

Bun combines steps 1+2 via `makeJsoncSchema(BunLockfileRaw)` from
`jsonc-effect`. Raw schemas are internal to each parser module (not exported).

## Layer Construction

```typescript
export const LockfileReaderLive = Layer.effect(
  LockfileReader,
  Effect.gen(function* () {
    // 1. Resolve dependencies eagerly
    const rootService = yield* WorkspaceRoot;
    const detector = yield* PackageManagerDetector;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // 2. Find root and detect PM
    const root = yield* rootService.root();
    const pm = yield* detector.detect();

    // 3. Resolve lockfile path
    const lockfilePath = path.join(root, lockfileNameFor(pm));

    // 4. Read lockfile (LockfileReadError if missing)
    const content = yield* fs
      .readFileString(lockfilePath)
      .pipe(
        Effect.mapError(() => new LockfileReadError({
          lockfilePath,
          reason: "file not found or unreadable",
        })),
      );

    // 5. Parse and cache (LockfileParseError if malformed)
    const lockfileData = yield* parseLockfile(
      content, lockfilePath, pm,
    );

    // 6. Build lookup index (multi-version aware)
    const packageIndex = new Map<
      string,
      Array<ResolvedPackage>
    >();
    for (const pkg of lockfileData.packages) {
      const existing = packageIndex.get(pkg.name) ?? [];
      existing.push(pkg);
      packageIndex.set(pkg.name, existing);
    }

    // 7. Return service — all methods query cached data
    return {
      readLockfile: () => Effect.succeed(lockfileData),

      resolvedVersion: (packageName: string) =>
        Effect.succeed(
          Option.fromNullable(
            packageIndex.get(packageName)?.[0],
          ),
        ),

      workspaceDependencies: () =>
        Effect.succeed(lockfileData.workspaceDependencies),

      checkIntegrity: () =>
        checkLockfileIntegrity(lockfileData, root, fs, path),
    };
  }),
);
```

## Integrity Checking

```typescript
export const checkLockfileIntegrity = (
  lockfileData: LockfileData,
  root: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) => Effect.gen(function* () {
  // 1. Read package.json for each workspace package (concurrent)
  const workspacePackages = lockfileData.packages.filter((p) => p.isWorkspace);
  const packageJsons = yield* Effect.forEach(
    workspacePackages,
    (pkg) => readWorkspacePackageJson(fs, path, root, pkg),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError((e) => new LockfileIntegrityError({
      reason: `Failed to read workspace package.json: ${e}`,
      cause: e,
    })),
  );

  // 2. Check workspace presence
  const lockfileWorkspaceNames = new Set(workspacePackages.map((p) => p.name));
  const packageJsonNames = new Set(packageJsons.map(([name]) => name));
  const missingWorkspaces = [...packageJsonNames]
    .filter((name) => !lockfileWorkspaceNames.has(name));
  const extraWorkspaces = [...lockfileWorkspaceNames]
    .filter((name) => !packageJsonNames.has(name));

  // 3. Check constraint satisfaction with semver-effect
  const unsatisfiedConstraints = yield* checkConstraints(
    lockfileData, packageJsons,
  ).pipe(
    Effect.mapError((e) => new LockfileIntegrityError({
      reason: `Semver constraint check failed: ${e}`,
      cause: e,
    })),
  );

  return new LockfileIntegrity({
    valid: missingWorkspaces.length === 0
      && extraWorkspaces.length === 0
      && unsatisfiedConstraints.length === 0,
    missingWorkspaces,
    extraWorkspaces,
    unsatisfiedConstraints,
  });
});
```

### Constraint Checking

Uses `Range.fromString` and `Range.satisfies` from `semver-effect`:

- Iterates all 4 dep types: `dependencies`, `devDependencies`,
  `peerDependencies`, `optionalDependencies`
- Skips workspace specifiers (`workspace:*`, `link:`, `file:`)
- Skips unparseable constraints (git URLs, `latest`, `*`)
- Reports mismatches where resolved version doesn't satisfy the constraint

## Composite Layer & Exports

### Composite Layer

```typescript
/** All Phase 4 services. */
export const ConfigurationLive = LockfileReaderLive;

/** Full stack: Discovery + Configuration. */
export const FullConfigLive = ConfigurationLive.pipe(
  Layer.provide(DiscoveryLive),
);
```

### Public Exports (additions to `src/index.ts`)

```typescript
// Errors
export { LockfileReadError, LockfileParseError, LockfileIntegrityError }
// Services
export { LockfileReader }
// Layers
export { LockfileReaderLive, ConfigurationLive, FullConfigLive }
// Schemas
export {
  LockfileData, ResolvedPackage, WorkspaceDependency,
  LockfileIntegrity, PnpmExtension, BunExtension,
}
```

### Internal (Not Exported)

- Raw PM-specific schemas
- Parser functions
- Shared parser utilities
- `checkLockfileIntegrity`
- Base error constants

## Testing Strategy

### Test Matrix

| Test file | Covers | Mocking |
| ----------- | -------- | --------- |
| `parsers/pnpm.test.ts` | pnpm, catalogs, ws deps | None |
| `parsers/npm.test.ts` | npm v3, workspace links | None |
| `parsers/yarn.test.ts` | yarn Berry, workspace:* | None |
| `parsers/bun.test.ts` | bun JSONC, tuple format | None |
| `integrity.test.ts` | Constraints, missing/extra | FileSystem |
| `LockfileReaderLive.test.ts` | Full integration, errors | Services |

### Parser Tests

Use inline fixture strings. Also use real fixtures from
`src/test-fixtures/lockfiles/` for integration-style tests.

### Layer Tests

Mock all dependencies using existing patterns: `Layer.succeed` for services,
`FileSystem.layerNoop` for file system, `Path.layer` for path.

### Coverage Targets

- Each PM format: parse, workspace deps, resolved versions, PM-specific
  extensions
- Error cases: missing lockfile, malformed content
- Integrity: valid match, missing workspaces, extra workspaces, unsatisfied
  constraints, skipped specifiers, all 4 dep types
