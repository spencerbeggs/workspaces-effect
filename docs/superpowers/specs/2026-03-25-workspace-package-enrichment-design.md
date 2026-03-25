# WorkspacePackage Enrichment & API Surface for GitHub Action Integration

**Issue:** [#12 — APIs needed to replace workspace-tools in GitHub Action](https://github.com/spencerbeggs/workspaces-effect/issues/12)
**Date:** 2026-03-25
**Status:** Draft

## Motivation

`pnpm-config-dependency-action` depends on `workspace-tools` (Microsoft) for
workspace package discovery. That dependency pulls in `jju` which uses dynamic
`require()`, producing bundler warnings. The action needs only two things from
it: a list of workspace packages with paths, and a mapping from relative
directory paths to package names (for lockfile importer keys).

`workspaces-effect` already provides most of this data through
`WorkspaceDiscovery.listPackages()` and the `WorkspacePackage` schema. This
spec covers the gaps and enrichments needed to make `workspaces-effect` a
complete drop-in replacement.

## Changes Overview

### 1. WorkspacePackage Schema Enrichment

**New schema fields** on `WorkspacePackage` (`src/schemas/core.ts`):

| Field | Type | Default |
| ----- | ---- | ------- |
| `peerDependencies` | `Record<string, string>` | `{}` |
| `optionalDependencies` | `Record<string, string>` | `{}` |

Both are entirely new to `WorkspacePackage`. While `PackageJsonSchema` already
parses `peerDependencies`, the value is currently dropped when constructing
`WorkspacePackage` instances in `WorkspaceDiscoveryLive`. Both fields must be
added to the schema class and wired through from `readWorkspacePackage`.
`optionalDependencies` must also be added to `PackageJsonSchema`.

**New getters** (derived, no stored state):

| Getter | Returns | Derivation |
| ------ | ------- | ---------- |
| `isRootWorkspace` | `boolean` | `this.relativePath === "."` |
| `packageJsonPath` | `string` | `` `${this.path}/package.json` `` |
| `isPublic` | `boolean` | `!this.private` |
| `scope` | `Option<string>` | Extract `@scope` from `@scope/name`, or `Option.none()` |
| `unscopedName` | `string` | `core` from `@scope/core`, or full name if unscoped |
| `allDependencies` | `Record<string, string>` | Merged map of all 4 dependency types |

**New instance methods:**

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `hasDependency` | `(name: string) => boolean` | Checks `dependencies` |
| `hasDevDependency` | `(name: string) => boolean` | Checks `devDependencies` |
| `hasPeerDependency` | `(name: string) => boolean` | Checks `peerDependencies` |
| `hasOptionalDependency` | `(name: string) => boolean` | Checks `optionalDependencies` |
| `hasAnyDependencyOn` | `(name: string) => boolean` | Checks all 4 dependency types |
| `dependencyVersion` | `(name: string) => Option<string>` | Looks up version across all dep types |
| `dependencyDiff` | `(other: WorkspacePackage) => DependencyDiff` | Compare two snapshots; returns added/removed/changed deps |
| `matchesDependency` | `(pattern: string) => boolean` | Check if any dep name matches a glob pattern (minimatch semantics) |

**Dual static + instance API** (following the `semver-effect` pattern):

Each instance method also exists as a standalone `Function.dual()` function
(from `effect/Function`) for pipeable/curried use. Static methods are wired to
the class in the barrel file:

```typescript
// Instance use
pkg.hasDependency("effect")

// Static data-first use
WorkspacePackage.hasDependency(pkg, "effect")

// Static data-last (pipeable) use
pipe(pkg, WorkspacePackage.hasDependency("effect"))
```

The standalone functions live in a new `src/utils/workspace-package.ts` module
(new directory). Static wiring happens in `src/index.ts`.

### 2. readPackageJson Utility

`readPackageJson` is a standalone utility function in
`src/utils/workspace-package.ts`, not an instance method on `WorkspacePackage`.
This keeps `WorkspacePackage` as a pure data type, consistent with the
codebase's separation of data and effects. It is also wired as a static method
on the class.

```typescript
// Standalone use
readPackageJson(pkg) // Effect<PackageJsonType, PackageJsonParseError, FileSystem>

// Static use
WorkspacePackage.readPackageJson(pkg)

// Pipeable use
pipe(pkg, WorkspacePackage.readPackageJson)
```

Note: `PackageJsonType` is the minimal schema subset. If callers need the full
raw `package.json` (scripts, exports, bin, etc.), they can read the file at
`pkg.packageJsonPath` directly. The utility is for the common case of accessing
the fields the library already models.

### 3. DependencyDiff Type

A new interface for the return value of `dependencyDiff`. Uses `Record` for
consistency with the existing dependency map types throughout the codebase:

```typescript
interface DependencyDiff {
  readonly added: Record<string, string>       // name → new version
  readonly removed: Record<string, string>     // name → old version
  readonly changed: Record<string, { readonly from: string; readonly to: string }>
}
```

Compares across all 4 dep types combined. Located in `src/schemas/core.ts`
alongside `WorkspacePackage`.

### 4. Root Package Inclusion

`WorkspaceDiscoveryLive.listPackages()` will **always include the root
workspace package** as the first entry in the returned array. The root package
is constructed from the root `package.json` with:

- `relativePath: "."`
- `path`: the workspace root absolute path
- All dependency fields populated from root `package.json`

Consumers can identify the root via the `isRootWorkspace` getter and filter it
out if needed:

```typescript
const nonRootPackages = packages.filter(p => !p.isRootWorkspace)
```

This is a **breaking change** to `listPackages()` behavior. The root package
was previously excluded. This also means `getPackage(name)` will now resolve
the root workspace package by name, since it searches the `listPackages()`
result.

### 5. WorkspaceDiscovery.importerMap()

New method on the `WorkspaceDiscovery` service interface:

```typescript
readonly importerMap: () => Effect.Effect<
  ReadonlyMap<string, WorkspacePackage>,
  WorkspaceDiscoveryError
>
```

Returns a `ReadonlyMap` keyed by `relativePath` (e.g. `"packages/core"`, `"."`)
with `WorkspacePackage` values. Built from `listPackages()` output and
therefore inherits its caching — no separate cache needed. This directly
supports the lockfile importer-to-package mapping use case.

### 6. PackageJsonSchema Update

Add `optionalDependencies` to `PackageJsonSchema`:

```typescript
optionalDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String })
)
```

`peerDependencies` is already present in the schema.

## Files to Modify

| File | Change |
| ---- | ------ |
| `src/schemas/core.ts` | Add `peerDependencies`/`optionalDependencies` fields, getters, instance methods to `WorkspacePackage`; add `DependencyDiff`; add `optionalDependencies` to `PackageJsonSchema` |
| `src/utils/workspace-package.ts` | **New file** (new `src/utils/` directory) — standalone `Function.dual()` functions including `readPackageJson` |
| `src/services/WorkspaceDiscovery.ts` | Add `importerMap()` to service interface |
| `src/layers/WorkspaceDiscoveryLive.ts` | Include root package in `listPackages()`; wire `peerDependencies`/`optionalDependencies` from decoded `PackageJsonSchema` into `WorkspacePackage` constructor; implement `importerMap()` |
| `src/index.ts` | Wire static methods; export new utils and `DependencyDiff` |
| Tests | Update existing tests for root inclusion; update test fixtures to include `peerDependencies`/`optionalDependencies` where needed; add tests for all new methods/getters |

## Files NOT Modified

| File | Reason |
| ---- | ------ |
| `src/services/PackageResolver.ts` | Already handles path → package mapping for absolute paths |
| `src/services/TopologicalSorter.ts` | Untouched; consumes DependencyGraph, not WorkspacePackage directly |
| `src/services/PublishabilityDetector.ts` | Remains a separate overridable service |
| `src/services/DependencyGraph.ts` | May benefit from `peerDependencies` later; out of scope here |
| `src/layers/WorkspacesLive.ts` | Composite layer unchanged; already provides WorkspaceDiscovery |

## Breaking Changes

1. **`listPackages()` now includes the root package.** Consumers that assumed
   only workspace glob-matched packages were returned must filter using
   `isRootWorkspace` if they need the old behavior.
2. **`getPackage(name)` now resolves the root package.** Since it searches
   `listPackages()`, the root is now findable by name.

## Open Questions

1. Should `DependencyGraph` be updated to consider `peerDependencies` in the
   graph edges? Deferred — out of scope for this issue.
