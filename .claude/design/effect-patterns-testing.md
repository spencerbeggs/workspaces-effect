---
title: "Effect Patterns: Testing"
module: core
category: patterns
status: current
completeness: 95
created: 2026-03-12
updated: 2026-06-13
last-synced: 2026-06-13
authors:
  - C. Spencer Beggs
tags:
  - effect
  - patterns
  - testing
  - vitest
  - mocking
related:
  - architecture.md
  - effect-patterns-core.md
  - effect-patterns-parsing.md
---

## Effect Patterns: Testing

Testing patterns for Effect-TS services in workspaces-effect. Covers mock layers, filesystem mocking, command execution testing and graph construction.

## Layer.succeed for test mocks

```typescript
const testDiscovery = Layer.succeed(WorkspaceDiscovery, {
  listPackages: () => Effect.succeed([]),
  getPackage: (name) => Effect.fail(new PackageNotFoundError({ name, available: [] })),
});
```

## FileSystem.layerNoop for filesystem mocking

```typescript
const mockFs = FileSystem.layerNoop({
  readFileString: (path) => Effect.succeed('{"name": "test"}'),
  exists: (path) => Effect.succeed(true),
  readDirectory: (path) => Effect.succeed(["pkg-a", "pkg-b"]),
});
```

## FileSystem.layerNoop with Path.layer for layer tests

When testing layers that depend on both `FileSystem` and `Path`, combine
`FileSystem.layerNoop` (mock FS methods) with `Path.layer` (real Path
operations). This lets you control filesystem behavior while getting correct
cross-platform path joining:

```typescript
const testLayer = WorkspaceRootLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      FileSystem.layerNoop({
        exists: (path) => {
          if (path === "/project/pnpm-workspace.yaml") return Effect.succeed(true);
          return Effect.succeed(false);
        },
        readFileString: (path) => Effect.succeed("{}"),
      }),
      Path.layer,
    )
  )
);
```

## Effect.die for unreachable FS errors in tests

In tests, when a mock FS method should never be called for a particular
code path, use `Effect.die` instead of constructing a proper `PlatformError`.
This is simpler and makes test failures obvious:

```typescript
FileSystem.layerNoop({
  exists: (_path) => Effect.die("exists should not be called in this test"),
  readFileString: (path) => {
    if (path === "/expected/path") return Effect.succeed(content);
    return Effect.die(`unexpected readFileString call: ${path}`);
  },
});
```

## Vitest pool: forks (not threads)

Effect-TS requires the `forks` pool in Vitest:

```typescript
// vitest.config.ts
pool: "forks"
```

Effect uses features that require process isolation. Using the `threads`
pool will cause intermittent test failures.

## Test composition with Layer.mergeAll

```typescript
const testLayer = Layer.mergeAll(testRoot, testDetector, testDiscovery);

const result = await Effect.runPromise(
  program.pipe(Effect.provide(testLayer))
);
```

## Command Execution Patterns

### Command.make + Command.string for shell commands

```typescript
import { Command, CommandExecutor } from "@effect/platform"

// Run command, capture stdout as string
const output = yield* Command.make("git", "rev-parse", "--git-dir").pipe(
  Command.workingDirectory(cwd),
  Command.string,
)
// R = CommandExecutor.CommandExecutor, E = PlatformError

// Run command, capture stdout as line array
const lines = yield* Command.make("git", "diff", "--name-only").pipe(
  Command.workingDirectory(cwd),
  Command.lines,
)
// R = CommandExecutor.CommandExecutor, E = PlatformError
```

### Converting PlatformError to typed errors for commands

Same pattern as filesystem operations -- wrap with `Effect.mapError`:

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
```

### CommandExecutor resolved at construction for R=never methods

`Command.string` and `Command.lines` put `CommandExecutor` in the R
channel. If your service interface requires `R = never` on methods,
you must yield `CommandExecutor` at layer construction time and call
`executor.string(command)` directly:

```typescript
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    return {
      myMethod: () =>
        Effect.scoped(
          executor.string(
            Command.make("git", "status").pipe(Command.workingDirectory(cwd))
          ),
        ),
    };
  }),
);
```

The layer's R channel includes CommandExecutor (provided by
`NodeContext.layer` or `BunContext.layer`) but service methods have
`R = never`.

### Testing Command-dependent code

Three approaches for testing code that uses `Command`:

**Approach 1: Mock at service level** (recommended for most tests).
Mock the service that wraps Command (e.g., ChangeDetector) using
`Layer.succeed`. This tests consumers without touching Command at all.

**Approach 2: Mock CommandExecutor via makeExecutor** (for Live layer tests).
`CommandExecutor.makeExecutor(start)` derives `string`/`lines` from
a mock `start` function. Build a response map keyed by command string:

```typescript
import { CommandExecutor, Command } from "@effect/platform"
import { Effect, Stream, Chunk, Sink } from "effect"

const makeTestExecutor = (
  responses: Map<string, { stdout: string; stderr?: string; exitCode?: number }>
) => CommandExecutor.makeExecutor((command) => {
  // Extract command args for lookup
  const args = [...Command.flatten(command)].map(c => c.args).flat()
  const key = args.join(" ")
  const response = responses.get(key) ?? { stdout: "", exitCode: 0 }
  const encoder = new TextEncoder()

  return Effect.succeed({
    [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
    pid: CommandExecutor.ProcessId(1),
    exitCode: Effect.succeed(CommandExecutor.ExitCode(response.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stderr: Stream.fromChunk(Chunk.of(encoder.encode(response.stderr ?? ""))),
    stdin: Sink.drain,
    stdout: Stream.fromChunk(Chunk.of(encoder.encode(response.stdout))),
  })
})
```

**Approach 3: Yield executor at construction** (current pattern).
When service methods need `R = never` but use Command internally,
yield `CommandExecutor` at layer construction and call
`executor.string(command)` directly. See ChangeDetectorLive for example.

From sibling repos: recorded response maps keyed by `"command args..."`
strings provide deterministic git output for testing.

## Graph Construction Patterns

### Eager graph building in Layer.effect

When a service needs a precomputed data structure (like a dependency graph),
build it eagerly inside `Layer.effect`. The graph is constructed once when
the layer is created and shared by all service method calls:

```typescript
const DependencyGraphLive = Layer.effect(
  DependencyGraph,
  Effect.gen(function* () {
    const discovery = yield* WorkspaceDiscovery;
    const packages = yield* discovery.listPackages();
    const graph = buildGraph(packages); // Built once, used by all methods

    return {
      dependenciesOf: (name) => /* lookup in graph.edges */,
      dependentsOf: (name) => /* lookup in graph.reverseEdges */,
      packages: () => Effect.succeed(Array.from(graph.nodes)),
      hasCycle: () => Effect.succeed(detectCycle(graph)),
      adjacencyMap: () => Effect.succeed(graph.edges),
    };
  }),
);
```

This is appropriate when:

- The underlying data is fixed for a given run (e.g., workspace list)
- Construction cost is low relative to query frequency
- All queries benefit from the precomputed structure

### Native Map/Set vs Effect HashMap

Use native `Map<string, Set<string>>` for internal graph structures when
keys are primitive strings. Effect's `HashMap` and `HashSet` provide
structural equality which is valuable for complex keys but adds overhead
for simple string lookups. The graph is an implementation detail hidden
behind the service interface.

### sortSubset via BFS + sub-graph

To topologically sort a subset of packages, first collect all transitive
dependencies via BFS from the requested packages, then build a
sub-adjacency map containing only those nodes, and finally run Kahn's
algorithm on the subset. This avoids sorting the entire graph when only
a portion is needed.

## Test File Organization

### Directory structure convention

Tests live in a top-level `__test__/` directory (following the
`@savvy-web/vitest` discovery convention), not co-located with source
files in `src/`:

```text
__test__/
  index.test.ts              # Public API / re-export tests
  core-schemas.test.ts       # Schema unit tests
  workspace-package.test.ts  # WorkspacePackage class tests
  layers/                    # Layer construction tests (one per service)
    WorkspaceRootLive.test.ts
    LockfileReaderLive.test.ts
    integrity.test.ts
    ...
  parsers/                   # Lockfile parser unit tests
    pnpm.test.ts
    npm.test.ts
    yarn.test.ts
    bun.test.ts
  integration/               # Integration tests against real fixtures
    lockfile-reader.int.test.ts
    lockfile-integrity.int.test.ts
    workspace-discovery.int.test.ts
    dependency-graph.int.test.ts
    dependency-diff.int.test.ts
    fixtures/                # Real lockfiles + package.json for each PM
      pnpm/v1/               # Fixture version sets for drift testing
      npm/v1/
      yarn/v1/
      bun/v1/
  utils/                     # Shared test utilities
    fixtures.ts              # Fixture path helpers and loaders
    layers.ts                # Common mock layer builders
    mock-fs.ts               # FileSystem mock helpers
```

### Shared test utilities

Common test helpers are extracted into `__test__/utils/`:

- **`fixtures.ts`** -- Fixture path resolution and file loading helpers.
  Provides `fixtureRoot()` for absolute paths to fixture directories
  and helper functions to load lockfile content for each package manager.
- **`layers.ts`** -- Reusable mock layer builders for `WorkspaceRoot`,
  `PackageManagerDetector`, `WorkspaceDiscovery`, and composite test layers.
  Reduces boilerplate across layer tests.
- **`mock-fs.ts`** -- FileSystem mock construction helpers that wrap
  `FileSystem.layerNoop` with common patterns (directory listing, file
  existence checks, content serving from fixture data).

### Integration test fixtures

Integration tests use real lockfile fixtures at
`__test__/integration/fixtures/{pm}/v{N}/`. Each version set contains:

- `package.json` (root)
- `packages/*/package.json` (workspace packages)
- The PM-specific lockfile (`pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, or `bun.lock`)
- PM-specific config (`pnpm-workspace.yaml`, `.yarnrc.yml`) where needed

Multiple version sets (`v1`, `v2`, `v3`) test scenarios like added
packages, version changes, and integrity drift between lockfile and
package.json.
