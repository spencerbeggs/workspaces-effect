# Getting Started

This guide walks through installing workspaces-effect, writing your first
program, and understanding how layers work.

## Table of Contents

- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Your First Program](#your-first-program)
- [Understanding Layers](#understanding-layers)
- [Using Composite Layers](#using-composite-layers)
- [Using with Bun](#using-with-bun)
- [Next Steps](#next-steps)

## Installation

`effect` and `@effect/platform` are peer dependencies. Install them alongside
the platform adapter for your runtime:

```bash
# For Node.js
npm install workspaces-effect effect @effect/platform @effect/platform-node

# For Bun
bun add workspaces-effect effect @effect/platform @effect/platform-bun
```

You choose the Effect and platform versions. workspaces-effect requires
`effect` >= 3.19 and `@effect/platform` >= 0.94.

## Prerequisites

- A monorepo using npm, pnpm, yarn Berry, or Bun workspaces
- Node.js 22+ or Bun 1.0+
- Effect 3.x

Your monorepo must have workspace configuration:

- **pnpm:** `pnpm-workspace.yaml` at the root
- **npm / yarn / bun:** `workspaces` field in root `package.json`

## Your First Program

This example discovers all workspace packages and prints their names:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();

  for (const pkg of packages) {
    if (pkg.isRootWorkspace) continue; // skip the root workspace
    console.log(`${pkg.name} @ ${pkg.path}`);
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

Run this from anywhere inside your monorepo. The library automatically finds
the workspace root by walking up the directory tree.

`listPackages()` includes the root workspace package (with
`relativePath: "."`) as the first entry. Use the `isRootWorkspace` getter to
filter it out when you only want child packages.

## Understanding Layers

workspaces-effect uses Effect's layer system for dependency injection. You
write programs against **service interfaces** (`Context.Tag` classes like
`WorkspaceDiscovery`), then provide **layer implementations** at the edge of
your program.

This separation means:

- Your business logic is decoupled from implementation details
- Services can be swapped (e.g., for testing)
- Dependencies are wired once, not threaded through every function call

The basic pattern is:

```typescript
// 1. Write your program using service interfaces
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  return yield* discovery.listPackages();
});

// 2. Provide layer implementations at the edge
Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),       // provides workspaces-effect services
    Effect.provide(NodeContext.layer),     // provides platform services (FileSystem, Path, etc.)
  ),
);
```

## Using Composite Layers

Two composite layers cover most use cases:

| Layer | Services Included | Platform Requirements |
| --- | --- | --- |
| `WorkspacesLive` | Discovery, graph, lockfile, publishability (7 services) | `FileSystem` + `Path` |
| `WorkspacesFullLive` | Everything including git change detection (all 9) | `FileSystem` + `Path` + `CommandExecutor` |

Both `NodeContext.layer` and `BunContext.layer` provide all three platform
services, so they work with either composite layer.

### Choosing a Layer

Use **`WorkspacesLive`** when you do not need git-based change detection. It is
lighter and does not require git to be installed. It provides: `WorkspaceRoot`,
`PackageManagerDetector`, `WorkspaceDiscovery`, `DependencyGraph`,
`TopologicalSorter`, `LockfileReader`, `PublishabilityDetector`.

Use **`WorkspacesFullLive`** when you need `ChangeDetector` or
`PackageResolver`. These services use `CommandExecutor` to run git commands.
It provides all 9 services.

### Individual Layers

For fine-grained control, each service exports its own layer:

```typescript
import {
  WorkspaceRootLive,
  WorkspaceDiscoveryLive,
  PackageManagerDetectorLive,
} from "workspaces-effect";
```

You compose them manually with `Layer.provide` to build exactly the service
set you need.

## Using with Bun

Swap the platform layer to run on Bun:

```typescript
import { Effect } from "effect";
import { BunContext } from "@effect/platform-bun";
import { WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();
  console.log(packages.map((p) => p.name));
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(BunContext.layer),
  ),
);
```

## Next Steps

- [WorkspacePackage API](./workspace-package.md) -- The core data model with
  getters, dependency queries, and the dual-API pattern
- [Dependency Analysis](./dependency-analysis.md) -- Build dependency graphs
  and sort packages for build ordering
- [Change Detection](./change-detection.md) -- Find affected packages from git
  changes
- [Lockfile Parsing](./lockfile-parsing.md) -- Read and query lockfile data
  across all package managers
- [Publishability](./publishability.md) -- Detect which packages can be
  published and where
- [Architecture Overview](../architecture/overview.md) -- Full service
  architecture and error model
