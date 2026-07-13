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
- [PointInTimeWorkspace](#pointintimeworkspace)
- [LockfileReader](#lockfilereader)
- [CatalogResolver](#catalogresolver)
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

1. `devEngines.packageManager` in the root `package.json` names one of the four supported managers
2. pnpm — `pnpm-workspace.yaml` exists
3. bun — `bun.lock` or `bun.lockb` exists AND `packageManager` starts with `bun@`
4. yarn — `yarn.lock` exists AND `packageManager` starts with `yarn@`
5. npm — fallback when `package.json` has a `workspaces` field

**Layer:** `PackageManagerDetectorLive`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### devEngines.packageManager

`devEngines.packageManager` is the declarative statement of intent a repo makes about its package manager, so it outranks file presence: a repo carrying a stale `pnpm-workspace.yaml` while `devEngines` says `bun` is detected as bun. Both shapes the npm spec allows are accepted — a single object, or an array of them, in which case the first entry is used:

```json
{
  "devEngines": {
    "packageManager": { "name": "bun", "version": "^1.2.0", "onFail": "error" }
  }
}
```

```json
{
  "devEngines": {
    "packageManager": [{ "name": "pnpm", "version": "^10.0.0" }]
  }
}
```

Rules:

- A name outside `npm` / `pnpm` / `yarn` / `bun` is ignored and detection falls through to the lockfile chain below. So is a missing, malformed or unreadable `devEngines` block — it is a hint, never a hard failure.
- **Version precedence:** when `devEngines` and the `packageManager` field name the *same* manager, the `packageManager` field supplies the version, because it is an exact pin while `devEngines.version` may be a range. Otherwise the `devEngines` version is used, and it may be `undefined`.

### Methods

#### `detect(root: string)`

Inspect `devEngines.packageManager`, then lockfiles and the `packageManager` field, at the workspace root.

- **Returns:** `Effect<DetectedPackageManager, PackageManagerDetectionError>`
- **Errors:** `PackageManagerDetectionError` — none of the four supported package managers matched

`DetectedPackageManager` is an interface with:

- `type`: `"npm" | "pnpm" | "yarn" | "bun"`
- `version`: `string | undefined` — from the `packageManager` field in root `package.json`, or from `devEngines.packageManager.version` when that is the only source (see the precedence rule above)
- `runtime`: `"node" | "bun"` — bun package manager implies bun runtime; the rest run on node

```typescript
const detector = yield* PackageManagerDetector;
const pm = yield* detector.detect("/path/to/monorepo");
console.log(pm.type, pm.version, pm.runtime);
// example output (varies): "pnpm <version> node"
```

---

## WorkspaceDiscovery

Resolves the workspace glob patterns and reads each matched `package.json`. The root workspace (with `relativePath: "."`) is the first entry in the returned list. When neither `pnpm-workspace.yaml` nor a `workspaces` field is present, the root itself becomes the single workspace.

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

Returns a map keyed by workspace-relative directory path. Use it to cross-reference lockfile importer keys against workspace packages. Derived from `listPackages()` and shares its cache.

- **Returns:** `Effect<ReadonlyMap<string, WorkspacePackage>, WorkspaceDiscoveryError>`

#### `refresh()`

Discards the cached package list so the next `listPackages()` (and `getPackage()` / `importerMap()`, which build on it) re-reads every `package.json` from disk. The resolved workspace root is kept — the root does not move when package contents change — so the next call pays only for the package re-scan, not the root walk. Use it after a process mutates `package.json` files mid-run, such as running `changeset version` and then reading the bumped versions back.

- **Returns:** `Effect<void>`

```typescript
const discovery = yield* WorkspaceDiscovery;
const packages = yield* discovery.listPackages();
const core = yield* discovery.getPackage("@myorg/core");
const importers = yield* discovery.importerMap();

// After mutating package.json files on disk:
yield* discovery.refresh();
const updated = yield* discovery.listPackages(); // re-read from disk
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

## PointInTimeWorkspace

Reads workspace state — packages plus assembled catalogs — at any git ref or from the live working tree, without checking anything out. Git reads go through `git show` and `git ls-tree` over `CommandExecutor`.

**Layer:** `PointInTimeWorkspaceLive`
**Service deps:** `WorkspaceRoot`, `WorkspaceDiscovery`
**Platform deps:** `FileSystem`, `Path`, `CommandExecutor`
**Composite layers:** `WorkspacesFullLive` only

### Where globs and catalogs are read from

Both methods pick the manifest format by **file presence**, not by `PackageManagerDetector`:

| At the workspace root | Workspace globs | Inline catalogs |
| --- | --- | --- |
| `pnpm-workspace.yaml` present | its `packages:` key | its `catalog:` / `catalogs:` keys |
| `pnpm-workspace.yaml` absent | root `package.json` `workspaces` (array form, or the object form's `packages`) | root `package.json` `workspaces.catalog` (the `"default"` catalog) and `workspaces.catalogs` (named catalogs) |

That is the same rule `WorkspaceDiscovery` already applies to globs, so live and point-in-time reads stay consistent — and unlike package-manager detection it is meaningful at a *git ref*, where there is no working tree to detect against. Without this fallback an `at(ref)` read of a bun or npm workspace collapsed to the root package alone.

The reader is exported: `parsePackageJsonWorkspaces(content)` yields the `PackageJsonWorkspaces` slice (`packages`, `catalog`, `catalogs`), and `catalogSetFromPackageJson(content)` yields a `CatalogSet` built from it. Both fail with `CatalogAssemblyError` when the text is not valid JSON — which means a **malformed root `package.json` in a repo with no `pnpm-workspace.yaml` now fails the read** instead of being silently ignored.

Bun's `bun.lock` catalogs are deliberately not read here: for bun the root `package.json` is the inline authority and the lockfile only mirrors it. The lockfile's view stays available on `LockfileData.pmSpecific` (`BunExtension.catalog` / `.catalogs`).

### Methods

Both methods take an optional `PointInTimeOptions` object with one field, `cwd` — a starting directory the workspace root is resolved from by walking up, the same semantics as `WorkspaceDiscovery`. Omit it and the walk starts at `process.cwd()`.

#### `at(ref: string, options?: PointInTimeOptions)`

Workspace state as of `ref` (SHA, branch or tag). Reads `pnpm-workspace.yaml` (falling back to the root `package.json` `workspaces` field when it is absent), `pnpm-lock.yaml` and each package's `package.json` at the ref; a file absent at the ref is skipped, not an error. Snapshots are cached per resolved root and ref: the cache holds 64 entries, evicts the least recently used past that and never caches failures, so a failed read retries on the next call. Workspace globs — `!` negations included — go through the same pattern core as live discovery; expansion is one directory level deep at the ref (`packages/**` is treated as `packages/*`).

- **Returns:** `Effect<WorkspaceStateSnapshot, PointInTimeAtError>`

#### `worktree(options?: PointInTimeOptions)`

Workspace state of the live working tree. Packages come from `WorkspaceDiscovery`; catalogs come from the on-disk `pnpm-workspace.yaml` (or the root `package.json` `workspaces` field when there is no `pnpm-workspace.yaml`) and `pnpm-lock.yaml`. Uncached — every call re-reads. A `configDependencies` edit that has not been `pnpm install`ed yet is invisible: pnpmfile hook replay is an overlay only the live `CatalogResolver` applies by default, so snapshots see injected catalogs through the lockfile record.

- **Returns:** `Effect<WorkspaceStateSnapshot, PointInTimeWorktreeError>`

```typescript
const pointInTime = yield* PointInTimeWorkspace;
const atRef = yield* pointInTime.at("origin/main");
const live = yield* pointInTime.worktree();

const wasThere = atRef.package("@myorg/ui"); // Option<PackageStateSnapshot>
const range = atRef.resolve("effect", "catalog:default"); // Option<string>
```

### Per-method error unions

Each method has its own union; `PointInTimeReadError` covers both when you handle them in one place.

```typescript
import type {
  PointInTimeAtError,
  PointInTimeReadError,
  PointInTimeWorktreeError,
} from "workspaces-effect";

// PointInTimeAtError       = GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError
// PointInTimeWorktreeError = CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError
// PointInTimeReadError     = PointInTimeAtError | PointInTimeWorktreeError
```

- `GitReadError` — a `git show`/`git ls-tree` invocation failed irrecoverably (git missing, unknown revision, 30-second timeout). `at` only
- `CatalogAssemblyError` — the `pnpm-workspace.yaml` at the ref or on disk is malformed, the root `package.json` is not valid JSON in a workspace that has no `pnpm-workspace.yaml`, or an on-disk `pnpm-lock.yaml` exists but cannot be read; a missing or malformed lockfile never fails, it degrades to an empty catalog set
- `WorkspaceRootNotFoundError` — no workspace root was found walking up from `options.cwd` (or `process.cwd()` when omitted)
- `WorkspaceDiscoveryError` — the live packages could not be enumerated. `worktree` only

### WorkspaceStateSnapshot

The `Schema.Class` value object both methods return, exported directly so you can build your own comparisons.

| Member | Type | Description |
| --- | --- | --- |
| `packages` | `ReadonlyArray<PackageStateSnapshot>` | Every package at that moment |
| `catalogs` | `CatalogSet` | Assembled catalogs: lockfile first, then the inline declarations from `pnpm-workspace.yaml` or the root `package.json` (inline wins per dependency) |
| `versions` | `Record<string, string>` | Getter mapping package name to declared version |
| `package(name)` | `Option<PackageStateSnapshot>` | Find a package snapshot by name |
| `resolve(dep, spec)` | `Option<string>` | Resolve a `catalog:`/`workspace:` specifier against this snapshot; `Option.none()` for plain or unresolvable specifiers |

`PackageStateSnapshot` has `name`, `version`, `relativePath` and the four dependency records (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`).

### CatalogSet

An immutable catalog collection shared by live and point-in-time resolution, also exported directly.

| Member | Type | Description |
| --- | --- | --- |
| `CatalogSet.empty()` | `CatalogSet` | An empty catalog set |
| `CatalogSet.fromCatalogs(catalogs)` | `CatalogSet` | Wrap a pnpm `Catalogs` map |
| `CatalogSet.fromWorkspaceYaml(text)` | `Effect<CatalogSet, CatalogAssemblyError>` | Parse the `catalog:`/`catalogs:` sections of a `pnpm-workspace.yaml` text |
| `CatalogSet.fromLockfileCatalogs(raw)` | `CatalogSet` | Normalize a pnpm lockfile `catalogs:` section |
| `CatalogSet.merge(...sets)` | `CatalogSet` | Merge sets; later sets win per dependency within a catalog |
| `toCatalogs()` | `Catalogs` | View as the pnpm `Catalogs` shape |
| `resolveSpecifier(dep, spec)` | `Option<string>` | Resolve a `catalog:` specifier; `Option.none()` for non-catalog or unresolved specifiers |

### package.json workspaces reader

The npm/bun counterpart to `CatalogSet.fromWorkspaceYaml`, exported as two standalone functions rather than statics.

| Export | Type | Description |
| --- | --- | --- |
| `PackageJsonWorkspaces` | interface | The glob- and catalog-bearing slice of a root `package.json` `workspaces` field: `packages`, `catalog`, `catalogs` — each optional |
| `parsePackageJsonWorkspaces(content)` | `Effect<PackageJsonWorkspaces, CatalogAssemblyError>` | Parse the `workspaces` field out of raw `package.json` text. Accepts the array form (globs only) and the object form. Every field is `undefined` when there is no `workspaces` field |
| `catalogSetFromPackageJson(content)` | `Effect<CatalogSet, CatalogAssemblyError>` | Build a `CatalogSet` from that text: `workspaces.catalog` becomes the `"default"` catalog, each key of `workspaces.catalogs` becomes a catalog of that name |

Both fail with `CatalogAssemblyError` (`source: "manifest"`) when `content` is not valid JSON.

```typescript
import { Effect } from "effect";
import { catalogSetFromPackageJson, parsePackageJsonWorkspaces } from "workspaces-effect";

const program = Effect.gen(function* () {
  const text = `{
    "workspaces": {
      "packages": ["packages/*"],
      "catalog": { "effect": "^3.12.0" },
      "catalogs": { "react18": { "react": "^18.3.1" } }
    }
  }`;

  const ws = yield* parsePackageJsonWorkspaces(text);
  console.log(ws.packages);
  // example output: [ 'packages/*' ]

  const catalogs = yield* catalogSetFromPackageJson(text);
  return catalogs.resolveSpecifier("react", "catalog:react18"); // Option<string>
});
```

---

## LockfileReader

Parses the lockfile of any of the four supported package managers into the normalized `LockfileData` shape. The parser is selected from `PackageManagerDetector` output.

**Layer:** `LockfileReaderLive` (E channel: `never`; root discovery, PM detection, lockfile read and lockfile parse are deferred to the first method call and memoized for the layer's lifetime via `Effect.cached`)
**Service deps:** `WorkspaceRoot`, `PackageManagerDetector`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

All four methods carry the exported [`LockfileInitError`](#lockfileiniterror-union) union in their E channels because the first call drives the lazy init. See [Lockfile parsing -> Lazy initialization](./05-lockfile-parsing.md#lazy-initialization) for the longer write-up.

### Methods

#### `readLockfile()`

Reads the workspace lockfile and parses it into `LockfileData`.

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

### LockfileData

| Field | Type | Description |
| --- | --- | --- |
| `packageManager` | `"npm" \| "pnpm" \| "yarn" \| "bun"` | Which PM produced the lockfile |
| `lockfileVersion` | `string` | The lockfile format version |
| `packages` | `ReadonlyArray<ResolvedPackage>` | All resolved packages |
| `workspaceDependencies` | `ReadonlyArray<WorkspaceDependency>` | Inter-workspace dependency links |
| `importers` | `ReadonlyArray<LockfileImporter>` | Each workspace importer's declared dependencies. Populated by the pnpm, bun and npm parsers; **always `[]` for yarn**, whose lockfile does not record importers |
| `pmSpecific` | `PnpmExtension \| BunExtension \| undefined` | PM-specific data |

`LockfileImporter` is a `Schema.Class`:

| Member | Type | Description |
| --- | --- | --- |
| `path` | `string` | Importer path relative to the workspace root; `"."` for the root package. Matches the keys of `WorkspaceDiscovery.importerMap()` |
| `dependencies` | `ReadonlyArray<ImporterDependency>` | Every dependency the importer declares, across all four sections |

`ImporterDependency` is a `Schema.Class`:

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Dependency name |
| `specifier` | `string` | The range declared in the importer's `package.json`, which may be a `catalog:` reference |
| `version` | `string \| undefined` | The concrete resolved version. **Populated by pnpm only** — bun and npm record resolved versions on their package tuples/entries rather than per importer, so their importer dependencies carry a `specifier` and no `version` |
| `depType` | `"dependencies" \| "devDependencies" \| "peerDependencies" \| "optionalDependencies"` | Which manifest section declared it |

### parseLockfileContent

The pure parser dispatch behind `LockfileReader`, exported so a caller holding two snapshots of a lockfile — a "before" and an "after" — can parse both in one process. The service reads a single lockfile from the workspace root and memoizes it, which cannot express a diff.

`parseLockfileContent(content: string, lockfilePath: string, packageManager: PackageManagerType)`

- **Returns:** `Effect<LockfileData, LockfileParseError>`
- No services, no filesystem access: `lockfilePath` is used only for error reporting, and `packageManager` selects the format.

```typescript
import { Effect } from "effect";
import { parseLockfileContent } from "workspaces-effect";

const program = Effect.gen(function* () {
  const before = yield* parseLockfileContent(beforeText, "pnpm-lock.yaml", "pnpm");
  const after = yield* parseLockfileContent(afterText, "pnpm-lock.yaml", "pnpm");
  return after.importers.length - before.importers.length;
});
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

Each variant has its own `_tag`. Catch them individually with `Effect.catchTag` or all four at once with `Effect.catchTags`.

---

## CatalogResolver

Assembles the workspace's complete pnpm catalog set and rewrites `catalog:` and `workspace:` specifiers to concrete version constraints. Three sources feed the set, merged with later-wins precedence per dependency: lockfile-recorded catalogs, then inline `catalog:`/`catalogs:` declarations in `pnpm-workspace.yaml`, then catalogs injected by config dependencies (replayed from each plugin's installed pnpmfile `updateConfig` hook). The manifest and lockfile are read through the same working-tree pipeline that feeds `PointInTimeWorkspace.worktree()`; hook replay is the overlay this resolver adds on top. `workspace:` specifiers resolve against live `WorkspaceDiscovery` versions, so they work on npm, yarn and Bun workspaces too.

**Layer:** `CatalogResolverLive` (E channel: `never`; catalog assembly is deferred to the first method call and memoized via `Effect.cached`, the same lazy-init pattern as `LockfileReaderLive`)
**Service deps:** `WorkspaceRoot`, `WorkspaceDiscovery`
**Platform deps:** `FileSystem`, `Path`
**Composite layers:** `WorkspacesLive`, `WorkspacesFullLive`

### Methods

All three methods carry the exported [`CatalogResolverError`](#catalogresolvererror-union) union in their E channels because the first call drives the lazy assembly.

#### `catalogs()`

The complete assembled catalog set as a pnpm `Catalogs` map. Assembled once, then cached.

- **Returns:** `Effect<Catalogs, CatalogResolverError>`

#### `resolve(manifest: ManifestLike)`

Rewrites every `catalog:` and `workspace:` specifier across a manifest's four dependency records and returns the rewritten manifest. Plain specifiers pass through untouched. `ManifestLike` is the exported minimal `package.json` shape: `name`, `version` and the optional dependency records.

- **Returns:** `Effect<ManifestLike, CatalogResolverError | CatalogResolutionError>`

#### `resolveSpecifier(dependency: string, specifier: string)`

Resolves a single specifier. `Option.none()` means no rewrite is needed — a plain specifier. An unresolvable `catalog:` or `workspace:` reference fails with `CatalogResolutionError`, the same behavior as `resolve`, not a silent `Option.none()`.

- **Returns:** `Effect<Option<string>, CatalogResolverError | CatalogResolutionError>`

```typescript
const resolver = yield* CatalogResolver;
const catalogs = yield* resolver.catalogs();
const rewritten = yield* resolver.resolve({
  name: "@myorg/ui",
  version: "1.0.0",
  dependencies: { effect: "catalog:default", "@myorg/core": "workspace:^" },
});
const one = yield* resolver.resolveSpecifier("effect", "catalog:default"); // Option<string>
```

### CatalogResolverError union

```typescript
import type { CatalogResolverError } from "workspaces-effect";

// CatalogResolverError =
//   | CatalogAssemblyError
//   | WorkspaceRootNotFoundError
```

- `CatalogAssemblyError` — `pnpm-workspace.yaml` is unreadable or malformed, the default catalog is defined twice, or a `pnpm-lock.yaml` exists but cannot be read; a missing or malformed lockfile degrades to empty lockfile catalogs instead
- `WorkspaceRootNotFoundError` — no workspace root was found from `process.cwd()`

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
