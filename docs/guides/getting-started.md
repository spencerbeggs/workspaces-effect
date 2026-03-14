# Getting Started

This guide walks through installing workspaces-effect, setting up your first
program, and understanding the core concepts.

## Table of Contents

- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Your First Program](#your-first-program)
- [Understanding Layers](#understanding-layers)
- [Using with Bun](#using-with-bun)
- [Next Steps](#next-steps)

## Installation

```bash
npm install workspaces-effect
```

You also need Effect and the platform package for your runtime:

```bash
# For Node.js
npm install effect @effect/platform @effect/platform-node

# For Bun
npm install effect @effect/platform @effect/platform-bun
```

## Prerequisites

- A monorepo using npm, pnpm, yarn Berry, or Bun workspaces
- Node.js 22+ or Bun 1.0+
- Effect 3.x

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

## Understanding Layers

workspaces-effect uses Effect's layer system for dependency injection. You
write programs against service interfaces, then provide implementations at
the edge.

**Two composite layers** cover most use cases:

| Layer | Services Included | Platform Requirements |
| --- | --- | --- |
| `WorkspacesLive` | Discovery, graph, lockfile, publishability (7 services) | FileSystem + Path |
| `WorkspacesFullLive` | Everything including git change detection (all 9 services) | FileSystem + Path + CommandExecutor |

The platform requirements are satisfied by `NodeContext.layer` or
`BunContext.layer`.

### Choosing a Layer

Use `WorkspacesLive` when you do not need git-based change detection. It is
lighter and does not require git to be installed.

Use `WorkspacesFullLive` when you need `ChangeDetector` or `PackageResolver`
(which requires `CommandExecutor` for git operations).

### Individual Layers

For fine-grained control, each service exports its own layer:

```typescript
import {
  WorkspaceRootLive,
  WorkspaceDiscoveryLive,
  PackageManagerDetectorLive,
} from "workspaces-effect";
```

You can compose these manually with `Layer.provide` to build exactly the
service set you need.

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

- [Dependency Analysis](./dependency-analysis.md) -- Build dependency graphs
  and sort packages
- [Change Detection](./change-detection.md) -- Find affected packages from git
  changes
- [Lockfile Parsing](./lockfile-parsing.md) -- Read and query lockfile data
- [Architecture Overview](../architecture/overview.md) -- Understand the full
  service architecture
