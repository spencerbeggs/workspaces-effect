# workspaces-effect

## 0.6.0

### Breaking Changes

* [`37391c0`](https://github.com/spencerbeggs/workspaces-effect/commit/37391c02bd4eb7f3ff2103739c4a981591ca5e86) ### `LockfileReader` service errors surface from method calls

Errors that previously failed `Layer.provide(LockfileReaderLive)` now surface
from the first invocation of `readLockfile`, `resolvedVersion`,
`workspaceDependencies`, or `checkIntegrity`. The error union exposed by these
methods has been widened to a new exported `LockfileInitError` alias:

```ts
type LockfileInitError =
  | WorkspaceRootNotFoundError
  | PackageManagerDetectionError
  | LockfileReadError
  | LockfileParseError;
```

Programs that previously relied on construction-time failure should move their
error handling to the call site. Programs that already wrapped a method call
in `Effect.runPromise` will continue to see failures, just routed through the
program's error channel rather than the layer's.

### Performance

* [`37391c0`](https://github.com/spencerbeggs/workspaces-effect/commit/37391c02bd4eb7f3ff2103739c4a981591ca5e86) ### Defer I/O in `LockfileReaderLive` and `WorkspaceDiscoveryLive`

Moves all filesystem I/O out of the `Layer.effect` constructors and into the
service methods, memoized per layer instance via `Effect.cached`. Layer
construction is now O(1); the workspace root walk, package-manager detection,
lockfile read, and lockfile parse are paid on the first method call rather
than every time a fresh layer is composed.

Consumers that build a layer per call site — Vitest reporters with multiple
projects, CLIs that compose layers per subcommand, tests that swap layers
between cases — no longer pay the eager initialization cost N times.
Downstream `vitest-agent-reporter` measured a 10× wall-clock improvement
(44s → 4.3s) on a five-project monorepo by switching to the lighter slice
that was the workaround for this issue.

Closes #60.

### Documentation

* [`37391c0`](https://github.com/spencerbeggs/workspaces-effect/commit/37391c02bd4eb7f3ff2103739c4a981591ca5e86) Address eight stale design-doc audit issues (#47, #48, #49, #50, #51, #54,
  \#55, #57). No code changes.

- `architecture.md`: corrected error-type count from 11 to 12 (missing
  `LockfileIntegrityError`); added the optional `cwd` parameter to the
  documented `WorkspaceDiscovery` method signatures.
- `CLAUDE.md`: removed two stale references to a non-existent `pkgs/`
  directory and replaced the example test command with a single-package
  equivalent; updated the code-review summary from "5/10 fixed" to
  "6/10 fixed".
- `code-review-findings.md`: replaced the open-ended "Should fix soon"
  marker on Issue 3 (`/**` glob) with a reference to the new GitHub issue
  \#62 that tracks the fix.
- `phase4-configuration-lockfiles.md`: replaced the stale, self-referential
  composite layer example with the real `Layer.mergeAll` shape from
  `src/layers/WorkspacesLive.ts`.
- `phase3-change-detection.md`: corrected the false claim that
  `ChangeDetectorLive` does not resolve `CommandExecutor`; the layer does
  yield it inside `Layer.effect` so service methods have `R = never`.
- `research-notes.md`: promoted from `draft`/60 % to `current`/100 % and
  added a header marking the document as historical reference material that
  informed the architecture rather than a prescriptive spec.

## 0.5.1

### Documentation

* [`8863d31`](https://github.com/spencerbeggs/workspaces-effect/commit/8863d3102e0a02975d36bc4d4bd821e8f405dfc6) New "Observability" section in the README documenting how to subscribe to internal events by lowering the log level or replacing the logger.

### Refactoring

* [`8863d31`](https://github.com/spencerbeggs/workspaces-effect/commit/8863d3102e0a02975d36bc4d4bd821e8f405dfc6) Internal observability events now emit at `Debug` level instead of `Info`. The library is silent under Effect's default logger; consumers who want to see workspace-root discovery, package-manager detection, lockfile reads, and change-detection events can opt in via `Logger.withMinimumLogLevel(LogLevel.Debug)` or by attaching a custom logger. Affects `WorkspaceRootLive`, `PackageManagerDetectorLive`, `LockfileReaderLive`, `WorkspaceDiscoveryLive`, and `ChangeDetectorLive`. Log annotations (`workspace.root`, `workspace.pm`, `workspace.packages.count`, etc.) are unchanged.

### Dependencies

* | [`8863d31`](https://github.com/spencerbeggs/workspaces-effect/commit/8863d3102e0a02975d36bc4d4bd821e8f405dfc6) | Dependency | Type    | Action | From   | To |
  | :------------------------------------------------------------------------------------------------------------- | :--------- | :------ | :----- | :----- | -- |
  | yaml-effect                                                                                                    | dependency | updated | ^0.4.0 | ^0.5.0 |    |

## 0.5.0

### Breaking Changes

* [`8000f3e`](https://github.com/spencerbeggs/workspaces-effect/commit/8000f3e02a311c52a1c2d93854d4307dcb8136f8) ### Sync helper returns WorkspacePackage instances

`getWorkspacePackagesSync` now returns `ReadonlyArray<WorkspacePackage>` instead of `ReadonlyArray<{ name: string; path: string }>`. The richer return shape makes the sync helper a first-class equal of `WorkspaceDiscovery.listPackages()` and lets non-Effect callers feed packages directly into services like `PublishabilityDetector` without re-reading manifests.

The function now also throws when the root `package.json` is missing required `name` or `version` fields, matching the Effect-native discovery semantics. Previously the root was silently omitted in that case.

Consumers that only need `{ name, path }` continue to work unchanged — `WorkspacePackage` exposes those fields and adds `version`, `packageJsonPath`, `relativePath`, `private`, `publishConfig`, dependency maps, and computed getters like `isRootWorkspace`.

### Features

* [`8000f3e`](https://github.com/spencerbeggs/workspaces-effect/commit/8000f3e02a311c52a1c2d93854d4307dcb8136f8) ### Optional cwd parameter on WorkspaceDiscovery methods

`listPackages`, `importerMap`, and `getPackage` now accept an optional `cwd` argument. When provided, the workspace root is resolved fresh from that directory for the call; results are cached per resolved root for the lifetime of the layer. When omitted, the methods use the root that was eagerly resolved from `process.cwd()` at layer construction time, preserving existing behaviour.

This removes the need for a custom `WorkspaceRoot` layer when a downstream consumer just wants to discover packages at a specific path — useful for tests that load fixtures into temp directories and for tools (CI actions, etc.) that operate on a path supplied by the caller rather than the process working directory.

```ts
const discovery = yield * WorkspaceDiscovery;
const packages = yield * discovery.listPackages("/tmp/fixture-monorepo");
```

### README documents custom publishability detectors

A new "Custom publishability detectors" section in the README shows how to override `PublishabilityDetector` with `Layer.succeed(PublishabilityDetector, customImpl)`. The pattern was already supported but undocumented; downstream packages that need non-vanilla publish semantics (mirroring to a private registry, organisation conventions, etc.) now have a clear extension point.

## 0.4.1

### Refactoring

* [`d3a9b50`](https://github.com/spencerbeggs/workspaces-effect/commit/d3a9b506a395271dbeed94bf33f96b7ba82c6511) `WorkspacePackage.packageJsonPath` is now computed at construction time using
  `@effect/platform`'s `Path.join` instead of a hardcoded forward slash,
  ensuring consistent cross-platform path handling.

## 0.4.0

### Features

* [`05e2515`](https://github.com/spencerbeggs/workspaces-effect/commit/05e251596b38e872d91b64a9f03883dad1041e8d) ### Standalone Package Fallback

WorkspaceDiscovery now returns the root package as a single workspace when no pnpm-workspace.yaml or package.json workspaces field is found, instead of failing with an error.

### Bug Fixes

* [`05e2515`](https://github.com/spencerbeggs/workspaces-effect/commit/05e251596b38e872d91b64a9f03883dad1041e8d) ### Root-as-Package Deduplication

WorkspaceDiscovery no longer duplicates the root workspace when pnpm-workspace.yaml patterns include `"."`.

### Runtime Detection

PackageManagerDetector now includes a `runtime` field (`"node"` or `"bun"`) on the detection result. Bun PM implies bun runtime; all others are node.

### Extendable PublishConfig

PublishConfig is now a Schema.Class instead of a Schema.Struct, enabling downstream packages to extend it with `PublishConfig.extend()` to add custom fields.

### Expanded PublishConfig Fields

PublishConfig now includes `tag` (npm standard) and `linkDirectory` (pnpm extension) fields.

### Synchronous Workspace API

New `findWorkspaceRootSync` and `getWorkspacePackagesSync` functions for non-Effect contexts (e.g., lint-staged handlers). Enables dropping the `workspace-tools` dependency.

## 0.3.0

### Bug Fixes

* [`7841a2a`](https://github.com/spencerbeggs/workspaces-effect/commit/7841a2aa10455b82f67b1bc4abbc6a7762659531) Fix pnpm v9+ lockfile parsing for catalogs with `{ specifier, version }` format
* Fix integrity check for all package managers by adding `relativePath` to `ResolvedPackage`

### Other

* [`7841a2a`](https://github.com/spencerbeggs/workspaces-effect/commit/7841a2aa10455b82f67b1bc4abbc6a7762659531) Restructure tests to follow `@savvy-web/vitest` discovery convention with real generated lockfile fixtures

## 0.2.0

### Breaking Changes

* [`9eb2268`](https://github.com/spencerbeggs/workspaces-effect/commit/9eb22682cae67940583d67553b3bf63d9f943039) `listPackages()` now always includes the root workspace package as the first
  entry, identifiable via the `isRootWorkspace` getter. `getPackage()` also
  resolves the root package by name. Consumers that assumed only glob-matched
  packages were returned should filter with `pkg.isRootWorkspace` if needed.

Closes #12.

### Features

* [`9eb2268`](https://github.com/spencerbeggs/workspaces-effect/commit/9eb22682cae67940583d67553b3bf63d9f943039) ### WorkspacePackage Enrichment

New schema fields, getters, instance methods, and dual-API static methods for
dependency querying and package introspection.

**New schema fields:** `peerDependencies`, `optionalDependencies` on
`WorkspacePackage`.

**New getters:** `isRootWorkspace`, `packageJsonPath`, `isPublic`, `scope`,
`unscopedName`, `allDependencies`.

**New dual-API methods (instance + static + pipeable):**

* `hasDependency`, `hasDevDependency`, `hasPeerDependency`,
  `hasOptionalDependency`, `hasAnyDependencyOn` — per-type and cross-type
  dependency checks
* `dependencyVersion` — look up version specifier across all dep types
* `matchesDependency` — minimatch glob pattern matching against dep names
* `dependencyDiff` — compare two package snapshots, returns added/removed/changed
* `readPackageJson` — read and parse package.json from disk

### WorkspaceDiscovery.importerMap()

Returns a `ReadonlyMap<string, WorkspacePackage>` keyed by workspace-relative
directory path, useful for mapping lockfile importer keys to workspace packages.

## 0.1.0

### Features

* [`c7851d7`](https://github.com/spencerbeggs/workspaces-effect/commit/c7851d72ef1dd09898aa2c3a143dfd05284a2dc3) ### Workspace Discovery

- Automatic workspace root detection by walking up the directory tree for
  package.json with workspaces field, pnpm-workspace.yaml, or bun workspace
  configuration
- Package manager detection for npm, pnpm, yarn Berry, and Bun with automatic
  identification from lockfiles and configuration
- Workspace package enumeration with parsed package.json data including name,
  version, path, dependencies, and publishConfig

### Documentation

* Comprehensive TSDoc annotations on all public APIs with @example blocks
* Architecture overview and services reference documentation
* Getting started guide with Node.js and Bun examples
* Topic guides for dependency analysis, change detection, lockfile parsing,
  and publishability
* Troubleshooting guide covering all error types and common issues

### Dependency Analysis

* Dependency graph construction from workspace package declarations with
  adjacency list representation
* Forward and reverse dependency lookups (dependenciesOf, dependentsOf)
* Topological sorting for correct build ordering with cycle detection
* Batch grouping of independent packages for parallel execution

### Change Detection

* Git-based file change detection between arbitrary refs (commits, branches,
  tags)
* Affected package computation mapping changed files to workspace packages
* Package resolver for mapping file paths to their owning workspace package
* Support for both committed and uncommitted change detection

### Lockfile Parsing

* Unified lockfile reader across all four package manager formats
* pnpm lockfile parsing (YAML format) with catalog and override extraction
* npm package-lock.json parsing with workspace dependency resolution
* yarn Berry lockfile parsing with workspace protocol handling
* Bun bun.lock parsing (JSONC format) with trusted dependencies and catalogs
* Normalized ResolvedPackage output with name, version, integrity hash, and
  dependency map
* Workspace dependency edge extraction with dependency type classification
* Lockfile integrity validation comparing lockfile state against workspace
  declarations
* Request/RequestResolver pattern for deduplicated version lookups

### Publishability Detection

* Package publishability analysis based on private field and publishConfig
* Publish target detection for npm and GitHub Package Registry
* Support for scoped and unscoped package publishing semantics

### Architecture

* 9 composable Effect services across 4 service groups (Discovery, Package
  Analysis, Change Detection, Configuration and Lockfiles)
* 2 composite layers: WorkspacesLive (7 services, requires FileSystem + Path)
  and WorkspacesFullLive (all 9 services, additionally requires
  CommandExecutor)
* Individual service layers available for fine-grained composition
* Platform independence via @effect/platform abstractions (runs on Node.js or
  Bun)
* 11 typed error classes using Data.TaggedError for exhaustive error handling
* Effect Schema-based data models with branded types for PackageName and
  WorkspacePath
* Structured observability with Effect spans and logging across all services
