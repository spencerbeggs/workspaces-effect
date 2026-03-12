---
title: "Phase 3: Change Detection Design"
module: core
category: architecture
status: current
completeness: 95
created: 2026-03-12
updated: 2026-03-12
last-synced: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - change-detection
  - git
  - command
  - phase3
related:
  - architecture.md
  - phase2-dependency-graph.md
  - effect-best-practices.md
---

## Phase 3: Change Detection Design

<!-- TOC -->

- [Overview](#overview)
- [Service Decomposition](#service-decomposition)
- [PackageResolver Service](#packageresolver-service)
- [ChangeDetector Service](#changedetector-service)
- [GlobResolver Decision](#globresolver-decision)
- [Error Types](#error-types)
- [Command Service Usage](#command-service-usage)
- [Layer Composition](#layer-composition)
- [Testing Strategy](#testing-strategy)
- [Decisions](#decisions)
- [Open Questions (all resolved)](#open-questions-all-resolved)

<!-- /TOC -->

## Overview

Phase 3 adds git-based change detection to the library. Given a base
reference (commit, branch, tag) and an optional head reference, the
ChangeDetector determines which files changed, maps them to workspace
packages, and optionally computes the transitive "affected" set using
the DependencyGraph from Phase 2.

This phase introduces two new services (PackageResolver, ChangeDetector)
and two new error types (GitNotAvailableError, ChangeDetectionError).

## Service Decomposition

| Service | Purpose | Dependencies |
| ------- | ------- | ------------ |
| PackageResolver | Map file paths to owning packages | WorkspaceDiscovery |
| ChangeDetector | Git-based change detection + affected computation | PackageResolver, DependencyGraph, Command |

### Why two services instead of one?

PackageResolver is independently useful. Any consumer that has a list of
file paths (from git, from a file watcher, from CI) can use it to map
files to packages without needing git. ChangeDetector composes
PackageResolver with git operations.

## PackageResolver Service

Maps file paths to their owning workspace package.

```typescript
class PackageResolver extends Context.Tag(
  "@spencerbeggs/workspaces-effect/PackageResolver"
)<
  PackageResolver,
  {
    /** Find which package owns a file path. Returns Option.none if outside all packages. */
    readonly resolveFile: (
      filePath: string,
    ) => Effect.Effect<Option.Option<WorkspacePackage>>

    /** Batch resolve: map multiple file paths to their owning packages. */
    readonly resolveFiles: (
      filePaths: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyMap<string, WorkspacePackage>
    >

    /** Get all package paths for fast prefix matching. */
    readonly packagePaths: () => Effect.Effect<
      ReadonlyArray<{ readonly path: string; readonly package: WorkspacePackage }>
    >
  }
>() {}
```

### Implementation strategy

Build a sorted list of `(absolutePath, WorkspacePackage)` pairs at layer
construction time (from WorkspaceDiscovery.listPackages). To resolve a
file, find the longest package path that is a prefix of the file path.
This is O(log n) with binary search on sorted paths, or O(n) with linear
scan (n = number of packages, typically small).

Key details:

- Paths are normalized to absolute paths using Path service
- Prefix matching: `filePath.startsWith(pkg.path + path.sep)`
- Files at root level (outside all packages) return `Option.none`
- `resolveFiles` deduplicates results (multiple files may map to same package)

## ChangeDetector Service

Git-based change detection with affected package computation.

```typescript
class ChangeDetector extends Context.Tag(
  "@spencerbeggs/workspaces-effect/ChangeDetector"
)<
  ChangeDetector,
  {
    /** Get files changed between base and head refs. */
    readonly changedFiles: (
      options: ChangeDetectionOptions,
    ) => Effect.Effect<
      ReadonlyArray<string>,
      GitNotAvailableError | ChangeDetectionError
    >

    /** Get packages that contain changed files. */
    readonly changedPackages: (
      options: ChangeDetectionOptions,
    ) => Effect.Effect<
      ReadonlyArray<WorkspacePackage>,
      GitNotAvailableError | ChangeDetectionError
    >

    /** Get changed packages plus their transitive dependents. */
    readonly affectedPackages: (
      options: ChangeDetectionOptions,
    ) => Effect.Effect<
      ReadonlyArray<WorkspacePackage>,
      GitNotAvailableError | ChangeDetectionError | CyclicDependencyError
    >
  }
>() {}
```

### ChangeDetectionOptions

```typescript
class ChangeDetectionOptions extends Schema.Class<ChangeDetectionOptions>(
  "ChangeDetectionOptions"
)({
  /** Base ref to compare against (commit SHA, branch, tag). Default: "HEAD~1". */
  base: Schema.optionalWith(Schema.String, { default: () => "HEAD~1" }),

  /** Head ref to compare to. Default: "HEAD". */
  head: Schema.optionalWith(Schema.String, { default: () => "HEAD" }),

  /** If true, include uncommitted working tree changes. */
  includeUncommitted: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
}) {}
```

### Git operations

The service uses `@effect/platform` Command service for git operations:

1. **Check git availability**: `git rev-parse --git-dir`
2. **Changed files (committed)**: `git diff --name-only <base>...<head>`
3. **Changed files (uncommitted)**: `git diff --name-only` (unstaged) +
   `git diff --name-only --cached` (staged)
4. **Merge base**: `git merge-base <base> <head>` for branch comparison

### Affected package computation

1. Get changed files via git
2. Map files to packages via PackageResolver
3. For each changed package, collect transitive dependents via
   DependencyGraph.dependentsOf (BFS/DFS traversal)
4. Deduplicate and return sorted result

The "affected" concept: if package A depends on package B, and B changed,
then A is affected (it may need rebuilding/retesting).

## GlobResolver Decision

**Decision: Defer GlobResolver as a separate service.**

The current glob resolution logic in WorkspaceDiscoveryLive handles the
workspace pattern use case (e.g., `packages/*`, `apps/**`). Extracting
it into a separate service would:

- Add a service boundary with no current external consumer
- Complicate the layer graph for minimal benefit
- Risk over-engineering before we know what glob API users need

If a future phase (e.g., Phase 4 config filtering) needs general-purpose
glob resolution, we can extract it then. The implementation in
WorkspaceDiscoveryLive is well-structured for extraction.

## Error Types

### GitNotAvailableError

Produced when git is not installed or the working directory is not a git
repository.

```typescript
class GitNotAvailableError extends Data.TaggedError(
  "GitNotAvailableError"
)<{
  readonly reason: string
}> {
  get message(): string {
    return `Git is not available: ${this.reason}`
  }
}
```

### ChangeDetectionError

Produced when a git operation fails (invalid ref, permission error, etc.)

```typescript
class ChangeDetectionError extends Data.TaggedError(
  "ChangeDetectionError"
)<{
  readonly operation: string
  readonly reason: string
}> {
  get message(): string {
    return `Change detection failed during "${this.operation}": ${this.reason}`
  }
}
```

## Command Service Usage

### Pattern from sibling repos (github-action-effects)

The `github-action-effects` repo uses a **CommandRunner service** that
wraps shell execution behind a testable interface with methods like
`exec`, `execCapture`, `execLines`, and `execJson`. The test layer
(`CommandRunnerTest`) uses a `Map<string, CommandResponse>` of recorded
responses keyed by `"command args..."`.

Key insight: the CommandRunner Live layer in github-action-effects uses
`@actions/exec` (GitHub Actions specific). For our library, we should
use `@effect/platform` Command directly since we target Node.js and Bun.

### @effect/platform Command API

```typescript
import { Command } from "@effect/platform"

// Create and run a command, capturing stdout as string
const output = yield* Command.make("git", "diff", "--name-only", base + "..." + head).pipe(
  Command.string,
)

// Command.string requires CommandExecutor in the R channel
// NodeContext.layer or BunContext.layer provide CommandExecutor
```

### Internal GitClient helper

Rather than exposing Command in the ChangeDetector service interface,
we create an internal `runGit` helper that converts PlatformError to
our typed errors:

```typescript
const runGit = (cwd: string, ...args: string[]) =>
  Command.make("git", ...args).pipe(
    Command.workingDirectory(cwd),
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError((e) =>
      new ChangeDetectionError({
        operation: `git ${args.join(" ")}`,
        reason: String(e),
      })
    ),
  )

const runGitLines = (cwd: string, ...args: string[]) =>
  runGit(cwd, ...args).pipe(
    Effect.map((output) =>
      output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    ),
  )
```

### Git availability check

```typescript
const checkGit = (cwd: string) =>
  Command.make("git", "rev-parse", "--git-dir").pipe(
    Command.workingDirectory(cwd),
    Command.string,
    Effect.mapError(() =>
      new GitNotAvailableError({
        reason: "not a git repository or git is not installed",
      })
    ),
  )
```

### Why not a separate GitClient service?

The ChangeDetector is the only consumer of git operations. Creating a
separate GitClient service would add a service boundary with no reuse.
If future phases need git operations (e.g., git blame for authorship),
we can extract then. For now, the internal helper functions are
sufficient.

## Layer Composition

### PackageResolverLive

```typescript
const PackageResolverLive: Layer.Layer<
  PackageResolver,
  never,
  WorkspaceDiscovery
> = Layer.effect(
  PackageResolver,
  Effect.gen(function* () {
    const discovery = yield* WorkspaceDiscovery
    const packages = yield* discovery.listPackages()
    // Build sorted path index at construction time
    const pathIndex = buildPathIndex(packages)
    return { resolveFile, resolveFiles, packagePaths }
  }),
)
```

### ChangeDetectorLive

The R channel requires `CommandExecutor` from `@effect/platform`, which
is the service that actually runs processes. `NodeContext.layer` and
`BunContext.layer` both provide it.

```typescript
import { CommandExecutor } from "@effect/platform"

const ChangeDetectorLive: Layer.Layer<
  ChangeDetector,
  never,
  PackageResolver | DependencyGraph | CommandExecutor.CommandExecutor
> = Layer.effect(
  ChangeDetector,
  Effect.gen(function* () {
    const resolver = yield* PackageResolver
    const graph = yield* DependencyGraph
    // CommandExecutor is accessed implicitly via Command.string/Command.lines
    return { changedFiles, changedPackages, affectedPackages }
  }),
)
```

**Important**: The `Command.string` and `Command.lines` functions
require `CommandExecutor` in the R channel. The ChangeDetectorLive layer
does NOT resolve CommandExecutor — it passes through as a requirement,
letting consumers provide `NodeContext.layer` or `BunContext.layer`.

### Composite layer

```typescript
// All Phase 3 services
const ChangeDetectionLive: Layer.Layer<
  PackageResolver | ChangeDetector,
  never,
  WorkspaceDiscovery | DependencyGraph | CommandExecutor.CommandExecutor
> = Layer.mergeAll(
  PackageResolverLive,
  ChangeDetectorLive.pipe(Layer.provide(PackageResolverLive)),
)
```

## Testing Strategy

### PackageResolver tests

- Mock WorkspaceDiscovery with known package paths
- Test file resolution: file inside package, file outside all packages,
  file at package root, nested file
- Test scoped package names (`@scope/pkg`)
- Test path edge cases (trailing slashes, relative paths)

### ChangeDetector tests

**Approach**: Mock the ChangeDetector service directly for consumers,
and for testing the Live layer, mock at the service boundary level:

1. **Unit tests**: Mock PackageResolver and DependencyGraph, provide a
   mock CommandExecutor that returns pre-recorded git output
2. **Integration tests**: Use a real temp git repo fixture

**Mock CommandExecutor pattern** (from github-action-effects):

```typescript
// Record expected git responses
const mockResponses = new Map([
  ["git rev-parse --git-dir", { exitCode: 0, stdout: ".git\n", stderr: "" }],
  ["git diff --name-only base...head", {
    exitCode: 0,
    stdout: "packages/pkg-a/src/index.ts\npackages/pkg-b/README.md\n",
    stderr: "",
  }],
])

// TODO: Research how to mock @effect/platform CommandExecutor
// May need to provide a custom CommandExecutor layer that intercepts
// Command.make calls and returns recorded responses
```

**Alternative**: If CommandExecutor mocking is complex, test the internal
`runGit`/`runGitLines` helpers separately, and test ChangeDetectorLive
by mocking at the ChangeDetector service level for consumers.

### Test cases

1. No changes (empty diff)
2. Single file change in one package
3. Changes across multiple packages
4. File change outside all packages (root-level config)
5. Git not available (GitNotAvailableError)
6. Invalid ref (ChangeDetectionError)
7. Affected packages include transitive dependents
8. Include uncommitted changes option
9. Merge base resolution for branch comparison

## Decisions

| Decision | Rationale |
| -------- | --------- |
| Defer GlobResolver | No external consumer yet; extract when needed |
| PackageResolver as separate service | Independently useful for file-to-package mapping |
| Eager path index in PackageResolver | Same pattern as DependencyGraph; O(1) lookups |
| Command service for git | Platform-independent; consistent with library design |
| Three-method ChangeDetector | Progressive disclosure: files → packages → affected |
| ChangeDetectionOptions as Schema.Class | Runtime validation, sensible defaults |

## Open Questions (all resolved)

1. **CommandExecutor mocking**: RESOLVED. Used `CommandExecutor.makeExecutor(start)`
   with a mock `start` returning `Effect.succeed(mockProcess)`. The mock Process
   needs `toJSON` and cast through `unknown`. Command args extracted via
   `Command.flatten(command)[0].args`. 12 tests validate the approach.

2. **Working tree changes**: RESOLVED. `includeUncommitted: true` includes
   untracked files via `git ls-files --others --exclude-standard`. Implemented
   and tested.

3. **Merge base**: DEFERRED. Current implementation uses user-provided refs
   directly (`base...head`). Auto merge-base computation can be added later
   if needed.

4. **Command dependency type**: RESOLVED. `Command.string` puts
   `CommandExecutor.CommandExecutor` in R. Solved by yielding executor at
   layer construction and calling `executor.string(command)` with
   `Effect.scoped()` wrapper.

5. **Resolved**: No caching for ChangeDetector — git state changes
   between calls, unlike static workspace structure.

6. **Resolved**: No separate GitClient service — ChangeDetector is the
   only git consumer. Internal helpers suffice.
