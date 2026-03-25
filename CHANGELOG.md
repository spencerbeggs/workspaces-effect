# workspaces-effect

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
