# WorkspacePackage API

`WorkspacePackage` is the core data model representing a workspace package. It
provides computed getters for common metadata, dependency query methods, diff
comparison, and a dual-API pattern for both OOP and functional usage.

## Table of Contents

- [Computed Getters](#computed-getters)
- [Dependency Query Methods](#dependency-query-methods)
- [Dual-API Pattern](#dual-api-pattern)
- [Dependency Diff](#dependency-diff)
- [Reading package.json](#reading-packagejson)
- [Importer Map](#importer-map)
- [Root Package in listPackages](#root-package-in-listpackages)

## Computed Getters

Every `WorkspacePackage` instance exposes these computed properties:

| Getter | Returns | Description |
| --- | --- | --- |
| `isRootWorkspace` | `boolean` | `true` when `relativePath === "."` |
| `packageJsonPath` | `string` | Absolute path to `package.json` |
| `isPublic` | `boolean` | `true` when `private` is `false` |
| `scope` | `Option<string>` | The `@scope` portion, or `Option.none()` |
| `unscopedName` | `string` | Package name without the `@scope/` prefix |
| `allDependencies` | `Record<string, string>` | Merged map of all 4 dependency types |

```typescript
import { Option } from "effect";
import { WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/utils");

  console.log(pkg.isRootWorkspace);   // false
  console.log(pkg.packageJsonPath);   // "/workspace/packages/utils/package.json"
  console.log(pkg.isPublic);          // true
  console.log(pkg.unscopedName);      // "utils"

  if (Option.isSome(pkg.scope)) {
    console.log(pkg.scope.value);     // "@myorg"
  }

  // allDependencies merges dependencies + devDependencies +
  // peerDependencies + optionalDependencies
  console.log(Object.keys(pkg.allDependencies));
});
```

## Dependency Query Methods

Query whether a package depends on something, across all four dependency types:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/app");

  // Check specific dependency types
  pkg.hasDependency("react");          // checks dependencies only
  pkg.hasDevDependency("vitest");      // checks devDependencies only
  pkg.hasPeerDependency("effect");     // checks peerDependencies only
  pkg.hasOptionalDependency("fsevents"); // checks optionalDependencies only

  // Check across ALL dependency types at once
  pkg.hasAnyDependencyOn("effect");    // true if in any of the 4 maps

  // Get the version string (searches all 4 types)
  const version = pkg.dependencyVersion("effect");
  // Option.some("^3.19.0") or Option.none()

  // Glob pattern matching on dependency names
  pkg.matchesDependency("@myorg/*");   // true if any dep matches the glob
  pkg.matchesDependency("react*");     // matches react, react-dom, etc.
});
```

## Dual-API Pattern

Every instance method is also available as a static dual function on
`WorkspacePackage`. This supports three calling styles -- instance, static
data-first, and static data-last (pipeable):

```typescript
import { pipe } from "effect";
import { WorkspacePackage } from "workspaces-effect";

// 1. Instance method
pkg.hasDependency("effect");

// 2. Static data-first
WorkspacePackage.hasDependency(pkg, "effect");

// 3. Static data-last (pipeable)
pipe(pkg, WorkspacePackage.hasDependency("effect"));
```

The pipeable form is useful for filtering and transforming arrays of packages:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();

  // Filter to packages that use react
  const reactPackages = packages.filter(
    WorkspacePackage.hasAnyDependencyOn("react"),
  );

  // Filter to packages matching a dependency glob
  const orgPackages = packages.filter(
    WorkspacePackage.matchesDependency("@myorg/*"),
  );

  // Get effect version from each package that has it
  const effectVersions = packages
    .map((p) => [p.name, WorkspacePackage.dependencyVersion(p, "effect")] as const)
    .filter(([, v]) => Option.isSome(v));
});
```

All dual-API functions:

| Function | Signature |
| --- | --- |
| `hasDependency` | `(name) => (pkg) => boolean` or `(pkg, name) => boolean` |
| `hasDevDependency` | `(name) => (pkg) => boolean` or `(pkg, name) => boolean` |
| `hasPeerDependency` | `(name) => (pkg) => boolean` or `(pkg, name) => boolean` |
| `hasOptionalDependency` | `(name) => (pkg) => boolean` or `(pkg, name) => boolean` |
| `hasAnyDependencyOn` | `(name) => (pkg) => boolean` or `(pkg, name) => boolean` |
| `dependencyVersion` | `(name) => (pkg) => Option<string>` or `(pkg, name) => Option<string>` |
| `matchesDependency` | `(pattern) => (pkg) => boolean` or `(pkg, pattern) => boolean` |
| `dependencyDiff` | `(other) => (pkg) => DependencyDiff` or `(pkg, other) => DependencyDiff` |

## Dependency Diff

Compare the dependency snapshots of two `WorkspacePackage` instances to find
what was added, removed, or changed. This compares across all four dependency
types combined:

```typescript
import { WorkspacePackage } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;

  // Compare two different packages
  const app = yield* discovery.getPackage("@myorg/app");
  const api = yield* discovery.getPackage("@myorg/api");

  const diff = app.dependencyDiff(api);

  // { added: { "react": "^19.0.0" },
  //   removed: { "express": "^4.18.0" },
  //   changed: { "effect": { from: "^3.18.0", to: "^3.19.0" } } }

  console.log("Added:", Object.keys(diff.added));
  console.log("Removed:", Object.keys(diff.removed));
  for (const [name, { from, to }] of Object.entries(diff.changed)) {
    console.log(`${name}: ${from} -> ${to}`);
  }
});
```

The `DependencyDiff` interface:

```typescript
interface DependencyDiff {
  readonly added: Record<string, string>;    // in self but not other
  readonly removed: Record<string, string>;  // in other but not self
  readonly changed: Record<string, { readonly from: string; readonly to: string }>;
}
```

The diff also works with the static dual-API:

```typescript
// Static data-first
WorkspacePackage.dependencyDiff(app, api);

// Static data-last (pipeable)
pipe(app, WorkspacePackage.dependencyDiff(api));
```

## Reading package.json

The `readPackageJson` utility reads and parses a package's `package.json` from
disk using `@effect/platform` FileSystem. It returns the minimal
`PackageJsonType` schema fields:

```typescript
import { WorkspacePackage, readPackageJson } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/utils");

  // As a standalone function
  const json = yield* readPackageJson(pkg);
  console.log(json.name, json.version, json.workspaces);

  // Or as a static method
  const json2 = yield* WorkspacePackage.readPackageJson(pkg);
});
```

This requires `FileSystem` in the Effect context, which is already provided by
`NodeContext.layer` or `BunContext.layer`.

## Importer Map

`WorkspaceDiscovery.importerMap()` returns a `ReadonlyMap<string, WorkspacePackage>`
keyed by `relativePath`. This is useful for mapping lockfile importer keys (which
use relative paths like `packages/utils`) back to their workspace packages:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const importers = yield* discovery.importerMap();

  // Look up a package by its relative path
  const utils = importers.get("packages/utils");
  if (utils) {
    console.log(utils.name); // "@myorg/utils"
  }

  // The root package is keyed by "."
  const root = importers.get(".");
  if (root) {
    console.log("Root:", root.name);
  }
});
```

The importer map is built from `listPackages()` and inherits its caching, so
repeated calls are free.

## Root Package in listPackages

`WorkspaceDiscovery.listPackages()` includes the root workspace package as the
first entry in the returned array. The root package has `relativePath: "."`.

Use the `isRootWorkspace` getter to filter it out when you only want child
packages:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const all = yield* discovery.listPackages();

  // all[0].isRootWorkspace === true

  // Filter to non-root packages only
  const childPackages = all.filter((pkg) => !pkg.isRootWorkspace);
});
```
