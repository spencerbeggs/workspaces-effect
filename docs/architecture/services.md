# Services Reference

Complete reference for all 9 services in workspaces-effect. Each entry includes
the service tag, its live layer, all method signatures, and error types.

All services are imported from `"workspaces-effect"`. Service methods have
`R = never` -- platform and inter-service dependencies are resolved at layer
construction time.

## Table of Contents

- [WorkspaceRoot](#workspaceroot)
- [PackageManagerDetector](#packagemanagerdetector)
- [WorkspaceDiscovery](#workspacediscovery)
- [DependencyGraph](#dependencygraph)
- [TopologicalSorter](#topologicalsorter)
- [PackageResolver](#packageresolver)
- [ChangeDetector](#changedetector)
- [LockfileReader](#lockfilereader)
- [PublishabilityDetector](#publishabilitydetector)

---

## WorkspaceRoot

Finds the monorepo root directory by walking up from a given path, looking for
workspace markers (`pnpm-workspace.yaml`, `package.json` with `workspaces`
field, lockfiles).

**Layer:** `WorkspaceRootLive`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `find(cwd: string)`

Walk up from `cwd` looking for workspace markers.

- **Returns:** `Effect<string, WorkspaceRootNotFoundError>`
- **Errors:** `WorkspaceRootNotFoundError` -- no workspace root found before
  reaching filesystem root

```typescript
const root = yield* WorkspaceRoot;
const rootPath = yield* root.find(process.cwd());
```

---

## PackageManagerDetector

Detects which package manager a workspace uses.

Detection priority:

1. pnpm -- `pnpm-workspace.yaml` exists
2. bun -- `bun.lock`/`bun.lockb` exists AND `packageManager` starts with
   `bun@`
3. yarn -- `yarn.lock` exists AND `packageManager` starts with `yarn@`
4. npm -- fallback if `package.json` has a `workspaces` field

**Layer:** `PackageManagerDetectorLive`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `detect(root: string)`

Inspect lockfiles and `package.json` at the workspace root.

- **Returns:** `Effect<DetectedPackageManager, PackageManagerDetectionError>`
- **Errors:** `PackageManagerDetectionError` -- no supported PM can be
  identified

`DetectedPackageManager` is an interface with:

- `type`: `"npm" | "pnpm" | "yarn" | "bun"`
- `version`: `string | undefined` -- extracted from the `packageManager` field
  in root `package.json`
- `runtime`: `"node" | "bun"` -- the runtime environment (bun PM implies bun
  runtime, all others are node)

```typescript
const detector = yield* PackageManagerDetector;
const pm = yield* detector.detect("/path/to/monorepo");
console.log(pm.type, pm.version, pm.runtime); // "pnpm", "9.15.4", "node"
```

---

## WorkspaceDiscovery

Lists all workspace packages by resolving glob patterns from workspace config.
The root workspace package (with `relativePath: "."`) is included as the first
entry. If no workspace configuration is found (no `pnpm-workspace.yaml` and no
`workspaces` field in `package.json`), discovery falls back to treating the root
package as a standalone single-package workspace.

**Layer:** `WorkspaceDiscoveryLive` (E channel: `never`; default-root
discovery is deferred to the first method call that omits an explicit `cwd`
and memoized via `Effect.cached`)
**Service deps:** `WorkspaceRoot`, `PackageManagerDetector`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

All methods optionally accept a `cwd` argument. When omitted, the workspace
root resolved from `process.cwd()` (lazily, on first use) is used.

#### `listPackages()`

Resolve workspace patterns and read each matched `package.json`. Returns all
packages including the root workspace.

- **Returns:**
  `Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>`

#### `getPackage(name: string)`

Get a specific workspace package by name.

- **Returns:**
  `Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>`

#### `importerMap()`

Get a map of workspace-relative directory paths to packages. Useful for mapping
lockfile importer keys to their workspace packages. Built from `listPackages()`
output and inherits its caching.

- **Returns:**
  `Effect<ReadonlyMap<string, WorkspacePackage>, WorkspaceDiscoveryError>`

```typescript
const discovery = yield* WorkspaceDiscovery;
const packages = yield* discovery.listPackages();
const core = yield* discovery.getPackage("@myorg/core");
const importers = yield* discovery.importerMap();
```

---

## DependencyGraph

Builds a directed graph of inter-workspace dependencies. Only edges between
workspace packages are included -- external npm dependencies are excluded.
Edges are derived from `dependencies`, `devDependencies`, and
`peerDependencies`.

The graph is built eagerly at layer construction time from the workspace
package list, so all queries are fast in-memory lookups.

**Layer:** `DependencyGraphLive`
**Service deps:** `WorkspaceDiscovery`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `dependenciesOf(name: string)`

Get direct workspace dependencies of a package (packages it depends on).

- **Returns:** `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `dependentsOf(name: string)`

Get packages that directly depend on the named package.

- **Returns:** `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `packages()`

Get all package names in the graph.

- **Returns:** `Effect<ReadonlyArray<string>>`

#### `hasCycle()`

Check if the graph contains any cycles.

- **Returns:** `Effect<boolean>`

#### `adjacencyMap()`

Get the full adjacency map (package name to its dependency set).

- **Returns:** `Effect<ReadonlyMap<string, ReadonlySet<string>>>`

```typescript
const graph = yield* DependencyGraph;
const deps = yield* graph.dependenciesOf("@myorg/ui");
const dependents = yield* graph.dependentsOf("@myorg/core");
const all = yield* graph.packages();
```

---

## TopologicalSorter

Sorts workspace packages in dependency order using Kahn's algorithm.
Packages with no dependencies appear first.

**Layer:** `TopologicalSorterLive`
**Service deps:** `DependencyGraph`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `sort()`

Sort all packages in topological order (dependencies first).

- **Returns:** `Effect<ReadonlyArray<string>, CyclicDependencyError>`

#### `sortSubset(names: ReadonlyArray<string>)`

Sort a subset of packages plus their transitive dependencies. Given target
package names, computes the transitive closure of their dependencies and
returns all of them in topological order.

- **Returns:**
  `Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError>`

#### `levels()`

Group packages by parallel execution level. Level 0 contains packages with no
workspace dependencies, level 1 contains packages whose dependencies are all in
level 0, and so on. Packages within the same level can be built concurrently.

- **Returns:**
  `Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError>`

```typescript
const sorter = yield* TopologicalSorter;
const order = yield* sorter.sort();
const levels = yield* sorter.levels();
const subset = yield* sorter.sortSubset(["@myorg/ui"]);
```

---

## PackageResolver

Maps file paths to their owning workspace packages using longest-prefix
matching. The path index is built from `WorkspaceDiscovery` output at layer
construction time.

**Layer:** `PackageResolverLive`
**Service deps:** `WorkspaceDiscovery`
**Platform deps:** `FileSystem`, `Path`, `CommandExecutor`
**Composite layers:** `WorkspacesFullLive` only

### Methods

#### `resolveFile(filePath: string)`

Find which package owns a file.

- **Returns:** `Effect<Option<WorkspacePackage>>`
- Returns `Option.none()` if the file is outside all workspace packages

#### `resolveFiles(filePaths: ReadonlyArray<string>)`

Batch resolve multiple file paths to packages (deduped by package name).

- **Returns:** `Effect<ReadonlyMap<string, WorkspacePackage>>`

#### `packagePaths()`

Get all indexed package paths (sorted longest-first). Useful for debugging.

- **Returns:**
  `Effect<ReadonlyArray<{ path: string; package: WorkspacePackage }>>`

```typescript
const resolver = yield* PackageResolver;
const owner = yield* resolver.resolveFile("/workspace/packages/ui/src/Button.tsx");
const packageMap = yield* resolver.resolveFiles([
  "/workspace/packages/ui/src/Button.tsx",
  "/workspace/packages/core/src/index.ts",
]);
```

---

## ChangeDetector

Git-based change detection with three levels of analysis: raw files, changed
packages, and affected packages (including transitive dependents). All git
operations use the `Command` service from `@effect/platform`.

**Layer:** `ChangeDetectorLive`
**Service deps:** `PackageResolver`, `DependencyGraph`, `TopologicalSorter`,
`WorkspaceRoot`
**Platform deps:** `FileSystem`, `Path`, `CommandExecutor`
**Composite layers:** `WorkspacesFullLive` only

### ChangeDetectionOptions

An Effect `Schema.Class` configuring the git ref range:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `base` | `string` | `"HEAD~1"` | Base git ref (commit, branch, tag) |
| `head` | `string` | `"HEAD"` | Head git ref |
| `includeUncommitted` | `boolean` | `false` | Include working tree changes |

```typescript
import { ChangeDetectionOptions } from "workspaces-effect";

const options = new ChangeDetectionOptions({ base: "origin/main" });
```

### Methods

#### `changedFiles(options: ChangeDetectionOptions)`

Get raw file paths changed between refs (relative to workspace root).

- **Returns:**
  `Effect<ReadonlyArray<string>, GitNotAvailableError | ChangeDetectionError>`

#### `changedPackages(options: ChangeDetectionOptions)`

Get workspace packages that contain changed files.

- **Returns:**
  `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError>`

#### `affectedPackages(options: ChangeDetectionOptions)`

Get changed packages plus all packages that transitively depend on them.

- **Returns:**
  `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError | CyclicDependencyError>`

```typescript
const detector = yield* ChangeDetector;
const options = new ChangeDetectionOptions({ base: "origin/main" });
const affected = yield* detector.affectedPackages(options);
```

---

## LockfileReader

Parses lockfiles from all four package managers into a unified schema. The
correct parser is selected automatically based on the detected package manager.

**Layer:** `LockfileReaderLive` (E channel: `never`; root discovery, PM
detection, lockfile read, and lockfile parse are deferred to the first method
call and memoized for the layer's lifetime via `Effect.cached`)
**Service deps:** `WorkspaceRoot`, `PackageManagerDetector`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

All four methods below carry the exported [`LockfileInitError`](#lockfileiniterror-union)
union in their E channels because their first invocation drives the lazy
init. See [Lockfile Parsing -> Lazy Initialization](../guides/lockfile-parsing.md#lazy-initialization)
for the full discussion.

### Methods

#### `readLockfile()`

Read and parse the workspace lockfile into a normalized `LockfileData`
structure.

- **Returns:** `Effect<LockfileData, LockfileInitError>`

#### `resolvedVersion(packageName: string)`

Look up the resolved version of a package in the lockfile.

- **Returns:** `Effect<Option<ResolvedPackage>, LockfileInitError>`

#### `workspaceDependencies()`

Get all workspace-to-workspace dependency links from the lockfile.

- **Returns:** `Effect<ReadonlyArray<WorkspaceDependency>, LockfileInitError>`

#### `checkIntegrity()`

Verify lockfile integrity against current `package.json` files. Returns a
`LockfileIntegrity` report on success. Fails with `LockfileIntegrityError` if
the check itself cannot complete (integrity mismatches are reported in the
returned data, not as errors). May also fail with any `LockfileInitError`
variant on first invocation.

- **Returns:** `Effect<LockfileIntegrity, LockfileIntegrityError | LockfileInitError>`

```typescript
const reader = yield* LockfileReader;
const lockfile = yield* reader.readLockfile();
const react = yield* reader.resolvedVersion("react");
const integrity = yield* reader.checkIntegrity();
```

### LockfileInitError union

```typescript
import type { LockfileInitError } from "workspaces-effect";

// LockfileInitError =
//   | WorkspaceRootNotFoundError
//   | PackageManagerDetectionError
//   | LockfileReadError
//   | LockfileParseError
```

Catch the variants individually with `Effect.catchTag` (each carries its own
`_tag`) or catch all four together by their union with `Effect.catchTags`.

---

## PublishabilityDetector

Detects whether workspace packages are publishable and identifies target
registries. This is a pure service with no external dependencies.

A package is publishable when `private` is not `true` and it has a `name` and
`version`. The returned `PublishTarget` array describes target registries.

**Layer:** `PublishabilityDetectorLive`
**Service deps:** none
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `detect(pkg: WorkspacePackage, root: string)`

Detect publish targets for a workspace package.

- **Returns:** `Effect<ReadonlyArray<PublishTarget>>`
- Empty array means the package is not publishable
- Never fails

```typescript
const publishability = yield* PublishabilityDetector;
const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
if (targets.length > 0) {
  console.log("Publishes to:", targets.map((t) => t.registry));
}
```
