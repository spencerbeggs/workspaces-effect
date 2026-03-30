# Publishability Detection

workspaces-effect can analyze which workspace packages are publishable and
identify their target registries via the `PublishabilityDetector` service.

## Table of Contents

- [How It Works](#how-it-works)
- [Basic Usage](#basic-usage)
- [PublishTarget Schema](#publishtarget-schema)
- [Combining with Change Detection](#combining-with-change-detection)
- [Example: Selective Publishing](#example-selective-publishing)

## How It Works

The `PublishabilityDetector` service inspects `package.json` fields to determine
publishability:

- A package is **publishable** when `private` is not `true` and it has both a
  `name` and `version`
- Target registries come from `publishConfig.registry`, `publishConfig.targets`,
  repository URL, and other signals
- The service is **pure** -- it has no filesystem or network dependencies and
  works with `WorkspacesLive`
- It **never fails** -- non-publishable packages return an empty array

## Basic Usage

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  PublishabilityDetector,
  WorkspaceDiscovery,
  WorkspacesLive,
} from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const publishability = yield* PublishabilityDetector;
  const packages = yield* discovery.listPackages();

  for (const pkg of packages.filter((p) => !p.isRootWorkspace)) {
    const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
    if (targets.length > 0) {
      console.log(`${pkg.name} publishes to:`);
      for (const target of targets) {
        console.log(`  - ${target.registry} (${target.access})`);
      }
    } else {
      console.log(`${pkg.name} is private (not publishable)`);
    }
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

The second argument to `detect()` is the workspace root path, used for
resolving relative publish directories.

## PublishTarget Schema

Each `PublishTarget` returned by `detect()` is an Effect `Schema.Class` with
these fields:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Package name |
| `registry` | `string` | Target registry URL (e.g., `"https://registry.npmjs.org"`) |
| `directory` | `string` | Directory to publish (empty string means package root) |
| `access` | `"public" \| "restricted"` | Scoped package visibility |
| `provenance` | `boolean` | Whether to publish with provenance attestation (default: `false`) |

An empty array from `detect()` means the package is not publishable.

## Combining with Change Detection

A common workflow is to find affected packages and filter to only publishable
ones. This requires `WorkspacesFullLive` since change detection needs git:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  ChangeDetector,
  ChangeDetectionOptions,
  PublishabilityDetector,
  WorkspaceRoot,
  WorkspacesFullLive,
} from "workspaces-effect";

const program = Effect.gen(function* () {
  const root = yield* WorkspaceRoot;
  const rootPath = yield* root.find(process.cwd());
  const detector = yield* ChangeDetector;
  const publishability = yield* PublishabilityDetector;

  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const affected = yield* detector.affectedPackages(options);

  const publishable = [];
  for (const pkg of affected) {
    const targets = yield* publishability.detect(pkg, rootPath);
    if (targets.length > 0) {
      publishable.push({ pkg, targets });
    }
  }

  console.log(
    "Packages to publish:",
    publishable.map((p) => p.pkg.name),
  );
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Example: Selective Publishing

A complete CI publishing script that builds and publishes only the affected,
publishable packages in the correct order:

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  ChangeDetector,
  ChangeDetectionOptions,
  PublishabilityDetector,
  TopologicalSorter,
  WorkspaceDiscovery,
  WorkspaceRoot,
  WorkspacesFullLive,
} from "workspaces-effect";

const publish = Effect.gen(function* () {
  const root = yield* WorkspaceRoot;
  const rootPath = yield* root.find(process.cwd());
  const detector = yield* ChangeDetector;
  const publishability = yield* PublishabilityDetector;
  const sorter = yield* TopologicalSorter;

  // 1. Find affected packages
  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const affected = yield* detector.affectedPackages(options);

  // 2. Filter to publishable
  const toPublish: string[] = [];
  for (const pkg of affected) {
    const targets = yield* publishability.detect(pkg, rootPath);
    if (targets.length > 0) {
      toPublish.push(pkg.name);
    }
  }

  if (toPublish.length === 0) {
    console.log("No publishable packages affected.");
    return;
  }

  // 3. Sort for correct publish order
  const publishOrder = yield* sorter.sortSubset(toPublish);
  console.log("Publish order:", publishOrder);
});

Effect.runPromise(
  publish.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```
