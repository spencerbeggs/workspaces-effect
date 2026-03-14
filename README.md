# workspaces-effect

[![npm version](https://img.shields.io/npm/v/workspaces-effect)](https://www.npmjs.com/package/workspaces-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

An Effect-TS library for monorepo workspace tooling. Discover workspaces, analyze dependency graphs, detect changes, parse lockfiles, and check publishability across npm, pnpm, yarn Berry, and Bun through composable Effect services with typed errors and platform independence.

## Features

- Workspace discovery across all four major package managers with automatic detection
- Dependency graph analysis with topological sorting for correct build ordering
- Git-based change detection to find affected packages from file changes
- Lockfile parsing for pnpm, npm, yarn, and bun with integrity verification
- Platform independent -- runs on Node.js or Bun via `@effect/platform` abstractions

## Installation

```bash
npm install workspaces-effect
```

## Quick Start

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { DependencyGraph, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  const deps = yield* graph.dependenciesOf("my-package");
  console.log("Dependencies:", deps);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

Two composite layers cover most use cases:

- **`WorkspacesLive`** -- all services except git-dependent ones (requires `FileSystem` + `Path`)
- **`WorkspacesFullLive`** -- all services including change detection (additionally requires `CommandExecutor`)

## Documentation

For architecture details, API reference, and advanced usage, see [docs](./docs/).

## License

MIT
