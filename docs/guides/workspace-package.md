# WorkspacePackage API

`WorkspacePackage` is the core data model representing a workspace package.
It is an Effect `Schema.Class` produced by `WorkspaceDiscovery` for each
package found in the monorepo. It provides computed getters, dependency query
methods, diff comparison, and a dual-API pattern for both OOP and functional
usage.

## Table of Contents

- [Fields](#fields)
- [Computed Getters](#computed-getters)
- [Dependency Query Methods](#dependency-query-methods)
- [Dual-API Pattern](#dual-api-pattern)
- [Dependency Diff](#dependency-diff)
- [Reading package.json](#reading-packagejson)
- [Importer Map](#importer-map)
- [Root Package in listPackages](#root-package-in-listpackages)

## Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | required | Package name from `package.json` |
| `version` | `string` | required | Package version |
| `path` | `string` | required | Absolute filesystem path to the package directory |
| `relativePath` | `string` | required | Path relative to the workspace root |
| `private` | `boolean` | `false` | Whether the package is private |
| `dependencies` | `Record<string, string>` | `{}` | Production dependencies |
| `devDependencies` | `Record<string, string>` | `{}` | Development dependencies |
| `peerDependencies` | `Record<string, string>` | `{}` | Peer dependencies |
| `optionalDependencies` | `Record<string, string>` | `{}` | Optional dependencies |
| `publishConfig` | `PublishConfigType \| undefined` | `undefined` | Publishing configuration |

## Computed Getters

Every `WorkspacePackage` instance exposes these computed properties:

| Getter | Returns | Description |
| --- | --- | --- |
| `isRootWorkspace` | `boolean` | `true` when `relativePath === "."` |
| `packageJsonPath` | `string` | Absolute path to `package.json` (e.g., `"/ws/pkgs/utils/package.json"`) |
| `isPublic` | `boolean` | `true` when `private` is `false` |
| `scope` | `Option<string>` | The `@scope` portion (e.g., `Option.some("@myorg")`), or `Option.none()` |
| `unscopedName` | `string` | Package name without the `@scope/` prefix |
| `allDependencies` | `Record<string, string>` | Merged map of all 4 dependency types |

```typescript
import { Effect, Option } from "effect";
import { NodeContext } from "@effect/platform-node";
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

The `allDependencies` merge order is: `optionalDependencies`,
`peerDependencies`, `devDependencies`, `dependencies`. Later entries overwrite
earlier ones, so if the same package appears in multiple maps, `dependencies`
wins.

## Dependency Query Methods

Query whether a package depends on something across any dependency type:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/app");

  // Check specific dependency types
  pkg.hasDependency("react");              // checks dependencies only
  pkg.hasDevDependency("vitest");          // checks devDependencies only
  pkg.hasPeerDependency("effect");         // checks peerDependencies only
  pkg.hasOptionalDependency("fsevents");   // checks optionalDependencies only

  // Check across ALL dependency types at once
  pkg.hasAnyDependencyOn("effect");        // true if in any of the 4 maps

  // Get the version string (searches all 4 types in order)
  const version = pkg.dependencyVersion("effect");
  // Option.some("^3.19.0") or Option.none()

  // Glob pattern matching on dependency names
  pkg.matchesDependency("@myorg/*");       // true if any dep matches the glob
  pkg.matchesDependency("react*");         // matches react, react-dom, etc.
});
```

`dependencyVersion` searches `dependencies`, then `devDependencies`, then
`peerDependencies`, then `optionalDependencies`, returning the first match.

## Dual-API Pattern

Every instance method is also available as a standalone dual function. This
supports three calling styles -- instance, static data-first, and static
data-last (pipeable):

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

The standalone functions are also exported directly for use without the class:

```typescript
import { hasDependency, hasAnyDependencyOn, matchesDependency } from "workspaces-effect";

// Same three calling styles
hasDependency(pkg, "effect");
pipe(pkg, hasDependency("effect"));
```

The pipeable form is especially useful for filtering arrays of packages:

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

| Function | Data-last signature | Data-first signature |
| --- | --- | --- |
| `hasDependency` | `(name) => (pkg) => boolean` | `(pkg, name) => boolean` |
| `hasDevDependency` | `(name) => (pkg) => boolean` | `(pkg, name) => boolean` |
| `hasPeerDependency` | `(name) => (pkg) => boolean` | `(pkg, name) => boolean` |
| `hasOptionalDependency` | `(name) => (pkg) => boolean` | `(pkg, name) => boolean` |
| `hasAnyDependencyOn` | `(name) => (pkg) => boolean` | `(pkg, name) => boolean` |
| `dependencyVersion` | `(name) => (pkg) => Option<string>` | `(pkg, name) => Option<string>` |
| `matchesDependency` | `(pattern) => (pkg) => boolean` | `(pkg, pattern) => boolean` |
| `dependencyDiff` | `(other) => (pkg) => DependencyDiff` | `(pkg, other) => DependencyDiff` |

## Dependency Diff

Compare the dependency snapshots of two `WorkspacePackage` instances to find
what was added, removed, or changed. The comparison uses `allDependencies`
(the merged map of all 4 types), so a dependency that moves between types at
the same version does not appear in the diff.

```typescript
import { WorkspacePackage } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const app = yield* discovery.getPackage("@myorg/app");
  const api = yield* discovery.getPackage("@myorg/api");

  const diff = app.dependencyDiff(api);

  console.log("Added:", Object.keys(diff.added));     // in app but not api
  console.log("Removed:", Object.keys(diff.removed)); // in api but not app
  for (const [name, { from, to }] of Object.entries(diff.changed)) {
    console.log(`${name}: ${from} -> ${to}`);
  }
});
```

The `DependencyDiff` type:

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
disk using `@effect/platform` `FileSystem`. It returns the `PackageJsonType`
schema fields (name, version, dependencies, workspaces, etc.).

```typescript
import { readPackageJson, WorkspacePackage } from "workspaces-effect";

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

Errors: `PackageJsonParseError` if the file cannot be read or contains invalid
JSON.

## Importer Map

`WorkspaceDiscovery.importerMap()` returns a
`ReadonlyMap<string, WorkspacePackage>` keyed by `relativePath`. This is useful
for mapping lockfile importer keys (which use relative paths like
`packages/utils`) back to their workspace packages:

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
