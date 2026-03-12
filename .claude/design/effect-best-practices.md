---
title: "Effect Best Practices & Patterns"
module: core
status: living
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - effect
  - patterns
  - best-practices
---

## Effect Best Practices & Patterns

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Service Definition](#service-definition)
- [Error Handling](#error-handling)
- [Schema Patterns](#schema-patterns)
- [Layer Composition](#layer-composition)
- [Testing](#testing)
- [Platform Abstraction](#platform-abstraction)
- [Gotchas & Pitfalls](#gotchas--pitfalls)
- [Powerful Abstractions](#powerful-abstractions)
- [Rationale](#rationale)

<!-- /TOC -->

## Overview

A living document of Effect-TS best practices, patterns, gotchas, and
powerful abstractions discovered during development of workspaces-effect
and sibling repos. Updated continuously as we learn.

## Current State

Initial patterns catalogued from research phase (2026-03-12). Will grow
as implementation progresses.

## Service Definition

### Use class-based Context.Tag (not GenericTag)

`Context.GenericTag` is deprecated. Class-based `Context.Tag` works with
Rslib + api-extractor DTS bundling:

```typescript
export class WorkspaceRoot extends Context.Tag(
  "@spencerbeggs/workspaces-effect/WorkspaceRoot"
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
Context.Tag("@spencerbeggs/workspaces-effect/WorkspaceRoot")
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

## Schema Patterns

### Schema.Literal for enums

```typescript
const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun");
type PackageManagerType = Schema.Schema.Type<typeof PackageManager>;
```

### Branded types for semantic strings

```typescript
const PackageName = Schema.NonEmptyString.pipe(Schema.brand("PackageName"));
```

### Schema.Class for domain objects

```typescript
class WorkspacePackage extends Schema.Class<WorkspacePackage>("WorkspacePackage")({
  name: Schema.NonEmptyString,
  version: Schema.String,
  private: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
```

### Schema.optionalWith for defaults

Prefer `Schema.optionalWith` with `default` over just `Schema.optional`
when you want a guaranteed value at runtime:

```typescript
Schema.optionalWith(Schema.Boolean, { default: () => false })
```

### Union for polymorphic fields

```typescript
const WorkspaceField = Schema.Union(
  Schema.Array(Schema.String),
  Schema.Struct({ packages: Schema.Array(Schema.String) })
);
```

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

## Testing

### Layer.succeed for test mocks

```typescript
const testDiscovery = Layer.succeed(WorkspaceDiscovery, {
  listPackages: () => Effect.succeed([]),
  getPackage: (name) => Effect.fail(new PackageNotFoundError({ name, available: [] })),
});
```

### FileSystem.layerNoop for filesystem mocking

```typescript
const mockFs = FileSystem.layerNoop({
  readFileString: (path) => Effect.succeed('{"name": "test"}'),
  exists: (path) => Effect.succeed(true),
  readDirectory: (path) => Effect.succeed(["pkg-a", "pkg-b"]),
});
```

### Vitest pool: forks (not threads)

Effect-TS requires the `forks` pool in Vitest:

```typescript
// vitest.config.ts
pool: "forks"
```

### Test composition with Layer.mergeAll

```typescript
const testLayer = Layer.mergeAll(testRoot, testDetector, testDiscovery);

const result = await Effect.runPromise(
  program.pipe(Effect.provide(testLayer))
);
```

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

Use class-based `Context.Tag`. See [Service Definition](#service-definition).

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

## Rationale

This document exists because Effect-TS is a powerful but nuanced library.
Capturing patterns and gotchas here prevents repeated mistakes and helps
maintain consistency across the codebase. The "living" status means this
document grows with the project.
