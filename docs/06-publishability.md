# Publishability detection

The `PublishabilityDetector` service tells you which workspace packages are publishable and where they publish to.

## Table of contents

- [How it works](#how-it-works)
- [Basic usage](#basic-usage)
- [PublishTarget schema](#publishtarget-schema)
- [Combining with change detection](#combining-with-change-detection)
- [Example: selective publishing](#example-selective-publishing)

## How it works

The detector reads `package.json` fields. The rules:

- A package is publishable unless it sets `"private": true` without a `publishConfig.access` override.
- The target's `registry`, `directory` and `access` come straight from `publishConfig`. Missing fields get defaults: the public npm registry, the package root and `"public"`.
- The service is pure. No filesystem, no network. It runs under `WorkspacesLive`.
- `detect()` never fails. Non-publishable packages return an empty array.

## Basic usage

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
        // example output (varies): "  - https://registry.npmjs.org (public)"
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

The second argument to `detect()` is the workspace root path. The detector uses it to resolve relative publish directories.

## PublishTarget schema

Each `PublishTarget` returned by `detect()` is an Effect `Schema.Class` with these fields:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Package name |
| `registry` | `string` | Target registry URL (e.g. `"https://registry.npmjs.org"`) |
| `directory` | `string` | Directory to publish (empty string means package root) |
| `access` | `"public" \| "restricted"` | Scoped package visibility |
| `provenance` | `boolean` | Whether to publish with provenance attestation (default: `false`) |

An empty array from `detect()` means the package is not publishable.

## Combining with change detection

Pair the detector with `ChangeDetector` to filter affected packages down to the publishable ones. Change detection needs git, so use `WorkspacesFullLive`:

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
  // example output (varies): Packages to publish: ["@myorg/ui", "@myorg/core"]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

## Example: selective publishing

A CI script that finds affected packages, filters to publishable ones and emits them in topological order:

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
  // example output (varies): Publish order: ["@myorg/utils", "@myorg/core", "@myorg/ui"]
});

Effect.runPromise(
  publish.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```
