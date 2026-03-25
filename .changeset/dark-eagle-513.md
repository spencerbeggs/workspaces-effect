---
"workspaces-effect": minor
---

## Features

### WorkspacePackage Enrichment

New schema fields, getters, instance methods, and dual-API static methods for
dependency querying and package introspection.

**New schema fields:** `peerDependencies`, `optionalDependencies` on
`WorkspacePackage`.

**New getters:** `isRootWorkspace`, `packageJsonPath`, `isPublic`, `scope`,
`unscopedName`, `allDependencies`.

**New dual-API methods (instance + static + pipeable):**

- `hasDependency`, `hasDevDependency`, `hasPeerDependency`,
  `hasOptionalDependency`, `hasAnyDependencyOn` — per-type and cross-type
  dependency checks
- `dependencyVersion` — look up version specifier across all dep types
- `matchesDependency` — minimatch glob pattern matching against dep names
- `dependencyDiff` — compare two package snapshots, returns added/removed/changed
- `readPackageJson` — read and parse package.json from disk

### WorkspaceDiscovery.importerMap()

Returns a `ReadonlyMap<string, WorkspacePackage>` keyed by workspace-relative
directory path, useful for mapping lockfile importer keys to workspace packages.

## Breaking Changes

`listPackages()` now always includes the root workspace package as the first
entry, identifiable via the `isRootWorkspace` getter. `getPackage()` also
resolves the root package by name. Consumers that assumed only glob-matched
packages were returned should filter with `pkg.isRootWorkspace` if needed.

Closes #12.
