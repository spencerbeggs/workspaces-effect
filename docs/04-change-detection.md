# Change detection

Change detection answers three questions about a git diff: which files changed, which packages own those files and which packages depend on the ones that changed.

## Table of contents

- [Setup](#setup)
- [Three levels of analysis](#three-levels-of-analysis)
- [Options](#options)
- [PackageResolver](#packageresolver)
- [CI pipeline example](#ci-pipeline-example)
- [Error handling](#error-handling)

## Setup

Change detection runs git commands through `@effect/platform`'s `CommandExecutor`, so it requires `WorkspacesFullLive`. The smaller `WorkspacesLive` layer omits the git-dependent services.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  ChangeDetector,
  ChangeDetectionOptions,
  WorkspacesFullLive,
} from "workspaces-effect";
```

## Three levels of analysis

The methods on `ChangeDetector` map to those questions in order. Each one builds on the previous: file paths, then the packages that own those paths, then the dependency closure.

### 1. Changed files

File paths from `git diff`, relative to the workspace root:

```typescript
const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const files = yield* detector.changedFiles(options);
  console.log("Changed files:", files);
  // example output (varies): ["packages/ui/src/Button.tsx", "packages/core/src/index.ts"]
});
```

### 2. Changed packages

Each changed file is mapped to the workspace package that owns it. Files outside any workspace (root config files, tooling) drop out of the result:

```typescript
const changed = yield* detector.changedPackages(options);
console.log("Changed packages:", changed.map((p) => p.name));
// example output (varies): ["@myorg/ui", "@myorg/core"]
```

### 3. Affected packages

The changed packages plus every package that transitively depends on them. If `@myorg/app` depends on `@myorg/ui` and `@myorg/ui` changed, `@myorg/app` shows up here even though none of its own files were touched:

```typescript
const affected = yield* detector.affectedPackages(options);
console.log("Affected packages:", affected.map((p) => p.name));
// example output (varies): ["@myorg/ui", "@myorg/core", "@myorg/app"]
```

## Options

`ChangeDetectionOptions` is an Effect `Schema.Class`. Three fields:

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

`PackageResolver` does the file-to-package mapping on its own, no git involved. Use it when you already have a list of paths from somewhere else: a file watcher, a build tool, a custom diff. Matching is by longest absolute-path prefix:

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

`PackageResolver` depends on `CommandExecutor`, so it also requires `WorkspacesFullLive`.

## CI pipeline example

In CI, build and test only the packages affected by the current PR. Get the affected set, sort it topologically, then iterate.

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
  // example output (varies): ["@myorg/utils", "@myorg/core", "@myorg/ui"]

  // Build each package in order...
});

Effect.runPromise(
  ci.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Error handling

Change detection raises three tagged errors:

| Error | Cause |
| --- | --- |
| `GitNotAvailableError` | Git is not installed or the directory is not a git repository |
| `ChangeDetectionError` | A specific git command failed (e.g. invalid ref, merge conflicts) |
| `CyclicDependencyError` | Only from `affectedPackages` — the dependency graph has a cycle |

Catch them with `Effect.catchTag`:

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

`ChangeDetectionError` carries an `operation` field naming the failed command (`"diff"`, `"merge-base"`) and a `reason` field with a human-readable message. See [Troubleshooting](./09-troubleshooting.md) for fixes to specific failures.
