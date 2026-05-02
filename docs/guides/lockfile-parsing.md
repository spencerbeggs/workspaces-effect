# Lockfile Parsing

workspaces-effect reads and parses lockfiles from all four package managers into
a unified schema, enabling cross-PM queries for resolved versions, workspace
dependencies, and integrity checks.

## Table of Contents

- [Supported Formats](#supported-formats)
- [Reading Lockfile Data](#reading-lockfile-data)
- [Querying Resolved Versions](#querying-resolved-versions)
- [Workspace Dependencies](#workspace-dependencies)
- [Integrity Checking](#integrity-checking)
- [PM-Specific Extensions](#pm-specific-extensions)
- [Error Handling](#error-handling)
- [Lazy Initialization](#lazy-initialization)

## Supported Formats

| Package Manager | Lockfile | Format |
| --- | --- | --- |
| pnpm | `pnpm-lock.yaml` | YAML |
| npm | `package-lock.json` | JSON |
| yarn Berry | `yarn.lock` | Custom (v2+ format) |
| bun | `bun.lock` | JSONC |

The correct parser is selected automatically based on the detected package
manager. You do not need to specify the format.

## Reading Lockfile Data

The `LockfileReader` service provides access to parsed lockfile data:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { LockfileReader, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const reader = yield* LockfileReader;
  const lockfile = yield* reader.readLockfile();

  console.log(`Package manager: ${lockfile.packageManager}`);
  console.log(`Lockfile version: ${lockfile.lockfileVersion}`);
  console.log(`Total resolved packages: ${lockfile.packages.length}`);
  console.log(`Workspace dep links: ${lockfile.workspaceDependencies.length}`);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

The `LockfileData` schema contains:

| Field | Type | Description |
| --- | --- | --- |
| `packageManager` | `"npm" \| "pnpm" \| "yarn" \| "bun"` | Which PM produced the lockfile |
| `lockfileVersion` | `string` | The lockfile format version |
| `packages` | `ReadonlyArray<ResolvedPackage>` | All resolved packages |
| `workspaceDependencies` | `ReadonlyArray<WorkspaceDependency>` | Inter-workspace dependency links |
| `pmSpecific` | `PnpmExtension \| BunExtension \| undefined` | PM-specific data |

Each `ResolvedPackage` contains:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Package name |
| `version` | `string` | Resolved version |
| `integrity` | `string \| undefined` | SRI integrity hash |
| `isWorkspace` | `boolean` | Whether this is a workspace-local package |
| `relativePath` | `string \| undefined` | Workspace-relative path (for workspace packages) |
| `dependencies` | `Record<string, string>` | This package's own resolved dependencies |

## Querying Resolved Versions

Look up the exact version a dependency resolved to:

```typescript
import { Option } from "effect";

const react = yield* reader.resolvedVersion("react");
// Option.some(ResolvedPackage) or Option.none()

if (Option.isSome(react)) {
  console.log(`react@${react.value.version}`);
  // "react@19.1.0"

  if (react.value.integrity) {
    console.log(`integrity: ${react.value.integrity}`);
  }
}
```

This is useful for auditing exact versions across your monorepo or verifying
that all packages resolve to the same version of a shared dependency.

## Workspace Dependencies

Get all workspace-to-workspace dependency links as declared in the lockfile:

```typescript
const wsDeps = yield* reader.workspaceDependencies();
for (const dep of wsDeps) {
  console.log(`${dep.from} -> ${dep.to} (${dep.depType}: ${dep.constraint})`);
}
// @myorg/app -> @myorg/ui (dependencies: workspace:*)
// @myorg/ui -> @myorg/core (dependencies: workspace:^1.0.0)
```

Each `WorkspaceDependency` contains:

| Field | Type | Description |
| --- | --- | --- |
| `from` | `string` | Package that declares the dependency |
| `to` | `string` | Package that is depended upon |
| `depType` | `"dependencies" \| "devDependencies" \| "peerDependencies" \| "optionalDependencies"` | Dependency type |
| `constraint` | `string` | Version constraint (e.g., `"workspace:*"`, `"^1.0.0"`) |

## Integrity Checking

Verify that the lockfile is consistent with current `package.json` files. The
integrity check compares workspace declarations against what the lockfile
records:

```typescript
const integrity = yield* reader.checkIntegrity();

if (integrity.valid) {
  console.log("Lockfile is in sync with package.json files");
} else {
  if (integrity.missingWorkspaces.length > 0) {
    console.log("Missing from lockfile:", integrity.missingWorkspaces);
  }
  if (integrity.extraWorkspaces.length > 0) {
    console.log("In lockfile but not workspace:", integrity.extraWorkspaces);
  }
  for (const c of integrity.unsatisfiedConstraints) {
    console.log(
      `${c.workspace}: ${c.dependency} wants ${c.constraint} but got ${c.resolved} (${c.depType})`,
    );
  }
}
```

The `LockfileIntegrity` schema contains:

| Field | Type | Description |
| --- | --- | --- |
| `valid` | `boolean` | `true` if fully consistent |
| `missingWorkspaces` | `string[]` | Workspace packages absent from lockfile |
| `extraWorkspaces` | `string[]` | Lockfile entries not in any workspace |
| `unsatisfiedConstraints` | `array` | Dependency constraints not satisfied by resolved versions |

Each unsatisfied constraint has: `workspace`, `dependency`, `constraint`,
`resolved`, and `depType`.

Note the distinction between `LockfileIntegrity` (the data report) and
`LockfileIntegrityError` (which means the check itself could not run).
Mismatches are reported in the data, not thrown as errors.

## PM-Specific Extensions

Some lockfile data is specific to a package manager. Access it through the
`pmSpecific` discriminated union field on `LockfileData`.

### pnpm Extensions

pnpm lockfiles may include catalogs, overrides, and settings:

```typescript
const lockfile = yield* reader.readLockfile();
if (lockfile.pmSpecific?._tag === "pnpm") {
  const { catalogs, overrides, settings } = lockfile.pmSpecific;

  // Catalogs: named groups of version constraints (pnpm v9+ feature)
  if (catalogs) {
    for (const [catalogName, entries] of Object.entries(catalogs)) {
      for (const [pkgName, value] of Object.entries(entries)) {
        // value is either a string (version) or { specifier, version }
        // pnpm v9+ uses the { specifier, version } format
        if (typeof value === "string") {
          console.log(`${catalogName}/${pkgName}: ${value}`);
        } else {
          console.log(`${catalogName}/${pkgName}: ${value.specifier} -> ${value.version}`);
        }
      }
    }
  }

  // Overrides: version override map from pnpm.overrides
  if (overrides) {
    console.log("Overrides:", overrides);
  }

  // Settings: pnpm lockfile header settings
  if (settings) {
    console.log("Auto-install peers:", settings.autoInstallPeers);
  }
}
```

The `PnpmExtension.catalogs` value type is a union:
`string | { specifier: string; version: string }`. Older pnpm versions store
catalog entries as plain version strings. pnpm v9+ stores them as objects with
both the specifier (what was declared) and the resolved version.

### bun Extensions

Bun lockfiles may include catalogs, overrides, and trusted dependencies:

```typescript
if (lockfile.pmSpecific?._tag === "bun") {
  const { catalog, catalogs, overrides, trustedDependencies } = lockfile.pmSpecific;

  // catalog: the default (unnamed) catalog
  if (catalog) {
    console.log("Default catalog:", catalog);
  }

  // catalogs: named catalog definitions
  if (catalogs) {
    console.log("Named catalogs:", Object.keys(catalogs));
  }

  // trustedDependencies: packages allowed to run install scripts
  if (trustedDependencies) {
    console.log("Trusted deps:", trustedDependencies);
  }
}
```

## Error Handling

Lockfile operations can fail with several error types. Initialization
failures (root discovery, package-manager detection, lockfile read, lockfile
parse) surface from the **first** call to any `LockfileReader` method as a
member of the exported `LockfileInitError` union:

```typescript
import type { LockfileInitError } from "workspaces-effect";

// LockfileInitError =
//   | WorkspaceRootNotFoundError
//   | PackageManagerDetectionError
//   | LockfileReadError
//   | LockfileParseError
```

| Error | Cause | Where it surfaces |
| --- | --- | --- |
| `WorkspaceRootNotFoundError` | No workspace root found from `process.cwd()` | First method call (member of `LockfileInitError`) |
| `PackageManagerDetectionError` | Cannot determine PM type at the resolved root | First method call (member of `LockfileInitError`) |
| `LockfileReadError` | Lockfile does not exist or cannot be read from disk | First method call (member of `LockfileInitError`) |
| `LockfileParseError` | Lockfile exists but contains invalid or unparseable content | First method call (member of `LockfileInitError`) |
| `LockfileIntegrityError` | Integrity check itself cannot complete | `checkIntegrity()` only |

`LockfileReadError` has `lockfilePath` and `reason` fields.
`LockfileParseError` has `lockfilePath`, `format`, and `cause` fields.
`LockfileIntegrityError` has `reason` and `cause` fields.

```typescript
const program = Effect.gen(function* () {
  const reader = yield* LockfileReader;
  return yield* reader.readLockfile();
}).pipe(
  Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
    Effect.logWarning(`No workspace root: ${e.reason}`),
  ),
  Effect.catchTag("PackageManagerDetectionError", (e) =>
    Effect.logWarning(`PM detection failed: ${e.reason}`),
  ),
  Effect.catchTag("LockfileReadError", (e) =>
    Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`),
  ),
  Effect.catchTag("LockfileParseError", (e) =>
    Effect.logError(`Cannot parse ${e.format} lockfile at ${e.lockfilePath}`),
  ),
);
```

`checkIntegrity()` widens the error channel further:
`LockfileInitError | LockfileIntegrityError`.

See [Troubleshooting](../troubleshooting.md) for detailed solutions.

## Lazy Initialization

`LockfileReaderLive` defers all I/O (workspace-root discovery, package-manager
detection, lockfile read, and lockfile parse) until the first call to
`readLockfile`, `resolvedVersion`, `workspaceDependencies`, or
`checkIntegrity`. The result is memoized for the lifetime of the layer
instance via `Effect.cached`, so subsequent calls reuse the cached parse.

The practical implications:

- **Layer construction is O(1).** Building the layer (e.g., via
  `Effect.provide(WorkspacesLive)`) performs no filesystem work. Programs that
  compose the layer but never invoke a `LockfileReader` method pay nothing.
- **Errors surface from the first method call**, not from
  `Effect.provide(LockfileReaderLive)`. Code that previously relied on
  construction-time failure (for example, by handling errors in a wrapper
  around `Layer.provide`) must move its handling to the call site.
- **Both success and failure are memoized.** If the first call fails because
  the lockfile cannot be parsed, every subsequent call on the same layer
  instance fails with the same error. Build a fresh layer instance to retry.
- **The Layer E channel is `never`.** The error variants previously listed on
  `LockfileReaderLive` (`LockfileReadError`, `LockfileParseError`, and the
  others above) now appear on each method's E channel as `LockfileInitError`
  variants. `WorkspaceDiscoveryLive` similarly defers its default-root walk
  and now has an E channel of `never`.

This change exists primarily to benefit consumers that build the layer per
call site (Vitest reporters with multiple projects, CLIs that compose layers
per subcommand, tests that swap layers between cases) -- the previous eager
construction paid the read/parse cost N times for N layer instances. See
GitHub issue #60 for context.
