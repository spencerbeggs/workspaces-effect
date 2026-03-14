# Change Detection

workspaces-effect provides git-based change detection to find which packages
changed between git refs and which packages are transitively affected.

## Table of Contents

- [Setup](#setup)
- [Three Levels of Analysis](#three-levels-of-analysis)
- [Configuring Options](#configuring-options)
- [CI Pipeline Example](#ci-pipeline-example)
- [Error Handling](#error-handling)

## Setup

Change detection requires `WorkspacesFullLive` because it uses git commands
through `@effect/platform`'s `CommandExecutor`:

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

The `ChangeDetector` service offers progressive disclosure:

### 1. Changed Files

Raw git diff output -- just file paths:

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

Files resolved to their owning workspace packages:

```typescript
const changed = yield* detector.changedPackages(options);
console.log("Changed packages:", changed.map((p) => p.name));
// ["@myorg/ui", "@myorg/core"]
```

### 3. Affected Packages

Changed packages plus all packages that transitively depend on them:

```typescript
const affected = yield* detector.affectedPackages(options);
console.log("Affected packages:", affected.map((p) => p.name));
// ["@myorg/ui", "@myorg/core", "@myorg/app"]
// (app depends on ui, so it is affected)
```

## Configuring Options

`ChangeDetectionOptions` is an Effect `Schema.Class` with these fields:

| Field | Default | Description |
| --- | --- | --- |
| `base` | `"HEAD~1"` | Base git ref (commit, branch, tag) |
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
```

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

  const buildOrder = yield* sorter.sortSubset(affected.map((p) => p.name));
  console.log("Build order:", buildOrder);
});

Effect.runPromise(
  ci.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Error Handling

Change detection can fail with two error types:

- `GitNotAvailableError` -- git is not installed or the directory is not a
  git repository
- `ChangeDetectionError` -- a specific git command failed (e.g., invalid ref)

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
