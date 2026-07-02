# workspaces-effect

[![npm](https://img.shields.io/npm/v/workspaces-effect?label=npm&color=cb3837)](https://www.npmjs.com/package/workspaces-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)

An [Effect](https://effect.website) library for monorepo tooling. It discovers workspaces, builds dependency graphs, detects changes from git, parses lockfiles and reports which packages are publishable. Supports npm, pnpm, yarn Berry and Bun workspaces, runs on Node.js or Bun.

## Features

- Workspace discovery for npm, pnpm, yarn Berry and Bun, with package-manager detection done for you
- Package metadata with computed getters, dependency queries and a dual API (instance methods, static data-first functions, pipeable variants)
- Dependency graph with topological sort, parallel build levels and cycle detection
- Git-driven change detection that returns the affected packages for a diff
- Lockfile parsing for all four package managers, including integrity checks against `package.json` ranges
- Catalog resolution that rewrites `catalog:` and `workspace:` specifiers to concrete versions, assembling pnpm catalogs from inline, config-dependency and lockfile sources (`workspace:` still resolves on npm, yarn and Bun)
- Point-in-time workspace reading — packages and catalogs as they existed at any git ref, or the live working tree, without checking anything out
- Runs on Node.js or Bun via `@effect/platform` adapters — no `node:` imports leak into your code
- Synchronous helpers (`findWorkspaceRootSync`, `getWorkspacePackagesSync`) for places Effect cannot reach, like lint-staged hooks

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

## Quick start

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
    // example output (varies): "utils (public)"

    // Instance method
    if (pkg.hasAnyDependencyOn("effect")) {
      const version = pkg.dependencyVersion("effect");
      console.log("  effect:", Option.getOrElse(version, () => "n/a"));
      // example output (varies): "  effect: <version>"
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

Two composite layers handle the common wiring:

- **`WorkspacesLive`** — every service except change detection (requires `FileSystem` + `Path`)
- **`WorkspacesFullLive`** — adds change detection (also requires `CommandExecutor`)

## Custom publishability detectors

`PublishabilityDetector` is a `Context.Tag` like every other service. Swap the default with `Layer.succeed` when you need different publish semantics — private packages that should still publish under specific conditions, registry-aware target expansion, organisation conventions. Provide your custom layer instead of `PublishabilityDetectorLive` and every consumer that yields `PublishabilityDetector` gets the new behavior.

```typescript
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  PublishabilityDetector,
  PublishTarget,
  WorkspaceDiscovery,
  WorkspacesLive,
} from "workspaces-effect";

// Always publish to GitHub Packages alongside the package's own publishConfig
// target — common for orgs that mirror to a private registry.
const ORG_REGISTRY = "https://npm.pkg.github.com/";

const OrgMirrorDetector = Layer.succeed(PublishabilityDetector, {
  detect: (pkg, _root) =>
    Effect.sync(() => {
      if (pkg.private && !pkg.publishConfig?.access) return [];

      const primary = new PublishTarget({
        name: pkg.name,
        registry: pkg.publishConfig?.registry ?? "https://registry.npmjs.org/",
        directory: pkg.publishConfig?.directory ?? ".",
        access: pkg.publishConfig?.access ?? "public",
        provenance: false,
      });

      const mirror = new PublishTarget({
        name: pkg.name,
        registry: ORG_REGISTRY,
        directory: pkg.publishConfig?.directory ?? ".",
        access: pkg.publishConfig?.access ?? "restricted",
        provenance: false,
      });

      return primary.registry === mirror.registry ? [primary] : [primary, mirror];
    }),
});

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const detector = yield* PublishabilityDetector;
  for (const pkg of yield* discovery.listPackages()) {
    const targets = yield* detector.detect(pkg, "/path/to/root");
    if (targets.length > 0) console.log(pkg.name, targets.map((t) => t.registry));
    // example output (varies): "@myorg/ui ['https://registry.npmjs.org/', 'https://npm.pkg.github.com/']"
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(OrgMirrorDetector),
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

`WorkspaceRoot`, `PackageManagerDetector`, `LockfileReader` and every other service in the library expose `Context.Tag`s, so the same swap works for any of them.

## Observability

`workspaces-effect` says nothing at the default log level. Internal events — workspace root discovery, package manager detection, lockfile reads, change detection and the rest — go through Effect's structured logger at `Debug` level with annotations like `workspace.root`, `workspace.pm` and `workspace.packages.count`.

To see them, lower the minimum log level:

```typescript
import { Effect, Logger, LogLevel } from "effect";

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
    Logger.withMinimumLogLevel(LogLevel.Debug),
  ),
);
```

To send events somewhere other than the console — a collector, OpenTelemetry, a test sink — replace or add a logger:

```typescript
import { Effect, Logger } from "effect";

const collectingLogger = Logger.make(({ logLevel, message, annotations }) => {
  // ship to your destination of choice; logLevel is usually what you route on
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
    Effect.provide(Logger.replace(Logger.defaultLogger, collectingLogger)),
  ),
);
```

Errors still travel through the typed error channel (`WorkspaceRootNotFoundError`, `LockfileReadError` and the rest). The logger only carries informational events.

## Lazy lockfile and discovery initialization

`LockfileReaderLive` and `WorkspaceDiscoveryLive` defer every bit of I/O — root discovery, package-manager detection, lockfile read, lockfile parse — until the first service method runs. The work is memoized for the layer's lifetime via `Effect.cached`, so layer construction is O(1). That matters when you build the layer per call site, like a Vitest reporter that spans multiple projects or a CLI that composes layers per subcommand.

Init-time errors surface from each method's E channel as members of an exported union:

```typescript
import type { LockfileInitError } from "workspaces-effect";

// LockfileInitError =
//   | WorkspaceRootNotFoundError
//   | PackageManagerDetectionError
//   | LockfileReadError
//   | LockfileParseError
```

Every `LockfileReader` method (`readLockfile`, `resolvedVersion`, `workspaceDependencies`, `checkIntegrity`) lists `LockfileInitError` in its E channel. `checkIntegrity` adds `LockfileIntegrityError`. Handle them at the call site, not around `Effect.provide`:

```typescript
import { Effect } from "effect";
import { LockfileReader, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const reader = yield* LockfileReader;
  return yield* reader.readLockfile();
}).pipe(
  Effect.catchTag("LockfileReadError", (e) =>
    Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`),
  ),
  Effect.catchTag("LockfileParseError", (e) =>
    Effect.logError(`Cannot parse ${e.format} lockfile at ${e.lockfilePath}`),
  ),
);
```

The [Lazy initialization](./docs/05-lockfile-parsing.md#lazy-initialization) section of the lockfile guide goes deeper.

## Point-in-time workspace reading

`PointInTimeWorkspace` reads workspace state as it existed at any git ref, or the live working tree, without checking anything out. `at(ref)` reads each package's `package.json` and the workspace's pnpm catalogs via `git show`/`git ls-tree`; `worktree()` reads the same shape off disk via `WorkspaceDiscovery`. Both return a `WorkspaceStateSnapshot` — packages plus an assembled `CatalogSet` — so `catalog:`/`workspace:` specifiers resolve against the state as it existed *then*, not against the current tree.

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { PointInTimeWorkspace, WorkspacesFullLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const pointInTime = yield* PointInTimeWorkspace;

  const atMainTip = yield* pointInTime.at("main");
  const live = yield* pointInTime.worktree();

  // Compare a package's declared version across the two snapshots
  const before = atMainTip.package("my-lib");
  const after = live.package("my-lib");

  // Resolve a catalog: specifier as it existed at that ref
  const resolved = atMainTip.resolve("effect", "catalog:default");
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

`CatalogSet` (`fromWorkspaceYaml`, `fromLockfileCatalogs`, `merge`, `resolveSpecifier`) and `WorkspaceStateSnapshot` (`packages`, `catalogs`, `resolve`) are exported directly for building your own point-in-time comparisons. `PointInTimeWorkspace` is wired into `WorkspacesFullLive`; both methods fail with `PointInTimeReadError` (`GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError`).

## Documentation

- [Getting started](./docs/01-getting-started.md) — installation, first program, layers, platform setup and synchronous utilities
- [WorkspacePackage API](./docs/02-workspace-package.md) — computed getters, dependency queries, dual-API pattern, diffs, PublishConfig and readPackageJson
- [Dependency analysis](./docs/03-dependency-analysis.md) — dependency graphs, topological sorting, parallel build levels and cycle detection
- [Change detection](./docs/04-change-detection.md) — git-based change detection, affected packages and CI pipeline integration
- [Lockfile parsing](./docs/05-lockfile-parsing.md) — unified lockfile reading, resolved versions, workspace dependencies, integrity checking and PM extensions
- [Publishability](./docs/06-publishability.md) — detecting publishable packages, publish targets and selective publishing workflows
- [Architecture overview](./docs/07-architecture-overview.md) — service groups, layer composition, platform independence and error model
- [Services reference](./docs/08-services-reference.md) — API reference for every service
- [Troubleshooting](./docs/09-troubleshooting.md) — every error type with causes and solutions

## License

[MIT](LICENSE)
