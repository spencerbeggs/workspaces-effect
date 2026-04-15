# workspaces-effect

[![npm version](https://img.shields.io/npm/v/workspaces-effect)](https://www.npmjs.com/package/workspaces-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

An [Effect](https://effect.website) library for monorepo workspace tooling. Discover workspaces, analyze dependency graphs, detect changes, parse lockfiles, and check publishability across npm, pnpm, yarn Berry and Bun through composable Effect services with typed errors and platform independence.

## Features

- Workspace discovery across all four major package managers with automatic detection
- Rich package metadata with computed getters, dependency queries, and a dual-API pattern (instance, static data-first, and pipeable)
- Dependency graph analysis with topological sorting for correct build ordering
- Git-based change detection to find affected packages from file changes
- Lockfile parsing for pnpm, npm, yarn, and bun with integrity verification
- Platform independent -- runs on Node.js or Bun via `@effect/platform` abstractions
- Synchronous helpers (`findWorkspaceRootSync`, `getWorkspacePackagesSync`) for non-Effect contexts like lint-staged

## Installation

`effect` and `@effect/platform` are peer dependencies -- install them alongside the platform adapter for your runtime:

```bash
# For Node.js
npm install workspaces-effect effect @effect/platform @effect/platform-node

# For Bun
bun add workspaces-effect effect @effect/platform @effect/platform-bun
```

## Quick Start

```typescript
import { Effect, Option, pipe } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  WorkspaceDiscovery,
  WorkspacePackage,
  WorkspacesLive,
} from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();

  for (const pkg of packages) {
    // Computed getters
    if (pkg.isRootWorkspace) continue; // skip the root package
    console.log(pkg.unscopedName, pkg.isPublic ? "(public)" : "(private)");

    // Instance method
    if (pkg.hasAnyDependencyOn("effect")) {
      const version = pkg.dependencyVersion("effect");
      console.log("  effect:", Option.getOrElse(version, () => "n/a"));
    }
  }

  // Static data-last (pipeable) style
  const usesReact = packages.filter(
    pipe(WorkspacePackage.hasAnyDependencyOn("react")),
  );
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

Two composite layers cover most use cases:

- **`WorkspacesLive`** -- all services except git-dependent ones (requires
  `FileSystem` + `Path`)
- **`WorkspacesFullLive`** -- all services including change detection
  (additionally requires `CommandExecutor`)

## Documentation

For architecture details, API reference, and advanced usage, see
[docs/](./docs).

## License

[MIT](./LICENSE)
