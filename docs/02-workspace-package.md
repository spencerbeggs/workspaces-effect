# WorkspacePackage API

`WorkspacePackage` is an Effect `Schema.Class`. `WorkspaceDiscovery` produces one instance per package it finds in the monorepo. Each instance has the parsed `package.json` fields, a handful of derived getters and methods for querying dependencies. Every method is also exported as a standalone dual function — call it on the instance, or use the static form with or without `pipe`.

## Table of contents

- [Fields](#fields)
- [Computed getters](#computed-getters)
- [Dependency query methods](#dependency-query-methods)
- [Dual-API pattern](#dual-api-pattern)
- [Dependency diff](#dependency-diff)
- [PublishConfig](#publishconfig)
- [Reading package.json](#reading-packagejson)
- [Importer map](#importer-map)
- [Root package in listPackages](#root-package-in-listpackages)
- [Refreshing after mutation](#refreshing-after-mutation)

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
| `packageJsonPath` | `string` | required | Absolute path to the package's `package.json` file |
| `publishConfig` | `PublishConfig \| undefined` | `undefined` | Publishing configuration (see [PublishConfig](#publishconfig)) |

## Computed getters

Every instance has these getters:

| Getter | Returns | Description |
| --- | --- | --- |
| `isRootWorkspace` | `boolean` | `true` when `relativePath === "."` |
| `isPublic` | `boolean` | `true` when `private` is `false` |
| `scope` | `Option<string>` | The `@scope` portion (e.g. `Option.some("@myorg")`), or `Option.none()` |
| `unscopedName` | `string` | Package name without the `@scope/` prefix |
| `allDependencies` | `Record<string, string>` | Merged map of all four dependency types |

```typescript
import { Effect, Option } from "effect";
import { NodeContext } from "@effect/platform-node";
import { WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/utils");

  console.log(pkg.isRootWorkspace);   // false
  console.log(pkg.isPublic);          // true
  console.log(pkg.unscopedName);      // "utils"
  console.log(pkg.packageJsonPath);   // example output (varies): "/workspace/packages/utils/package.json"

  if (Option.isSome(pkg.scope)) {
    console.log(pkg.scope.value);     // "@myorg"
  }

  // allDependencies merges dependencies + devDependencies +
  // peerDependencies + optionalDependencies
  console.log(Object.keys(pkg.allDependencies));
  // example output (varies): ["effect", "@effect/platform", "vitest", ...]
});
```

The `allDependencies` merge order is `optionalDependencies`, `peerDependencies`, `devDependencies`, `dependencies`. Later entries overwrite earlier ones, so when a package appears in more than one map the version from `dependencies` wins.

## Dependency query methods

Ask whether a package depends on something, either in a specific map or across all four:

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
  // Option.some("<version>") or Option.none()

  // Glob pattern matching on dependency names
  pkg.matchesDependency("@myorg/*");       // true if any dep matches the glob
  pkg.matchesDependency("react*");         // matches react, react-dom, etc.
});
```

`dependencyVersion` walks `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` in that order and returns the first match.

## Dual-API pattern

Every instance method is also exported as a standalone dual function. Call it as a method on the instance, or call the static form with the package as the first argument, or curry the static form for use inside `pipe`:

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

The same functions are exported as bare names too, so you can skip the class:

```typescript
import { hasDependency, hasAnyDependencyOn, matchesDependency } from "workspaces-effect";

// Static data-first
hasDependency(pkg, "effect");

// Static data-last (pipeable)
pipe(pkg, hasDependency("effect"));
```

The pipeable form drops straight into `Array.filter` and `Array.map`:

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

## Dependency diff

`dependencyDiff` reports what differs between two packages: what one has and the other does not, plus version mismatches. The comparison runs against `allDependencies`, so a dependency that switches type but keeps its version (say, moves from `dependencies` to `devDependencies` at `^1.2.3`) is not flagged.

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
    // example output (varies): "react: ^18.0.0 -> ^19.0.0"
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

The static forms work too:

```typescript
// Static data-first
WorkspacePackage.dependencyDiff(app, api);

// Static data-last (pipeable)
pipe(app, WorkspacePackage.dependencyDiff(api));
```

## PublishConfig

`PublishConfig` is the parsed `publishConfig` field from `package.json`, modelled as an Effect `Schema.Class`. It holds the registry, access flag, subdirectory and dist-tag, plus the pnpm `linkDirectory` extension:

| Field | Type | Description |
| --- | --- | --- |
| `access` | `"public" \| "restricted" \| undefined` | Scoped package visibility |
| `registry` | `string \| undefined` | Custom registry URL |
| `directory` | `string \| undefined` | Subdirectory to publish |
| `tag` | `string \| undefined` | npm dist-tag for publishing (e.g. `"beta"`, `"latest"`) |
| `linkDirectory` | `boolean \| undefined` | pnpm `linkDirectory` extension |

Because it is a `Schema.Class`, you can `new` it up directly or extend it with `Schema.extend`:

```typescript
import { Schema } from "effect";
import { PublishConfig } from "workspaces-effect";

// Construct directly
const config = new PublishConfig({
  access: "public",
  registry: "https://registry.npmjs.org",
  tag: "latest",
  linkDirectory: true,
});

// Extend with additional fields for downstream packages
const CustomPublishConfig = Schema.extend(
  PublishConfig,
  Schema.Struct({
    targets: Schema.optional(Schema.Array(Schema.String)),
  }),
);
```

## Reading package.json

`readPackageJson` reads and parses a package's `package.json` through `@effect/platform` `FileSystem`. The result is a `PackageJsonType` value with the usual fields: `name`, `version`, the four dependency maps, `workspaces` and so on.

```typescript
import { readPackageJson, WorkspacePackage } from "workspaces-effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const pkg = yield* discovery.getPackage("@myorg/utils");

  // As a standalone function
  const json = yield* readPackageJson(pkg);
  console.log(json.name, json.version, json.workspaces);
  // example output (varies): "@myorg/utils 1.2.3 undefined"

  // Or as a static method
  const json2 = yield* WorkspacePackage.readPackageJson(pkg);
});
```

This needs `FileSystem` in the Effect context. `NodeContext.layer` and `BunContext.layer` both supply it.

Fails with `PackageJsonParseError` when the file cannot be read or the JSON is malformed.

## Importer map

`WorkspaceDiscovery.importerMap()` returns a `ReadonlyMap<string, WorkspacePackage>` keyed by `relativePath`. Lockfiles refer to workspaces by relative paths like `packages/utils`, so this map gets you from a lockfile importer key to the matching package without a linear scan:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const importers = yield* discovery.importerMap();

  // Look up a package by its relative path
  const utils = importers.get("packages/utils");
  if (utils) {
    console.log(utils.name);
    // example output (varies): "@myorg/utils"
  }

  // The root package is keyed by "."
  const root = importers.get(".");
});
```

The map is built from `listPackages()` and shares its cache; repeated calls are free.

## Root package in listPackages

`listPackages()` puts the root workspace at index 0; it is the entry with `relativePath: "."`. When you only want child packages, filter on `isRootWorkspace`:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const all = yield* discovery.listPackages();

  // all[0].isRootWorkspace === true

  // Filter to non-root packages only
  const childPackages = all.filter((pkg) => !pkg.isRootWorkspace);
});
```

## Refreshing after mutation

`listPackages()` memoizes its result per resolved workspace root for the lifetime of the layer. That cache is correct for a static tree, but a process that mutates `package.json` files mid-run will keep seeing the pre-mutation snapshot. A common case is running `changeset version` to bump versions, then reading the new versions back from the same layer.

`WorkspaceDiscovery.refresh()` discards the cached package list. The next `listPackages()` — and `getPackage()` / `importerMap()`, which build on it — re-reads every `package.json` from disk. The resolved workspace root is preserved, since the root does not move when package contents change, so the next call pays only for the package re-scan, not the root walk:

```typescript
const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;

  // Snapshot taken and cached on first call
  const before = yield* discovery.getPackage("@myorg/app");

  // ...something mutates packages/app/package.json on disk
  // (for example, `changeset version` bumps it)

  yield* discovery.refresh();

  // Re-read from disk; reflects the new version
  const after = yield* discovery.getPackage("@myorg/app");
});
```

`refresh()` returns `Effect<void>` and never fails; the re-scan itself runs on the next discovery call and surfaces its errors there.
