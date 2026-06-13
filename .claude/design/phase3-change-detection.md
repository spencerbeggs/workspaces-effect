---
title: "Change detection design"
module: core
category: architecture
status: current
completeness: 95
created: 2026-03-12
updated: 2026-06-13
last-synced: 2026-06-13
authors:
  - C. Spencer Beggs
tags:
  - change-detection
  - git
  - command
related:
  - architecture.md
  - phase2-dependency-graph.md
  - effect-patterns-core.md
---

## Change detection design

Git-based change detection. Given a base reference (commit, branch, tag) and an optional head, `ChangeDetector` determines which files changed, maps them to workspace packages via `PackageResolver`, and optionally computes the transitive "affected" set using `DependencyGraph`. See `src/layers/ChangeDetectorLive.ts` and `src/layers/PackageResolverLive.ts`.

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

<!-- /TOC -->

## Overview

`ChangeDetector` and `PackageResolver` are the change-detection services. `PackageResolver` maps file paths to their owning workspace package; `ChangeDetector` composes it with git operations to produce changed files, changed packages and affected packages. The two error types are `GitNotAvailableError` and `ChangeDetectionError`.

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

## GlobResolver decision

There is no standalone glob-resolver service. The glob resolution in `WorkspaceDiscoveryLive` handles the workspace-pattern use case (`packages/*`, `apps/**`). Extracting it would add a service boundary with no external consumer; the logic stays inline and is structured for extraction if a general-purpose glob API is ever needed.

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

Git is run through the `@effect/platform` `Command` service rather than `node:child_process` directly, keeping the library platform-independent across Node.js and Bun.

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
    const executor = yield* CommandExecutor.CommandExecutor
    // git helpers close over `executor`, so service methods have R = never
    return { changedFiles, changedPackages, affectedPackages }
  }),
)
```

**Important**: `CommandExecutor` is resolved at layer construction time
(yielded inside `Layer.effect`) so that all service methods have
`R = never`, matching the project convention documented in `CLAUDE.md`
and in `architecture.md`. The git helpers (`runGit`, `runGitLines`,
`checkGit` in `src/layers/ChangeDetectorLive.ts`) close over the
resolved `executor`. `CommandExecutor` still appears in the layer's
requirements, so consumers must provide it via `NodeContext.layer` or
`BunContext.layer`.

### Composite layer

`PackageResolver` and `ChangeDetector` are wired into the `WorkspacesFullLive` composite alongside the discovery and graph services. See `architecture.md` (Layer Composition) and `src/layers/WorkspacesLive.ts`.

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

For Live-layer tests, mock `CommandExecutor` via `CommandExecutor.makeExecutor(start)` with a response map keyed by `"command args..."`. See the CommandExecutor mocking pattern in `effect-patterns-testing.md`.

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
| No standalone GlobResolver | No external consumer; glob logic stays in WorkspaceDiscoveryLive |
| PackageResolver as separate service | Independently useful for file-to-package mapping |
| Eager path index in PackageResolver | Same pattern as DependencyGraph; O(1) lookups |
| Command service for git | Platform-independent; consistent with library design |
| Three-method ChangeDetector | Progressive disclosure: files → packages → affected |
| ChangeDetectionOptions as Schema.Class | Runtime validation, sensible defaults |
| No separate GitClient service | ChangeDetector is the only git consumer; internal helpers suffice |
| No caching for ChangeDetector | Git state changes between calls, unlike static workspace structure |

## Design notes

- `includeUncommitted: true` additionally pulls in untracked files via `git ls-files --others --exclude-standard`.
- Comparison uses the user-provided refs directly (`base...head`); there is no automatic merge-base computation.
