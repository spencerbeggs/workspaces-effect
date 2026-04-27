---
"workspaces-effect": minor
---

## Breaking Changes

### Sync helper returns WorkspacePackage instances

`getWorkspacePackagesSync` now returns `ReadonlyArray<WorkspacePackage>` instead of `ReadonlyArray<{ name: string; path: string }>`. The richer return shape makes the sync helper a first-class equal of `WorkspaceDiscovery.listPackages()` and lets non-Effect callers feed packages directly into services like `PublishabilityDetector` without re-reading manifests.

The function now also throws when the root `package.json` is missing required `name` or `version` fields, matching the Effect-native discovery semantics. Previously the root was silently omitted in that case.

Consumers that only need `{ name, path }` continue to work unchanged — `WorkspacePackage` exposes those fields and adds `version`, `packageJsonPath`, `relativePath`, `private`, `publishConfig`, dependency maps, and computed getters like `isRootWorkspace`.

## Features

### Optional cwd parameter on WorkspaceDiscovery methods

`listPackages`, `importerMap`, and `getPackage` now accept an optional `cwd` argument. When provided, the workspace root is resolved fresh from that directory for the call; results are cached per resolved root for the lifetime of the layer. When omitted, the methods use the root that was eagerly resolved from `process.cwd()` at layer construction time, preserving existing behaviour.

This removes the need for a custom `WorkspaceRoot` layer when a downstream consumer just wants to discover packages at a specific path — useful for tests that load fixtures into temp directories and for tools (CI actions, etc.) that operate on a path supplied by the caller rather than the process working directory.

```ts
const discovery = yield* WorkspaceDiscovery;
const packages = yield* discovery.listPackages("/tmp/fixture-monorepo");
```

### README documents custom publishability detectors

A new "Custom publishability detectors" section in the README shows how to override `PublishabilityDetector` with `Layer.succeed(PublishabilityDetector, customImpl)`. The pattern was already supported but undocumented; downstream packages that need non-vanilla publish semantics (mirroring to a private registry, organisation conventions, etc.) now have a clear extension point.
