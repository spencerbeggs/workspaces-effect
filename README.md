# workspaces-effect

[![npm version](https://img.shields.io/npm/v/workspaces-effect)](https://www.npmjs.com/package/workspaces-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)

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

## Custom publishability detectors

`PublishabilityDetector` is a `Context.Tag` like every other service, so you can
swap the default implementation with `Layer.succeed` when you need
non-vanilla publish semantics (e.g. private packages that should still publish
under specific conditions, registry-aware target expansion, organisation
conventions). Provide your custom layer instead of `PublishabilityDetectorLive`
-- everything downstream that yields `PublishabilityDetector` picks up the new
behaviour transparently.

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
// target -- a common requirement for orgs that mirror to a private registry.
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

The same pattern applies to any other service in the library -- `WorkspaceRoot`,
`PackageManagerDetector`, `LockfileReader`, etc. all expose `Context.Tag`s
that consumers can rebind.

## Observability

`workspaces-effect` is silent at the default log level. Internal
events (workspace root discovery, package manager detection, lockfile
reads, change detection, etc.) are emitted via Effect's structured
logger at `Debug` level with annotations like `workspace.root`,
`workspace.pm`, and `workspace.packages.count`.

To see those events, lower the minimum log level:

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

To route events somewhere other than the console (a collector,
OpenTelemetry, a test sink, etc.), replace or add a logger:

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

Errors are still raised through the typed error channel
(`WorkspaceRootNotFoundError`, `LockfileReadError`, etc.) -- the
logger only carries informational events.

## Lazy lockfile and discovery initialization

`LockfileReaderLive` and `WorkspaceDiscoveryLive` defer all I/O (workspace
root discovery, package-manager detection, lockfile read, and lockfile parse)
to the first call to a service method. The work is memoized for the lifetime
of the layer instance via `Effect.cached`, so layer construction itself is
O(1). This benefits consumers that build the layer per call site -- Vitest
reporters with multiple projects, CLIs that compose layers per subcommand,
and tests that swap layers between cases (issue #60).

The trade-off is that errors which used to fail
`Effect.provide(LockfileReaderLive)` now surface from each method's E
channel instead. The four init-time errors are exported as a single union
type alias for convenient handling:

```typescript
import type { LockfileInitError } from "workspaces-effect";

// LockfileInitError =
//   | WorkspaceRootNotFoundError
//   | PackageManagerDetectionError
//   | LockfileReadError
//   | LockfileParseError
```

Every `LockfileReader` method (`readLockfile`, `resolvedVersion`,
`workspaceDependencies`, `checkIntegrity`) lists `LockfileInitError` in its E
channel; `checkIntegrity` additionally lists `LockfileIntegrityError`. Code
that previously relied on layer-construction failure should move its handler
to the call site:

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

See the [Lazy Initialization](./docs/guides/lockfile-parsing.md#lazy-initialization)
section of the lockfile guide for the full discussion.

## Documentation

For architecture details, API reference, and advanced usage, see
[docs/](./docs).

## License

[MIT](./LICENSE)
