# Getting started

Install workspaces-effect, run a first program, then learn how the layers fit together.

## Table of contents

- [Install](#install)
- [Prerequisites](#prerequisites)
- [Your first program](#your-first-program)
- [Understanding layers](#understanding-layers)
- [Using composite layers](#using-composite-layers)
- [Using with Bun](#using-with-bun)
- [Synchronous utilities](#synchronous-utilities)
- [Next steps](#next-steps)

## Install

`effect` and `@effect/platform` are peer dependencies. Install them alongside the platform adapter for your runtime.

```bash
# For Node.js
npm install workspaces-effect effect @effect/platform @effect/platform-node
# or
pnpm add workspaces-effect effect @effect/platform @effect/platform-node

# For Bun
bun add workspaces-effect effect @effect/platform @effect/platform-bun
```

The required `effect` and `@effect/platform` versions are declared in this package's `peerDependencies` — see the `package.json` of the version installed from npm.

## Prerequisites

- A monorepo using npm, pnpm, yarn Berry or Bun workspaces
- A recent LTS release of Node.js, or current Bun
- A current major release of `effect`

Workspace configuration is recommended but not required:

- **pnpm:** `pnpm-workspace.yaml` at the root
- **npm / yarn / bun:** `workspaces` field in root `package.json`
- **Standalone:** if no workspace configuration is found, the root `package.json` is treated as a single-package workspace

Each workspace `package.json` must have both a `name` and `version` field. Packages missing a `version` field will cause a `WorkspaceDiscoveryError`.

## Your first program

This example discovers all workspace packages and prints their names.

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
    // example output (varies by repo): "@myorg/utils @ /workspace/packages/utils"
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

Run this from anywhere inside your monorepo. The library finds the workspace root by walking up the directory tree.

`listPackages()` returns the root workspace package (with `relativePath: "."`) as the first entry. Use the `isRootWorkspace` getter to filter it out when you only want child packages.

## Understanding layers

workspaces-effect uses Effect's layer system for dependency injection. You write programs against **service interfaces** (`Context.Tag` classes like `WorkspaceDiscovery`) and provide **layer implementations** at the edge of your program.

That separation keeps business logic decoupled from implementation, lets services swap cleanly under test, and wires dependencies up once instead of threading them through every function.

The pattern:

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

## Using composite layers

The library ships two composite layers:

| Layer | Services included | Platform requirements |
| --- | --- | --- |
| `WorkspacesLive` | discovery, graph, lockfile, publishability | `FileSystem` + `Path` |
| `WorkspacesFullLive` | everything including git change detection | `FileSystem` + `Path` + `CommandExecutor` |

Both `NodeContext.layer` and `BunContext.layer` provide all three platform services, so they work with either composite.

### Choosing a layer

Reach for **`WorkspacesLive`** when git-based change detection is not in play. It pulls fewer services and does not require git on the host. It provides `WorkspaceRoot`, `PackageManagerDetector`, `WorkspaceDiscovery`, `DependencyGraph`, `TopologicalSorter`, `LockfileReader` and `PublishabilityDetector`.

Reach for **`WorkspacesFullLive`** when you need `ChangeDetector` or `PackageResolver`. Those services shell out via `CommandExecutor` to run git, and the composite provides every service in the library.

### Individual layers

Each service exports its own layer if you want to wire things up by hand:

```typescript
import {
  WorkspaceRootLive,
  WorkspaceDiscoveryLive,
  PackageManagerDetectorLive,
} from "workspaces-effect";
```

Compose them with `Layer.provide` to build exactly the service set you need.

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
  // example output (varies by repo): ["@myorg/root", "@myorg/utils", "@myorg/core"]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(BunContext.layer),
  ),
);
```

## Synchronous utilities

Some callers cannot run an Effect — lint-staged handlers, JS config files and other tool hooks need plain functions that return a value. workspaces-effect ships two sync helpers for those spots:

```typescript
import {
  findWorkspaceRootSync,
  getWorkspacePackagesSync,
} from "workspaces-effect";
```

### findWorkspaceRootSync

Walks upward from a starting directory and stops at the first workspace marker (`pnpm-workspace.yaml`, or a `package.json` with a `workspaces` field). Returns the absolute path to the root, or `null` if it never finds one.

```typescript
const root = findWorkspaceRootSync(); // starts from process.cwd()
const root2 = findWorkspaceRootSync("/some/nested/dir");

if (root) {
  console.log("Workspace root:", root);
  // example output: Workspace root: /workspace
}
```

### getWorkspacePackagesSync

Reads workspace patterns from `pnpm-workspace.yaml` or `package.json`, resolves each pattern to a directory, and returns `{ name, path }` for every match. Returns `null` if the root directory does not exist.

Like the Effect-based `listPackages()`, this function includes the root workspace as the first entry. Child packages matched by workspace patterns follow in sorted order.

```typescript
const root = findWorkspaceRootSync();
if (root) {
  const packages = getWorkspacePackagesSync(root);
  if (packages) {
    for (const pkg of packages) {
      console.log(`${pkg.name} at ${pkg.path}`);
      // example output (varies by repo): "@myorg/utils at /workspace/packages/utils"
    }
  }
}
```

### Example: lint-staged handler

Scope lint-staged commands per package by reading the workspace map at config-load time:

```javascript
// lint-staged.config.js
import {
  findWorkspaceRootSync,
  getWorkspacePackagesSync,
} from "workspaces-effect";

const root = findWorkspaceRootSync();
const packages = root ? getWorkspacePackagesSync(root) : null;

export default {
  "*.ts": (files) => {
    // Use packages list to scope commands per workspace package
    return `eslint ${files.join(" ")}`;
  },
};
```

### Differences from the Effect API

| | Effect API | Sync API |
| --- | --- | --- |
| **Import** | services + layers | standalone functions |
| **Error handling** | typed `TaggedError` values | returns `null` on failure |
| **Root package** | `listPackages()` includes root | `getWorkspacePackagesSync` includes root as first entry |
| **Caching** | per-layer request caching | no caching (re-reads on each call) |
| **Platform** | `@effect/platform` (Node, Bun) | `node:fs` and `node:path` directly |
| **Observability** | spans + structured logging | none |

The sync API is intentionally minimal. For dependency graphs, change detection or lockfile parsing, use the full Effect services.

## Next steps

- [WorkspacePackage API](./02-workspace-package.md) — the core data model with getters, dependency queries and the dual-API pattern
- [Dependency analysis](./03-dependency-analysis.md) — build dependency graphs and sort packages for build ordering
- [Change detection](./04-change-detection.md) — find affected packages from git changes
- [Lockfile parsing](./05-lockfile-parsing.md) — read and query lockfile data across all package managers
- [Publishability](./06-publishability.md) — detect which packages can be published and where
- [Architecture overview](./07-architecture-overview.md) — full service architecture and error model
