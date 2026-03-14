# Services Reference

Complete reference for all 9 services in workspaces-effect.

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

## WorkspaceRoot

Finds the monorepo root directory by walking up from a given path.

**Layer:** `WorkspaceRootLive`
**Platform deps:** FileSystem, Path

### Methods

#### `find(cwd: string)`

Walk up from `cwd` looking for workspace markers (pnpm-workspace.yaml,
package.json with workspaces field).

- Returns: `Effect<string, WorkspaceRootNotFoundError>`

```typescript
const root = yield* WorkspaceRoot;
const rootPath = yield* root.find(process.cwd());
```

## PackageManagerDetector

Detects which package manager a workspace uses.

**Layer:** `PackageManagerDetectorLive`
**Platform deps:** FileSystem, Path

Detection priority: pnpm (pnpm-workspace.yaml) > bun (bun.lock + packageManager)
\> yarn (yarn.lock + packageManager) > npm (fallback).

### Methods

#### `detect(root: string)`

Inspect lockfiles and package.json at the workspace root.

- Returns: `Effect<DetectedPackageManager, PackageManagerDetectionError>`
- `DetectedPackageManager` has `type` ("npm" | "pnpm" | "yarn" | "bun") and
  optional `version`

```typescript
const detector = yield* PackageManagerDetector;
const pm = yield* detector.detect("/path/to/monorepo");
console.log(pm.type, pm.version);
```

## WorkspaceDiscovery

Lists all workspace packages by resolving glob patterns from workspace config.

**Layer:** `WorkspaceDiscoveryLive`
**Service deps:** WorkspaceRoot, PackageManagerDetector

### Methods

#### `listPackages()`

Resolve workspace patterns and read each matched package.json.

- Returns: `Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>`

#### `getPackage(name: string)`

Get a specific workspace package by name.

- Returns: `Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>`

```typescript
const discovery = yield* WorkspaceDiscovery;
const packages = yield* discovery.listPackages();
const core = yield* discovery.getPackage("@myorg/core");
```

## DependencyGraph

Builds a directed graph of inter-workspace dependencies. External npm
dependencies are excluded. The graph is built eagerly at layer construction
time, so all queries are fast in-memory lookups.

**Layer:** `DependencyGraphLive`
**Service deps:** WorkspaceDiscovery

### Methods

#### `dependenciesOf(name: string)`

Get direct workspace dependencies of a package.

- Returns: `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `dependentsOf(name: string)`

Get packages that directly depend on the named package.

- Returns: `Effect<ReadonlyArray<string>, PackageNotFoundError>`

#### `packages()`

Get all package names in the graph.

- Returns: `Effect<ReadonlyArray<string>>`

#### `hasCycle()`

Check if the graph contains any cycles.

- Returns: `Effect<boolean>`

#### `adjacencyMap()`

Get the full adjacency map.

- Returns: `Effect<ReadonlyMap<string, ReadonlySet<string>>>`

```typescript
const graph = yield* DependencyGraph;
const deps = yield* graph.dependenciesOf("@myorg/ui");
const dependents = yield* graph.dependentsOf("@myorg/core");
```

## TopologicalSorter

Sorts workspace packages in dependency order using Kahn's algorithm.

**Layer:** `TopologicalSorterLive`
**Service deps:** DependencyGraph

### Methods

#### `sort()`

Sort all packages in topological order (dependencies first).

- Returns: `Effect<ReadonlyArray<string>, CyclicDependencyError>`

#### `sortSubset(names: ReadonlyArray<string>)`

Sort a subset of packages plus their transitive dependencies.

- Returns: `Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError>`

#### `levels()`

Group packages by parallel execution level. Packages in the same level can be
built concurrently.

- Returns: `Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError>`

```typescript
const sorter = yield* TopologicalSorter;
const order = yield* sorter.sort();

const levels = yield* sorter.levels();
for (const [i, level] of levels.entries()) {
  console.log(`Level ${i}:`, level); // Packages in same level can run in parallel
}
```

## PackageResolver

Maps file paths to their owning workspace packages using longest-prefix matching.

**Layer:** `PackageResolverLive`
**Service deps:** WorkspaceDiscovery

### Methods

#### `resolveFile(filePath: string)`

Find which package owns a file.

- Returns: `Effect<Option<WorkspacePackage>>`

#### `resolveFiles(filePaths: ReadonlyArray<string>)`

Batch resolve multiple file paths to packages (deduped).

- Returns: `Effect<ReadonlyMap<string, WorkspacePackage>>`

#### `packagePaths()`

Get all indexed package paths for debugging.

- Returns: `Effect<ReadonlyArray<{ path: string; package: WorkspacePackage }>>`

```typescript
const resolver = yield* PackageResolver;
const owner = yield* resolver.resolveFile("/workspace/packages/ui/src/Button.tsx");
```

## ChangeDetector

Git-based change detection with three levels of analysis: raw files, changed
packages, and affected packages (including transitive dependents).

**Layer:** `ChangeDetectorLive`
**Service deps:** PackageResolver, DependencyGraph, TopologicalSorter, WorkspaceRoot
**Platform deps:** FileSystem, Path, CommandExecutor

### ChangeDetectionOptions

Configure the git ref range:

```typescript
import { ChangeDetectionOptions } from "@spencerbeggs/workspaces-effect";

// Defaults: base="HEAD~1", head="HEAD", includeUncommitted=false
const defaults = new ChangeDetectionOptions({});

// Compare against a branch
const vsBranch = new ChangeDetectionOptions({ base: "origin/main" });

// Include working tree changes
const withWip = new ChangeDetectionOptions({
  base: "HEAD~3",
  includeUncommitted: true,
});
```

### Methods

#### `changedFiles(options: ChangeDetectionOptions)`

Get raw file paths changed between refs.

- Returns: `Effect<ReadonlyArray<string>, GitNotAvailableError | ChangeDetectionError>`

#### `changedPackages(options: ChangeDetectionOptions)`

Get workspace packages that contain changed files.

- Returns: `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError>`

#### `affectedPackages(options: ChangeDetectionOptions)`

Get changed packages plus all transitive dependents.

- Returns: `Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError | CyclicDependencyError>`

```typescript
const detector = yield* ChangeDetector;
const options = new ChangeDetectionOptions({ base: "origin/main" });
const affected = yield* detector.affectedPackages(options);
console.log("Rebuild:", affected.map((p) => p.name));
```

## LockfileReader

Parses lockfiles from all four package managers into a unified schema. The
correct parser is selected automatically based on the detected package manager.

**Layer:** `LockfileReaderLive`
**Service deps:** WorkspaceRoot, PackageManagerDetector

### Methods

#### `readLockfile()`

Read and parse the workspace lockfile.

- Returns: `Effect<LockfileData>`

#### `resolvedVersion(packageName: string)`

Look up a resolved package version in the lockfile.

- Returns: `Effect<Option<ResolvedPackage>>`

#### `workspaceDependencies()`

Get all workspace-to-workspace dependency links from the lockfile.

- Returns: `Effect<ReadonlyArray<WorkspaceDependency>>`

#### `checkIntegrity()`

Verify lockfile integrity against current package.json files.

- Returns: `Effect<LockfileIntegrity, LockfileIntegrityError>`

```typescript
const reader = yield* LockfileReader;
const lockfile = yield* reader.readLockfile();
console.log(`PM: ${lockfile.packageManager}, packages: ${lockfile.packages.length}`);

const react = yield* reader.resolvedVersion("react");
```

## PublishabilityDetector

Detects whether workspace packages are publishable based on package.json fields.
This is a pure service with no external dependencies.

**Layer:** `PublishabilityDetectorLive`
**Service deps:** none

A package is publishable when `private` is not `true` and it has a `name` and
`version`. The returned `PublishTarget` array describes target registries.

### Methods

#### `detect(pkg: WorkspacePackage, root: string)`

Detect publish targets for a workspace package.

- Returns: `Effect<ReadonlyArray<PublishTarget>>`
- Empty array means the package is not publishable

```typescript
const publishability = yield* PublishabilityDetector;
const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
if (targets.length > 0) {
  console.log("Publishes to:", targets.map((t) => t.registry));
}
```
