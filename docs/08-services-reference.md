# Services reference

Every service in workspaces-effect, with its tag, live layer, method signatures and error types.

All services are imported from `"workspaces-effect"`. Service methods have `R = never` — platform and inter-service dependencies are resolved at layer construction time.

## Table of contents

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

Walks up from a given path to find the monorepo root. Markers checked at each level: `pnpm-workspace.yaml`, a `package.json` with a `workspaces` field, or a lockfile.

**Layer:** `WorkspaceRootLive`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `find(cwd: string)`

Walk up from `cwd` looking for workspace markers.

- **Returns:** `Effect<string, WorkspaceRootNotFoundError>`
- **Errors:** `WorkspaceRootNotFoundError` — reached the filesystem root without finding a marker

```typescript
const root = yield* WorkspaceRoot;
const rootPath = yield* root.find(process.cwd());
```

---

## PackageManagerDetector

Detects which package manager a workspace uses.

Detection priority:

1. pnpm — `pnpm-workspace.yaml` exists
2. bun — `bun.lock` or `bun.lockb` exists AND `packageManager` starts with `bun@`
3. yarn — `yarn.lock` exists AND `packageManager` starts with `yarn@`
4. npm — fallback when `package.json` has a `workspaces` field

**Layer:** `PackageManagerDetectorLive`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `detect(root: string)`

Inspect lockfiles and `package.json` at the workspace root.

- **Returns:** `Effect<DetectedPackageManager, PackageManagerDetectionError>`
- **Errors:** `PackageManagerDetectionError` — none of the four supported package managers matched

`DetectedPackageManager` is an interface with:

- `type`: `"npm" | "pnpm" | "yarn" | "bun"`
- `version`: `string | undefined` — extracted from the `packageManager` field in root `package.json`
- `runtime`: `"node" | "bun"` — bun package manager implies bun runtime; the rest run on node

```typescript
const detector = yield* PackageManagerDetector;
const pm = yield* detector.detect("/path/to/monorepo");
console.log(pm.type, pm.version, pm.runtime);
// example output (varies): "pnpm <version> node"
```

---

## WorkspaceDiscovery

Resolves the workspace glob patterns and reads each matched `package.json`. The root workspace (with `relativePath: "."`) is the first entry in the returned list. When neither `pnpm-workspace.yaml` nor a `workspaces` field is present, discovery falls back to treating the root as a single-package workspace.

**Layer:** `WorkspaceDiscoveryLive` (E channel: `never`; default-root discovery is deferred to the first method call that omits an explicit `cwd` and memoized via `Effect.cached`)
**Service deps:** `WorkspaceRoot`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

Every method takes an optional `cwd`. Omit it and the service resolves the workspace root from `process.cwd()` once, then memoizes.

#### `listPackages()`

Returns all workspace packages, root included.

- **Returns:** `Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>`

#### `getPackage(name: string)`

Returns a single workspace package by name.

- **Returns:** `Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>`

#### `importerMap()`

Returns a map keyed by workspace-relative directory path. Useful for cross-referencing lockfile importer keys against workspace packages. Derived from `listPackages()` and shares its cache.

- **Returns:** `Effect<ReadonlyMap<string, WorkspacePackage>, WorkspaceDiscoveryError>`

```typescript
const discovery = yield* WorkspaceDiscovery;
const packages = yield* discovery.listPackages();
const core = yield* discovery.getPackage("@myorg/core");
const importers = yield* discovery.importerMap();
```

---

## DependencyGraph

A directed graph of inter-workspace dependencies. Edges come from `dependencies`, `devDependencies` and `peerDependencies`; external npm packages are not vertices.

The graph is built once at layer construction time from the workspace package list. Every query is an in-memory lookup.

**Layer:** `DependencyGraphLive`
**Service deps:** `WorkspaceDiscovery`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `dependenciesOf(name: string)`

The workspace packages that `name` depends on directly.

- **Returns:** `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `dependentsOf(name: string)`

The workspace packages that depend on `name` directly.

- **Returns:** `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `packages()`

All package names in the graph.

- **Returns:** `Effect<ReadonlyArray<string>>`

#### `hasCycle()`

True if the graph contains a cycle.

- **Returns:** `Effect<boolean>`

#### `adjacencyMap()`

The full adjacency map: package name to its dependency set.

- **Returns:** `Effect<ReadonlyMap<string, ReadonlySet<string>>>`

```typescript
const graph = yield* DependencyGraph;
const deps = yield* graph.dependenciesOf("@myorg/ui");
const dependents = yield* graph.dependentsOf("@myorg/core");
const all = yield* graph.packages();
```

---

## TopologicalSorter

Topological sort of workspace packages via Kahn's algorithm. Packages with no dependencies come first.

**Layer:** `TopologicalSorterLive`
**Service deps:** `DependencyGraph`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `sort()`

All packages in topological order, dependencies first.

- **Returns:** `Effect<ReadonlyArray<string>, CyclicDependencyError>`

#### `sortSubset(names: ReadonlyArray<string>)`

Given a list of target packages, returns the transitive closure of their dependencies plus the targets themselves, in topological order.

- **Returns:** `Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError>`

#### `levels()`

Packages grouped into parallel execution levels. Level 0 has no workspace dependencies, level 1 depends only on level 0, and so on. Anything inside a single level is safe to build concurrently.

- **Returns:** `Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError>`

```typescript
const sorter = yield* TopologicalSorter;
const order = yield* sorter.sort();
const levels = yield* sorter.levels();
const subset = yield* sorter.sortSubset(["@myorg/ui"]);
```

---

## PackageResolver

Maps file paths to the workspace package that owns them. The match is longest-prefix; the path index is built from `WorkspaceDiscovery` output at layer construction time.

**Layer:** `PackageResolverLive`
**Service deps:** `WorkspaceDiscovery`
**Platform deps:** `FileSystem`, `Path`, `CommandExecutor`
**Composite layers:** `WorkspacesFullLive` only

### Methods

#### `resolveFile(filePath: string)`

The package that owns `filePath`, or `Option.none()` when the file is outside every workspace package.

- **Returns:** `Effect<Option<WorkspacePackage>>`

#### `resolveFiles(filePaths: ReadonlyArray<string>)`

Resolves many paths at once, deduplicated by package name.

- **Returns:** `Effect<ReadonlyMap<string, WorkspacePackage>>`

#### `packagePaths()`

The indexed package paths, sorted longest-first. Mostly useful when debugging a misclassified file.

- **Returns:** `Effect<ReadonlyArray<{ path: string; package: WorkspacePackage }>>`

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

Git-based change detection at three levels: raw files, the packages that contain them and the packages transitively affected by them. Git invocations go through the `Command` service from `@effect/platform`.

**Layer:** `ChangeDetectorLive`
**Service deps:** `PackageResolver`, `DependencyGraph`, `TopologicalSorter`, `WorkspaceRoot`
**Platform deps:** `FileSystem`, `Path`, `CommandExecutor`
**Composite layers:** `WorkspacesFullLive` only

### ChangeDetectionOptions

A `Schema.Class` that configures the git ref range:

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

The file paths changed between the two refs, relative to the workspace root.

- **Returns:** `Effect<ReadonlyArray<string>, GitNotAvailableError | ChangeDetectionError>`

#### `changedPackages(options: ChangeDetectionOptions)`

The workspace packages that contain at least one changed file.

- **Returns:** `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError>`

#### `affectedPackages(options: ChangeDetectionOptions)`

Changed packages plus everything that transitively depends on them.

- **Returns:** `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError | CyclicDependencyError>`

```typescript
const detector = yield* ChangeDetector;
const options = new ChangeDetectionOptions({ base: "origin/main" });
const affected = yield* detector.affectedPackages(options);
```

---

## LockfileReader

Parses the lockfile of any of the four supported package managers into a unified schema. The parser is selected from `PackageManagerDetector` output.

**Layer:** `LockfileReaderLive` (E channel: `never`; root discovery, PM detection, lockfile read and lockfile parse are deferred to the first method call and memoized for the layer's lifetime via `Effect.cached`)
**Service deps:** `WorkspaceRoot`, `PackageManagerDetector`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

All four methods carry the exported [`LockfileInitError`](#lockfileiniterror-union) union in their E channels because the first call drives the lazy init. See [Lockfile parsing -> Lazy initialization](./05-lockfile-parsing.md#lazy-initialization) for the longer write-up.

### Methods

#### `readLockfile()`

Reads the workspace lockfile and parses it into the normalized `LockfileData` shape.

- **Returns:** `Effect<LockfileData, LockfileInitError>`

#### `resolvedVersion(packageName: string)`

The resolved version of `packageName` in the lockfile, or `Option.none()` if it is not present.

- **Returns:** `Effect<Option<ResolvedPackage>, LockfileInitError>`

#### `workspaceDependencies()`

The workspace-to-workspace dependency links recorded in the lockfile.

- **Returns:** `Effect<ReadonlyArray<WorkspaceDependency>, LockfileInitError>`

#### `checkIntegrity()`

Verifies lockfile integrity against the current `package.json` files and returns a `LockfileIntegrity` report. Mismatches show up as fields on the report — they are not errors. The effect fails with `LockfileIntegrityError` only when the check itself cannot complete, and with `LockfileInitError` variants on the first call.

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

Each variant carries its own `_tag`. Catch them individually with `Effect.catchTag` or all four at once with `Effect.catchTags`.

---

## PublishabilityDetector

Decides whether a workspace package is publishable and to which registries. A pure service — no I/O, no other services to wire up.

A package is publishable when it has a `name` and `version` and `private` is not `true`. The returned `PublishTarget` array describes the registries it would publish to.

**Layer:** `PublishabilityDetectorLive`
**Service deps:** none
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

#### `detect(pkg: WorkspacePackage, root: string)`

The publish targets for `pkg`. An empty array means the package is not publishable. Never fails.

- **Returns:** `Effect<ReadonlyArray<PublishTarget>>`

```typescript
const publishability = yield* PublishabilityDetector;
const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
if (targets.length > 0) {
  console.log("Publishes to:", targets.map((t) => t.registry));
  // example output (varies): Publishes to: ["https://registry.npmjs.org/"]
}
```
