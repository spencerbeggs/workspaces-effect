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
- [Error Handling](#error-handling)

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
  console.log(`Total resolved packages: ${lockfile.packages.length}`);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

The `LockfileData` schema includes:

- `packageManager` -- which PM produced the lockfile
- `lockfileVersion` -- the lockfile format version
- `packages` -- all resolved packages with name, version, and integrity hash
- PM-specific extensions (e.g., pnpm overrides, bun workspace config)

## Querying Resolved Versions

Look up the exact version a dependency resolved to:

```typescript
const react = yield* reader.resolvedVersion("react");
// Option.some({ name: "react", version: "19.1.0", integrity: "sha512-..." })
// or Option.none() if not in lockfile

import { Option } from "effect";

if (Option.isSome(react)) {
  console.log(`react@${react.value.version}`);
}
```

This is useful for auditing exact versions across your monorepo or verifying
that all packages use the same version of a shared dependency.

## Workspace Dependencies

Get all workspace-to-workspace dependency links as declared in the lockfile:

```typescript
const wsDeps = yield* reader.workspaceDependencies();
for (const dep of wsDeps) {
  console.log(`${dep.from} -> ${dep.to} (${dep.type})`);
}
// @myorg/app -> @myorg/ui (dependencies)
// @myorg/ui -> @myorg/core (dependencies)
```

## Integrity Checking

Verify that the lockfile is consistent with the current package.json files:

```typescript
const integrity = yield* reader.checkIntegrity();

if (integrity.valid) {
  console.log("Lockfile is in sync with package.json files");
} else {
  console.log("Issues found:");
  for (const issue of integrity.issues) {
    console.log(`  - ${issue}`);
  }
}
```

## Error Handling

Lockfile operations can fail with three error types:

| Error | Cause |
| --- | --- |
| `LockfileReadError` | Lockfile does not exist or cannot be read |
| `LockfileParseError` | Lockfile exists but contains invalid content |
| `LockfileIntegrityError` | Integrity check itself cannot complete |

```typescript
const program = Effect.gen(function* () {
  const reader = yield* LockfileReader;
  return yield* reader.readLockfile();
}).pipe(
  Effect.catchTag("LockfileReadError", (e) =>
    Effect.logWarning(`No lockfile at ${e.lockfilePath}`),
  ),
  Effect.catchTag("LockfileParseError", (e) =>
    Effect.logError(`Cannot parse ${e.format} lockfile`),
  ),
);
```
