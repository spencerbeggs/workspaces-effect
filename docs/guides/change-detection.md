# Change Detection

workspaces-effect provides git-based change detection to find which files
changed between git refs, which packages those files belong to, and which
packages are transitively affected.

## Table of Contents

- [Setup](#setup)
- [Three Levels of Analysis](#three-levels-of-analysis)
- [Configuring Options](#configuring-options)
- [PackageResolver](#packageresolver)
- [CI Pipeline Example](#ci-pipeline-example)
- [Error Handling](#error-handling)

## Setup

Change detection requires `WorkspacesFullLive` because it uses git commands
through `@effect/platform`'s `CommandExecutor`. `WorkspacesLive` does not
include the git-dependent services.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  ChangeDetector,
  ChangeDetectionOptions,
  WorkspacesFullLive,
} from "workspaces-effect";
```

## Three Levels of Analysis

The `ChangeDetector` service offers three methods with progressively richer
output:

### 1. Changed Files

Raw git diff output -- just file paths relative to the workspace root:

```typescript
const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const files = yield* detector.changedFiles(options);
  console.log("Changed files:", files);
  // ["packages/ui/src/Button.tsx", "packages/core/src/index.ts"]
});
```

### 2. Changed Packages

Files resolved to their owning workspace packages. Files outside any workspace
package (e.g., root config files) are silently excluded:

```typescript
const changed = yield* detector.changedPackages(options);
console.log("Changed packages:", changed.map((p) => p.name));
// ["@myorg/ui", "@myorg/core"]
```

### 3. Affected Packages

Changed packages plus all packages that transitively depend on them. If
`@myorg/app` depends on `@myorg/ui` and `@myorg/ui` changed, then `@myorg/app`
is affected even though none of its files changed:

```typescript
const affected = yield* detector.affectedPackages(options);
console.log("Affected packages:", affected.map((p) => p.name));
// ["@myorg/ui", "@myorg/core", "@myorg/app"]
```

## Configuring Options

`ChangeDetectionOptions` is an Effect `Schema.Class` with these fields:

| Field | Default | Description |
| --- | --- | --- |
| `base` | `"HEAD~1"` | Base git ref (commit SHA, branch, tag) |
| `head` | `"HEAD"` | Head git ref to compare against |
| `includeUncommitted` | `false` | Include working tree changes |

```typescript
// Compare against main branch
const vsBranch = new ChangeDetectionOptions({ base: "origin/main" });

// Last 5 commits with uncommitted changes
const withWip = new ChangeDetectionOptions({
  base: "HEAD~5",
  includeUncommitted: true,
});

// Between two tags
const betweenTags = new ChangeDetectionOptions({
  base: "v1.0.0",
  head: "v2.0.0",
});

// Defaults: base="HEAD~1", head="HEAD", includeUncommitted=false
const defaults = new ChangeDetectionOptions({});
```

## PackageResolver

The `PackageResolver` service is available separately if you need to map file
paths to packages without running git commands. It uses longest-prefix matching
on absolute paths:

```typescript
import { PackageResolver, WorkspacesFullLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const resolver = yield* PackageResolver;

  // Single file
  const owner = yield* resolver.resolveFile("/workspace/packages/ui/src/Button.tsx");
  // Option.some(WorkspacePackage) or Option.none()

  // Batch resolve (deduped by package name)
  const packageMap = yield* resolver.resolveFiles([
    "/workspace/packages/ui/src/Button.tsx",
    "/workspace/packages/ui/src/Input.tsx",
    "/workspace/packages/core/src/index.ts",
  ]);
  // ReadonlyMap with 2 entries: "@myorg/ui" and "@myorg/core"
});
```

`PackageResolver` requires `WorkspacesFullLive` because it depends on
`CommandExecutor`.

## CI Pipeline Example

A typical CI script that only builds and tests affected packages:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  ChangeDetector,
  ChangeDetectionOptions,
  TopologicalSorter,
  WorkspacesFullLive,
} from "workspaces-effect";

const ci = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const sorter = yield* TopologicalSorter;

  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const affected = yield* detector.affectedPackages(options);

  if (affected.length === 0) {
    console.log("No packages affected, skipping build.");
    return;
  }

  // Get correct build order for just the affected packages
  const buildOrder = yield* sorter.sortSubset(affected.map((p) => p.name));
  console.log("Build order:", buildOrder);

  // Build each package in order...
});

Effect.runPromise(
  ci.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Error Handling

Change detection can fail with these error types:

| Error | Cause |
| --- | --- |
| `GitNotAvailableError` | Git is not installed or the directory is not a git repository |
| `ChangeDetectionError` | A specific git command failed (e.g., invalid ref, merge conflicts) |
| `CyclicDependencyError` | Only from `affectedPackages` -- the dependency graph has a cycle |

Handle them with `Effect.catchTag`:

```typescript
const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const options = new ChangeDetectionOptions({ base: "origin/main" });
  return yield* detector.affectedPackages(options);
}).pipe(
  Effect.catchTag("GitNotAvailableError", () =>
    Effect.succeed([]), // Fall back to empty list
  ),
  Effect.catchTag("ChangeDetectionError", (e) =>
    Effect.logError(`Git ${e.operation} failed: ${e.reason}`).pipe(
      Effect.map(() => []),
    ),
  ),
);
```

The `ChangeDetectionError` includes an `operation` field (e.g., `"diff"`,
`"merge-base"`) and a `reason` field with a human-readable message. See
[Troubleshooting](../troubleshooting.md) for detailed solutions.
