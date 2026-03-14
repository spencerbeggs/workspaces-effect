# Request/RequestResolver Internal Refactor Design Spec

## Goal

Refactor `DependencyGraphLive` and `LockfileReaderLive` to use Effect's
Request/RequestResolver pattern internally, gaining free deduplication and
caching while keeping service interfaces unchanged.

## Motivation

Two complementary goals:

- **Ergonomics** — Effect's request caching automatically deduplicates
  identical lookups within the same scope, eliminating redundant work
  without manual memoization.
- **Future-proofing** — when these services eventually move from eager
  in-memory construction to on-demand I/O, the Request/RequestResolver
  plumbing is already in place. Migration to batched resolvers becomes a
  one-line change per method.

## Scope

Three methods across two services:

| Service | Method | Current impl |
| --- | --- | --- |
| DependencyGraph | `dependenciesOf(name)` | O(1) Map lookup in `edges` |
| DependencyGraph | `dependentsOf(name)` | O(1) Map lookup in `reverseEdges` |
| LockfileReader | `resolvedVersion(packageName)` | O(1) Map lookup in `packageIndex` |

**Excluded:** `packages()`, `readLockfile`, `workspaceDependencies` — these
return aggregate data or have different access patterns that don't benefit
from request-level caching.

## Approach

Internal replacement — service interfaces stay identical. Only the layer
implementation changes. Consumers see no difference.

### Request Type Definitions

Module-scoped (not exported) request classes using `Request.TaggedClass`.
The type parameter order is `<Success, Error, Payload>`:

```typescript
// DependencyGraphLive.ts
class DependenciesOfRequest extends Request.TaggedClass("DependenciesOfRequest")<
  ReadonlyArray<string>,
  PackageNotFoundError,
  { readonly name: string }
> {}

class DependentsOfRequest extends Request.TaggedClass("DependentsOfRequest")<
  ReadonlyArray<string>,
  PackageNotFoundError,
  { readonly name: string }
> {}

// LockfileReaderLive.ts
class ResolvedVersionRequest extends Request.TaggedClass("ResolvedVersionRequest")<
  Option.Option<ResolvedPackage>,
  never,
  { readonly packageName: string }
> {}
```

Key decisions:

- DependencyGraph requests carry `PackageNotFoundError` — the current
  implementation fails when a package name is not in the graph
- LockfileReader's `resolvedVersion` returns `Option.none()` for unknown
  packages rather than failing, so its error channel is `never`
- Return type for `resolvedVersion` is `Option.Option<ResolvedPackage>`
  (a structured object), not `Option.Option<string>`
- Request classes are module-scoped implementation details, not exported
- Tag strings match class names for debuggability

### Resolver Construction

Resolvers are created inside `Layer.effect`, closing over the pre-built Maps:

```typescript
// DependencyGraphLive.ts — inside Layer.effect
const DependenciesOfResolver = RequestResolver.fromEffect(
  (req: DependenciesOfRequest) => {
    const deps = edges.get(req.name);
    if (deps === undefined) {
      return Effect.fail(
        new PackageNotFoundError({
          name: req.name,
          available: Array.from(graph.nodes),
        }),
      );
    }
    return Effect.succeed(Array.from(deps));
  }
);

const DependentsOfResolver = RequestResolver.fromEffect(
  (req: DependentsOfRequest) => {
    const dependents = reverseEdges.get(req.name);
    if (dependents === undefined) {
      return Effect.fail(
        new PackageNotFoundError({
          name: req.name,
          available: Array.from(graph.nodes),
        }),
      );
    }
    return Effect.succeed(Array.from(dependents));
  }
);

// LockfileReaderLive.ts — inside Layer.effect
const ResolvedVersionResolver = RequestResolver.fromEffect(
  (req: ResolvedVersionRequest) =>
    Effect.succeed(
      Option.fromNullable(packageIndex.get(req.packageName)?.[0])
    )
);
```

Key decisions:

- `RequestResolver.fromEffect` (non-batched) — appropriate for in-memory lookups
- DependencyGraph resolvers replicate the `PackageNotFoundError` failure
  path from the current implementation
- LockfileReader resolver matches the current `Option.fromNullable` pattern
- Resolvers close over pre-built Maps, keeping O(1) performance
- No `contextFromServices` needed — data is captured at construction time

### Method Implementation Changes

Methods change from inline logic to `Effect.request`:

```typescript
// Before:
dependenciesOf: (name) =>
  Effect.gen(function* () {
    const deps = edges.get(name);
    if (deps === undefined) {
      return yield* Effect.fail(new PackageNotFoundError({ ... }));
    }
    return Array.from(deps);
  }).pipe(
    Effect.withSpan("DependencyGraph.dependenciesOf", { ... }),
  ),

// After:
dependenciesOf: (name) =>
  Effect.request(
    new DependenciesOfRequest({ name }),
    DependenciesOfResolver,
  ).pipe(
    Effect.withRequestCaching(true),
    Effect.withSpan("DependencyGraph.dependenciesOf", {
      attributes: { "workspace.package": name },
    }),
  ),
```

`Effect.withRequestCaching(true)` opts this request into using whatever
cache is in scope. It is placed per-call on the individual `Effect.request`
invocation — this is intentional, keeping caching opt-in at the method level.

Same pattern for `dependentsOf` and `resolvedVersion`. Existing
`Effect.withSpan` attributes remain untouched. The `Effect.logDebug` call
in `resolvedVersion` moves into the resolver body.

## Files Modified

| File | Action | Changes |
| --- | --- | --- |
| `src/layers/DependencyGraphLive.ts` | Modify | Add `Request`, `RequestResolver` imports; define request classes and resolvers; refactor `dependenciesOf`/`dependentsOf` to use `Effect.request` |
| `src/layers/LockfileReaderLive.ts` | Modify | Add `Request`, `RequestResolver` imports; define request class and resolver; refactor `resolvedVersion` to use `Effect.request` |
| `src/layers/DependencyGraphLive.test.ts` | Modify | Add 2 caching tests (one per method) |
| `src/layers/LockfileReaderLive.test.ts` | Modify | Add 1 caching test for `resolvedVersion` |

No new files. No changes to service interfaces, exports, or layer wiring.

## Testing Strategy

Existing tests remain unchanged — they validate behavioral correctness and
continue passing since the public interface is identical.

New tests verify that Request/RequestResolver wiring is in place and caching
is active:

**DependencyGraphLive — 2 new tests:**

- `caches dependenciesOf requests within the same scope` — calls
  `dependenciesOf("pkg-a")` twice in one `Effect.gen` block, asserts
  reference equality (`===`) on results
- `caches dependentsOf requests within the same scope` — same pattern
  for `dependentsOf`

**LockfileReaderLive — 1 new test:**

- `caches resolvedVersion requests within the same scope` — calls
  `resolvedVersion("some-dep")` twice in one `Effect.gen` block, asserts
  reference equality on results

**Concrete test skeleton:**

```typescript
it("caches dependenciesOf requests within the same scope", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* Request.makeCache({
        capacity: 100,
        timeToLive: Duration.seconds(60),
      });
      return yield* Effect.withRequestCache(cache)(
        Effect.gen(function* () {
          const graph = yield* DependencyGraph;
          const first = yield* graph.dependenciesOf("pkg-a");
          const second = yield* graph.dependenciesOf("pkg-a");
          return { first, second };
        }),
      );
    }).pipe(Effect.provide(testLayer)),
  );

  expect(result.first).toBe(result.second); // reference equality
});
```

`Request.makeCache` is effectful — it returns `Effect<Cache>`, so it must
be `yield*`'d inside `Effect.gen`. The cache is then provided to the inner
block via `Effect.withRequestCache(cache)(effect)`. Without this setup,
there is no cache in scope and both calls would execute independently.

Tests co-locate in existing test files (`DependencyGraphLive.test.ts`,
`LockfileReaderLive.test.ts`).

## Error Handling

No new error types. The Request types encode the same error channels as
the current implementations:

- `DependenciesOfRequest` / `DependentsOfRequest`: error channel is
  `PackageNotFoundError` (fails when package name is not in the graph)
- `ResolvedVersionRequest`: error channel is `never` (returns
  `Option.none()` for unknown packages)

## Breaking Changes

None. This is a pure internal refactor:

- Service interfaces unchanged
- Return types unchanged
- Error types unchanged
- Layer composition unchanged
- Exports unchanged

## Future Upgrade Path

When these services move to real I/O (e.g., on-demand lockfile parsing):

1. Change resolver from `RequestResolver.fromEffect` to
   `RequestResolver.makeBatched`
2. Add real error types to the Request class error parameter (if not
   already present)
3. Service interface error channel may widen — the only potential
   breaking change
