---
title: "Effect Patterns: Core Services & Layers"
module: core
category: patterns
status: current
completeness: 95
created: 2026-03-12
updated: 2026-03-14
last-synced: 2026-04-15
authors:
  - C. Spencer Beggs
tags:
  - effect
  - patterns
  - services
  - layers
  - errors
related:
  - architecture.md
  - effect-patterns-parsing.md
  - effect-patterns-testing.md
---

## Effect Patterns: Core Services & Layers

Patterns for service definition, error handling, layer composition, and
platform abstraction in workspaces-effect. Split from the original
effect-best-practices.md for focused context loading.

## Service Definition

### Use class-based Context.Tag (not GenericTag)

`Context.GenericTag` is deprecated. Class-based `Context.Tag` works with
Rslib + api-extractor DTS bundling:

```typescript
export class WorkspaceRoot extends Context.Tag(
  "workspaces-effect/WorkspaceRoot"
)<
  WorkspaceRoot,
  {
    readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError>;
  }
>() {}
```

The `_base` symbols appear as "forgotten exports" warnings in api-extractor
but are correctly inlined in the bundled `.d.ts`. These warnings are cosmetic.

### Service methods return Effect with R = never

Dependencies are injected at Layer construction time, not exposed in service
interfaces. Service methods should have `R = never`:

```typescript
// Good: R = never
readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError>

// Bad: leaks implementation dependencies
readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError, FileSystem>
```

### Use namespaced tag identifiers

Prefix tags with the package name to avoid collisions:

```typescript
Context.Tag("workspaces-effect/WorkspaceRoot")
```

## Error Handling

### Data.TaggedError with Base exports

Export the base constant for api-extractor DTS bundling:

```typescript
/** @internal */
export const MyErrorBase = Data.TaggedError("MyError");

export class MyError extends MyErrorBase<{
  readonly field: string;
  readonly reason: string;
}> {
  get message(): string {
    return `MyError: ${this.reason} (field: ${this.field})`;
  }
}
```

### Computed message getters

Use `get message()` for human-readable error output. Include enough
context for actionable debugging:

```typescript
get message(): string {
  return `Package "${this.name}" not found (${this.available.length} packages available)`;
}
```

### catchTag for precise error handling

```typescript
program.pipe(
  Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
    Effect.succeed(fallbackRoot)
  )
)
```

### catchTags for multiple error types

```typescript
program.pipe(
  Effect.catchTags({
    WorkspaceRootNotFoundError: (e) => Effect.succeed(fallback),
    PackageJsonParseError: (e) => Effect.fail(new WrappedError({ cause: e })),
  })
)
```

### Failures vs defects

- **Failures** (expected): Use `Effect.fail()` + `Data.TaggedError`. Tracked
  in the `E` type parameter. Consumers handle these.
- **Defects** (unexpected): Use `Effect.die()`. NOT tracked in types. Only
  for programmer errors / impossible states.

```typescript
// Failure: consumer should handle this
return Effect.fail(new PackageNotFoundError({ name, available: [] }));

// Defect: should never happen
if (!isValidState) return Effect.die(new Error("Invariant violated"));
```

### Error accumulation (no short-circuit)

When processing multiple items where all errors should be reported:

```typescript
Effect.forEach(
  packages,
  (pkg) => validatePkg(pkg).pipe(
    Effect.map((v) => ({ _tag: "ok" as const, value: v })),
    Effect.catchAll((e) => Effect.succeed({ _tag: "err" as const, pkg, error: e })),
  ),
  { concurrency: 5 },
)
```

## Platform Error Handling

### Converting PlatformError to clean values with orElseSucceed

`@effect/platform` FileSystem operations fail with `PlatformError`, which
would leak into the error channel of your service methods. Use
`Effect.orElseSucceed` to convert these to clean values when the FS operation
is exploratory (checking existence, reading optional files):

```typescript
// Convert fs.exists PlatformError to boolean
const exists = yield* fs.exists(filePath).pipe(
  Effect.orElseSucceed(() => false)
);

// Convert fs.readFileString PlatformError to safe default
const content = yield* fs.readFileString(filePath).pipe(
  Effect.orElseSucceed(() => "{}")
);
```

This keeps the error channel clean -- your service methods expose only your
own typed errors (e.g., `WorkspaceRootNotFoundError`), not platform-level
filesystem errors.

### Effect.option for directory walking

When walking up directories to find a workspace root, use `Effect.option`
to convert expected failures (reaching filesystem root without finding a
marker) into `Option` values:

```typescript
const parent = yield* Effect.option(getParentDir(currentDir));
// Option.None means we've exhausted the search
```

### When to use which pattern

| Scenario | Pattern | Result Type |
| -------- | ------- | ----------- |
| File existence check | `Effect.orElseSucceed(() => false)` | `boolean` |
| Optional file read | `Effect.orElseSucceed(() => defaultValue)` | `string` |
| Search that may exhaust | `Effect.option` | `Option<T>` |
| Must-succeed FS op | Let PlatformError propagate | Caller handles |

## Layer Composition

### Layer.effect for services with dependencies

```typescript
const WorkspaceRootLive = Layer.effect(
  WorkspaceRoot,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return {
      find: (cwd) => findRoot(fs, path, cwd),
    };
  })
);
```

### Layer.succeed for static implementations

```typescript
const ConfigLive = Layer.succeed(Config, { logLevel: "INFO" });
```

### Layer.mergeAll for combining independent layers

```typescript
const DiscoveryLive = Layer.mergeAll(
  WorkspaceRootLive,
  PackageManagerDetectorLive,
  WorkspaceDiscoveryLive,
);
```

### Layer.provide for dependency chains

```typescript
const FullLive = WorkspaceDiscoveryLive.pipe(
  Layer.provide(WorkspaceRootLive)
);
```

## Effect.Service Pattern

**Note: This pattern is not used in this codebase.** We use `Context.Tag` +
`Layer.effect` exclusively (see Service Definition and Layer Composition
above). Documented here as reference for awareness.

The modern `Effect.Service` pattern combines service definition and layer
creation in a single declaration:

```typescript
class Cache extends Effect.Service<Cache>()("app/Cache", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const lookup = (key: string) => fs.readFileString(`cache/${key}`)
    return { lookup } as const
  }),
  dependencies: [NodeFileSystem.layer]
}) {}

// Auto-generates:
// Cache.Default           -- Layer<Cache, never, never> (deps included)
// Cache.DefaultWithoutDependencies -- Layer<Cache, never, FileSystem>
```

`Cache.Default` is a fully wired layer (dependencies baked in), while
`Cache.DefaultWithoutDependencies` exposes the dependency requirements in
the `R` channel for manual wiring.

**Note on `scoped`:** Use `scoped` instead of `effect` when the service
manages resources that need cleanup (e.g., open file handles, connections).
The `scoped` variant ensures resources are released when the layer is torn
down:

```typescript
class DbPool extends Effect.Service<DbPool>()("app/DbPool", {
  scoped: Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      createPool(),
      (pool) => pool.close()
    )
    return { query: (sql: string) => pool.query(sql) } as const
  }),
}) {}
```

## Dynamic Layer Patterns

### Layer.unwrapEffect for runtime-dependent layers

`Layer.unwrapEffect` creates layers whose construction depends on runtime
information (e.g., environment variables, config files). It takes an
`Effect<Layer>` and "unwraps" it into a plain `Layer`:

```typescript
const LogLevelLive = Config.logLevel("LOG_LEVEL").pipe(
  Effect.andThen((level) => Logger.minimumLogLevel(level)),
  Layer.unwrapEffect
)
```

This is useful when a layer's behavior must be determined at startup from
config, environment, or other effectful sources.

### Layer.orElse for fallback layers

`Layer.orElse` provides a fallback when a layer's construction fails. The
fallback layer is only constructed if the primary layer fails:

```typescript
const database = postgresDatabaseLayer.pipe(
  Layer.orElse(() => inMemoryDatabaseLayer)
)
```

**Relevance to workspaces-effect:** `Layer.orElse` could be used for
fallback package manager detection -- try pnpm lockfile layer, fall back
to npm, etc.:

```typescript
const PackageManagerLive = pnpmDetectorLayer.pipe(
  Layer.orElse(() => yarnDetectorLayer),
  Layer.orElse(() => npmDetectorLayer),
  Layer.orElse(() => bunDetectorLayer),
)
```

## Request/RequestResolver Pattern

For service methods that perform repeated lookups against a fixed dataset,
the Request/RequestResolver pattern provides per-layer caching and
deduplication. Used in DependencyGraphLive and LockfileReaderLive.

### Request.TaggedClass

Define requests with type parameter order `<Success, Error, Payload>`:

```typescript
class DependenciesOfRequest extends Request.TaggedClass("DependenciesOfRequest")<
  ReadonlyArray<string>,      // Success type
  PackageNotFoundError,        // Error type
  { readonly name: string }    // Payload
> {}
```

### RequestResolver.fromEffect for in-memory lookups

Create a resolver from a function that handles a single request:

```typescript
const DependenciesOfResolver = RequestResolver.fromEffect(
  (req: DependenciesOfRequest) => {
    const deps = graph.edges.get(req.name);
    if (deps === undefined) {
      return Effect.fail(
        new PackageNotFoundError({ name: req.name, available })
      );
    }
    return Effect.succeed(Array.from(deps).sort());
  }
);
```

### Per-layer cache via Request.makeCache

Create a cache inside `Layer.effect` so each layer instance (and each test)
gets its own isolated cache:

```typescript
const cache = yield* Request.makeCache({
  capacity: 1024,
  timeToLive: "1 minute",
});
```

### Effect.request with both cache directives

Use `Effect.request` in method bodies. **Both `withRequestCache` AND
`withRequestCaching` are required together:**

- `Effect.withRequestCache(cache)` -- sets *which* cache to use
- `Effect.withRequestCaching(true)` -- *enables* cache lookups

If you only set one, caching will not work:

```typescript
return {
  dependenciesOf: (name: string) =>
    Effect.request(
      new DependenciesOfRequest({ name }),
      DependenciesOfResolver
    ).pipe(
      Effect.withRequestCache(cache),
      Effect.withRequestCaching(true),
    ),
};
```

See `src/layers/DependencyGraphLive.ts` and `src/layers/LockfileReaderLive.ts`
for complete implementations.

## Platform Abstraction

### Use @effect/platform services

Never import `node:fs`, `node:path`, or `node:child_process` directly.
Use platform abstractions:

```typescript
import { FileSystem } from "@effect/platform";
import { Path } from "@effect/platform";
import { Command } from "@effect/platform";
```

### Users provide platform layers at the edge

```typescript
// Node.js
import { NodeContext } from "@effect/platform-node";
program.pipe(Effect.provide(NodeContext.layer));

// Bun
import { BunContext } from "@effect/platform-bun";
program.pipe(Effect.provide(BunContext.layer));
```

## Gotchas & Pitfalls

### GenericTag is deprecated

Use class-based `Context.Tag`. See Service Definition above.

### Effect.runPromiseExit requires R = never

You cannot pass an Effect with service requirements to `runPromiseExit`.
Provide all layers first:

```typescript
// Wrong: program requires WorkspaceRoot
await Effect.runPromiseExit(program);

// Right: provide the layer first
await Effect.runPromiseExit(program.pipe(Effect.provide(testLayer)));
```

### Schema.Class generates _base symbols

`Schema.Class` and `Context.Tag` both generate `_base` symbols that
api-extractor reports as "forgotten exports". These are cosmetic warnings
and do not affect the bundled DTS output.

### JSONC parsing for bun.lock

Standard `JSON.parse()` cannot handle `bun.lock` files because they
contain trailing commas. Use a JSONC parser or strip commas.

### Vitest pool must be forks

Effect uses features that require process isolation. Using the `threads`
pool will cause intermittent test failures.

## Powerful Abstractions

### Effect.withSpan for observability

Add tracing to key operations without modifying the core logic:

```typescript
const findRoot = (cwd: string) =>
  findRootImpl(cwd).pipe(
    Effect.withSpan("WorkspaceRoot.find", {
      attributes: { "workspace.cwd": cwd }
    })
  );
```

### acquireUseRelease for resource brackets

```typescript
Effect.acquireUseRelease(
  /* acquire */ openResource(),
  /* use */    (resource) => doWork(resource),
  /* release */ (resource) => closeResource(resource),
)
```

### Effect.retry with Schedule

```typescript
effect.pipe(
  Effect.retry({
    schedule: Schedule.exponential("1 second").pipe(
      Schedule.compose(Schedule.recurs(3))
    ),
    while: Predicate.isTagged("NetworkError"),
  })
);
```

### Function.dual for pipe-friendly APIs

For public utility functions that users might want to pipe:

```typescript
export const isInWorkspace: {
  (root: string): (pkg: WorkspacePackage) => boolean;
  (pkg: WorkspacePackage, root: string): boolean;
} = Fn.dual(2, (pkg: WorkspacePackage, root: string): boolean =>
  pkg.path.startsWith(root)
);
```

### Effect.validateAll for collecting all errors

```typescript
Effect.validateAll([pkg1, pkg2, pkg3], (pkg) => validatePackage(pkg));
// Returns all failures instead of short-circuiting
```

### Config with Schema validation

```typescript
const rootConfig = Schema.Config("WORKSPACE_ROOT", Schema.NonEmptyString);
```
