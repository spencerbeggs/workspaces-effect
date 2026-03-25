# Publishability Detection

workspaces-effect can analyze which workspace packages are publishable and
identify their target registries.

## How It Works

The `PublishabilityDetector` service inspects package.json fields to determine
publishability:

- A package is **publishable** when `private` is not `true` and it has both a
  `name` and `version`
- Target registries are determined from `publishConfig.registry`, repository
  URL, and other signals

This service is pure (no filesystem or network dependencies) and works with
`WorkspacesLive`.

## Usage

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
        console.log(`  - ${target.registry}`);
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

## Publish Targets

Each `PublishTarget` returned by `detect()` includes:

- `registry` -- the npm registry URL (e.g., `https://registry.npmjs.org/`,
  `https://npm.pkg.github.com/`)
- Additional metadata about how the package would be published

An empty array means the package is not publishable. The service never fails --
it returns results for all packages without errors.

## Combining with Change Detection

A common workflow is to find affected packages and filter to only publishable
ones:

```typescript
import {
  ChangeDetector,
  ChangeDetectionOptions,
  PublishabilityDetector,
  WorkspacesFullLive,
} from "workspaces-effect";

const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const publishability = yield* PublishabilityDetector;

  const options = new ChangeDetectionOptions({ base: "origin/main" });
  const affected = yield* detector.affectedPackages(options);

  const publishable = [];
  for (const pkg of affected) {
    const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
    if (targets.length > 0) {
      publishable.push({ pkg, targets });
    }
  }

  console.log("Packages to publish:", publishable.map((p) => p.pkg.name));
});
```
