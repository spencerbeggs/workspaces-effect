# Lockfile parsing

workspaces-effect parses lockfiles from all four package managers into one schema. Once parsed, you query resolved versions, workspace dependencies and integrity through the same API regardless of which package manager wrote the file.

## Table of contents

- [Supported formats](#supported-formats)
- [Reading lockfile data](#reading-lockfile-data)
- [Querying resolved versions](#querying-resolved-versions)
- [Workspace dependencies](#workspace-dependencies)
- [Integrity checking](#integrity-checking)
- [PM-specific extensions](#pm-specific-extensions)
- [Error handling](#error-handling)
- [Lazy initialization](#lazy-initialization)

## Supported formats

| Package manager | Lockfile | Format |
| --- | --- | --- |
| pnpm | `pnpm-lock.yaml` | YAML |
| npm | `package-lock.json` | JSON |
| yarn Berry | `yarn.lock` | Custom (v2+ format) |
| bun | `bun.lock` | JSONC |

The parser is chosen from the detected package manager. You do not pass the format.

## Reading lockfile data

The `LockfileReader` service is the entry point. Ask it for the parsed lockfile:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { LockfileReader, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const reader = yield* LockfileReader;
  const lockfile = yield* reader.readLockfile();

  console.log(`Package manager: ${lockfile.packageManager}`);
  // example output: Package manager: pnpm
  console.log(`Lockfile version: ${lockfile.lockfileVersion}`);
  // example output (varies): Lockfile version: 9.0
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

## Querying resolved versions

Look up the exact version a dependency resolved to:

```typescript
import { Option } from "effect";

const react = yield* reader.resolvedVersion("react");
// Option.some(ResolvedPackage) or Option.none()

if (Option.isSome(react)) {
  console.log(`react@${react.value.version}`);
  // example output: "react@<resolved-version>"

  if (react.value.integrity) {
    console.log(`integrity: ${react.value.integrity}`);
  }
}
```

Use this to audit exact versions across a monorepo, or to confirm that every package resolves a shared dependency to the same version.

## Workspace dependencies

List the workspace-to-workspace dependency links recorded in the lockfile:

```typescript
const wsDeps = yield* reader.workspaceDependencies();
for (const dep of wsDeps) {
  console.log(`${dep.from} -> ${dep.to} (${dep.depType}: ${dep.constraint})`);
}
// example output (varies):
// @myorg/app -> @myorg/ui (dependencies: workspace:*)
// @myorg/ui -> @myorg/core (dependencies: workspace:^1.0.0)
```

Each `WorkspaceDependency` contains:

| Field | Type | Description |
| --- | --- | --- |
| `from` | `string` | Package that declares the dependency |
| `to` | `string` | Package that is depended upon |
| `depType` | `"dependencies" \| "devDependencies" \| "peerDependencies" \| "optionalDependencies"` | Dependency type |
| `constraint` | `string` | Version constraint (e.g. `"workspace:*"`, `"^1.0.0"`) |

## Integrity checking

Verify that the lockfile is in sync with the current `package.json` files. `checkIntegrity()` compares each workspace's declared dependencies against what the lockfile resolved:

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

Each unsatisfied constraint has: `workspace`, `dependency`, `constraint`, `resolved` and `depType`.

`LockfileIntegrity` is the report. `LockfileIntegrityError` means the check could not run at all. A mismatch between lockfile and `package.json` is data, not a thrown error.

## PM-specific extensions

Some lockfile data only exists for one package manager. Read it from `LockfileData.pmSpecific`, a discriminated union on `_tag`.

### pnpm extensions

pnpm lockfiles may include catalogs, overrides and settings:

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

The `PnpmExtension.catalogs` value type is `string | { specifier: string; version: string }`. Older pnpm versions store catalog entries as plain version strings. pnpm v9+ stores them as objects holding both the declared specifier and the resolved version.

### bun extensions

Bun lockfiles may include catalogs, overrides and trusted dependencies:

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

## Error handling

Lockfile operations fail in two layers. Initialization failures — root discovery, package-manager detection, lockfile read, lockfile parse — surface from the **first** call to any `LockfileReader` method as a member of the exported `LockfileInitError` union:

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

`LockfileReadError` carries `lockfilePath` and `reason`. `LockfileParseError` carries `lockfilePath`, `format` and `cause`. `LockfileIntegrityError` carries `reason` and `cause`.

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

`checkIntegrity()` widens the error channel to `LockfileInitError | LockfileIntegrityError`.

See [Troubleshooting](./09-troubleshooting.md) for solutions to specific failures.

## Lazy initialization

`LockfileReaderLive` defers every filesystem operation (workspace-root discovery, package-manager detection, lockfile read and lockfile parse) until the first call to `readLockfile`, `resolvedVersion`, `workspaceDependencies` or `checkIntegrity`. `Effect.cached` memoizes the result for the life of the layer instance, so later calls reuse the parsed data.

What this means in practice:

- **Layer construction is O(1).** Building the layer via `Effect.provide(WorkspacesLive)` does no filesystem work. A program that composes the layer but never calls a `LockfileReader` method pays nothing.
- **Errors surface from the first method call**, as members of the exported `LockfileInitError` union. Each `LockfileReader` method lists `LockfileInitError` in its E channel, so error handling sits at the call site instead of around `Effect.provide`.
- **Success and failure are both memoized.** If the first call fails because the lockfile cannot be parsed, every later call on the same layer instance fails with the same error. Build a fresh layer instance to retry.
- **The Layer E channel is `never`.** All four `LockfileInitError` variants (`WorkspaceRootNotFoundError`, `PackageManagerDetectionError`, `LockfileReadError`, `LockfileParseError`) appear on each method's E channel. `WorkspaceDiscoveryLive` defers its default-root walk the same way and has a `never` E channel.

Layers built per call site — Vitest reporters with multiple projects, CLIs that compose layers per subcommand, tests that swap layers between cases — pay the read and parse cost once per layer instance rather than once per construction.
