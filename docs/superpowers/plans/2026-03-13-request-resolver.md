# Request/RequestResolver Internal Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `dependenciesOf`, `dependentsOf`, and `resolvedVersion` to
use Effect's Request/RequestResolver pattern internally, gaining free
deduplication and caching while keeping service interfaces unchanged.

**Architecture:** Define module-scoped Request classes and `fromEffect` resolvers
that close over the pre-built Maps inside `Layer.effect`. Replace inline
`Effect.gen` method bodies with `Effect.request` calls. Add caching verification
tests using `Request.makeCache` + `Effect.withRequestCache`.

**Tech Stack:** Effect (`Request`, `RequestResolver`, `Effect.request`,
`Effect.withRequestCaching`, `Request.makeCache`, `Effect.withRequestCache`)

**Spec:** `docs/superpowers/specs/2026-03-13-request-resolver-design.md`

---

## Chunk 1: DependencyGraphLive

### Task 1: Add Request/RequestResolver to DependencyGraphLive

**Files:**

- Modify: `src/layers/DependencyGraphLive.ts`

**Context:** The current implementation at lines 107-154 uses `Effect.gen` with
inline Map lookups for `dependenciesOf` and `dependentsOf`. Both fail with
`PackageNotFoundError` when the package name is not in the graph. The graph
state (`edges`, `reverseEdges`, `nodes`) is built eagerly at layer construction
(line 98) and captured in the closure.

- [ ] **Step 1: Add imports for Request and RequestResolver**

At line 9, add `Request` and `RequestResolver` to the import:

```typescript
import { Effect, Layer, Request, RequestResolver } from "effect";
```

- [ ] **Step 2: Define DependenciesOfRequest class**

Add after line 20 (after the `GraphState` interface), before `buildGraph`:

```typescript
/** @internal Request for dependenciesOf lookups. */
class DependenciesOfRequest extends Request.TaggedClass("DependenciesOfRequest")<
 ReadonlyArray<string>,
 PackageNotFoundError,
 { readonly name: string }
> {}
```

- [ ] **Step 3: Define DependentsOfRequest class**

Add immediately after `DependenciesOfRequest`:

```typescript
/** @internal Request for dependentsOf lookups. */
class DependentsOfRequest extends Request.TaggedClass("DependentsOfRequest")<
 ReadonlyArray<string>,
 PackageNotFoundError,
 { readonly name: string }
> {}
```

- [ ] **Step 4: Create resolvers inside Layer.effect**

Inside the `Effect.gen` callback, after line 105 (after the `logDebug` call)
and before the `return {` block at line 107, add:

```typescript
const DependenciesOfResolver = RequestResolver.fromEffect((req: DependenciesOfRequest) => {
 const deps = graph.edges.get(req.name);
 if (deps === undefined) {
  return Effect.fail(
   new PackageNotFoundError({
    name: req.name,
    available: Array.from(graph.nodes),
   }),
  );
 }
 return Effect.succeed(Array.from(deps).sort());
});

const DependentsOfResolver = RequestResolver.fromEffect((req: DependentsOfRequest) => {
 const dependents = graph.reverseEdges.get(req.name);
 if (dependents === undefined) {
  return Effect.fail(
   new PackageNotFoundError({
    name: req.name,
    available: Array.from(graph.nodes),
   }),
  );
 }
 return Effect.succeed(Array.from(dependents).sort());
});
```

- [ ] **Step 5: Replace dependenciesOf method body**

Replace the current `dependenciesOf` method (lines 108-130) with:

```typescript
dependenciesOf: (name: string) =>
 Effect.request(new DependenciesOfRequest({ name }), DependenciesOfResolver).pipe(
  Effect.withRequestCaching(true),
  Effect.tap(() =>
   Effect.logDebug("Resolved dependencies").pipe(
    Effect.annotateLogs({
     "workspace.package": name,
     "workspace.deps.count": graph.edges.get(name)?.size ?? 0,
    }),
   ),
  ),
  Effect.withSpan("DependencyGraph.dependenciesOf", {
   attributes: { "workspace.package": name },
  }),
 ),
```

Note: The `Effect.logDebug` is moved to `Effect.tap` after the request
resolves, so it only fires on success (same behavior as the original
`Effect.gen` which logged after the undefined check).

- [ ] **Step 6: Replace dependentsOf method body**

Replace the current `dependentsOf` method (lines 132-154) with:

```typescript
dependentsOf: (name: string) =>
 Effect.request(new DependentsOfRequest({ name }), DependentsOfResolver).pipe(
  Effect.withRequestCaching(true),
  Effect.tap(() =>
   Effect.logDebug("Resolved dependents").pipe(
    Effect.annotateLogs({
     "workspace.package": name,
     "workspace.deps.count": graph.reverseEdges.get(name)?.size ?? 0,
    }),
   ),
  ),
  Effect.withSpan("DependencyGraph.dependentsOf", {
   attributes: { "workspace.package": name },
  }),
 ),
```

- [ ] **Step 7: Run existing tests to verify nothing breaks**

Run: `pnpm vitest run src/layers/DependencyGraphLive.test.ts`
Expected: All 12 existing tests pass (dependenciesOf ×6, dependentsOf ×1,
packages ×1, hasCycle ×3, adjacencyMap ×1).

- [ ] **Step 8: Run full test suite**

Run: `pnpm run test`
Expected: All 171 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/layers/DependencyGraphLive.ts
git commit -m "feat: refactor DependencyGraph to use Request/RequestResolver

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

### Task 2: Add caching verification tests for DependencyGraph

**Files:**

- Modify: `src/layers/DependencyGraphLive.test.ts`

**Context:** The test file uses a `testLayer` helper (line 36) that creates a
`DependencyGraphLive` layer with a mock `WorkspaceDiscovery`. The `pkg` helper
(line 26) creates `WorkspacePackage` instances. We need to add tests that prove
the Request/RequestResolver caching is active by asserting reference equality.

- [ ] **Step 1: Add Duration and Request imports**

At line 5, update the import:

```typescript
import { Duration, Effect, Layer, Request } from "effect";
```

- [ ] **Step 2: Write caching tests for dependenciesOf and dependentsOf**

Add a new `describe("request caching", ...)` block after the existing
`adjacencyMap` describe block (after line 217), before the final `});`:

```typescript
describe("request caching", () => {
 it("caches dependenciesOf requests within the same scope", async () => {
  const layer = testLayer([
   pkg("pkg-a", { "pkg-b": "workspace:*" }),
   pkg("pkg-b"),
  ]);

  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const cache = yield* Request.makeCache({
     capacity: 100,
     timeToLive: Duration.seconds(60),
    });
    return yield* Effect.withRequestCache(
     Effect.gen(function* () {
      const graph = yield* DependencyGraph;
      const first = yield* graph.dependenciesOf("pkg-a");
      const second = yield* graph.dependenciesOf("pkg-a");
      return { first, second };
     }),
     cache,
    );
   }).pipe(Effect.provide(layer)),
  );

  // Reference equality proves caching — without caching,
  // each call creates a new Array.from(deps).sort()
  expect(result.first).toBe(result.second);
  expect(result.first).toEqual(["pkg-b"]);
 });

 it("caches dependentsOf requests within the same scope", async () => {
  const layer = testLayer([
   pkg("pkg-a", { "pkg-b": "workspace:*" }),
   pkg("pkg-b"),
  ]);

  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const cache = yield* Request.makeCache({
     capacity: 100,
     timeToLive: Duration.seconds(60),
    });
    return yield* Effect.withRequestCache(
     Effect.gen(function* () {
      const graph = yield* DependencyGraph;
      const first = yield* graph.dependentsOf("pkg-b");
      const second = yield* graph.dependentsOf("pkg-b");
      return { first, second };
     }),
     cache,
    );
   }).pipe(Effect.provide(layer)),
  );

  expect(result.first).toBe(result.second);
  expect(result.first).toEqual(["pkg-a"]);
 });
});
```

- [ ] **Step 3: Run all tests to verify**

Run: `pnpm vitest run src/layers/DependencyGraphLive.test.ts`
Expected: All 14 tests pass (12 existing + 2 new caching tests).

- [ ] **Step 4: Commit**

```bash
git add src/layers/DependencyGraphLive.test.ts
git commit -m "test: add request caching verification tests for DependencyGraph

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

## Chunk 2: LockfileReaderLive

### Task 3: Add Request/RequestResolver to LockfileReaderLive

**Files:**

- Modify: `src/layers/LockfileReaderLive.ts`

**Context:** The current `resolvedVersion` implementation at lines 94-108 uses
`Effect.gen` with an inline `Option.fromNullable(packageIndex.get(...))`
lookup. It returns `Option.Option<ResolvedPackage>` and has error channel
`never`. The `packageIndex` Map is built eagerly at layer construction
(lines 77-82). The `ResolvedPackage` type is imported from
`../schemas/lockfile.js`.

- [ ] **Step 1: Add imports for Request and RequestResolver**

At line 2, update the import:

```typescript
import { Effect, Layer, Option, Request, RequestResolver } from "effect";
```

- [ ] **Step 2: Import ResolvedPackage as a value (not just type)**

The existing import on line 6 is `import type { ResolvedPackage }`.
The Request class needs `ResolvedPackage` as a type parameter, which works
with `import type`. No change needed — `import type` works in type positions.

- [ ] **Step 3: Define ResolvedVersionRequest class**

Add after the `parseLockfile` function (after line 40), before the
`LockfileReaderLiveLayer` type export:

```typescript
/** @internal Request for resolvedVersion lookups. */
class ResolvedVersionRequest extends Request.TaggedClass("ResolvedVersionRequest")<
 Option.Option<ResolvedPackage>,
 never,
 { readonly packageName: string }
> {}
```

- [ ] **Step 4: Create resolver inside Layer.effect**

Inside the `Effect.gen` callback, after line 89 (after the `logInfo` call)
and before the `return {` block at line 91, add:

```typescript
const ResolvedVersionResolver = RequestResolver.fromEffect(
 (req: ResolvedVersionRequest) =>
  Effect.succeed(Option.fromNullable(packageIndex.get(req.packageName)?.[0])),
);
```

- [ ] **Step 5: Replace resolvedVersion method body**

Replace the current `resolvedVersion` method (lines 94-108) with:

```typescript
resolvedVersion: (packageName: string) =>
 Effect.request(new ResolvedVersionRequest({ packageName }), ResolvedVersionResolver).pipe(
  Effect.withRequestCaching(true),
  Effect.tap((result) =>
   Effect.logDebug("Resolved version lookup").pipe(
    Effect.annotateLogs({
     "workspace.package": packageName,
     "workspace.found": Option.isSome(result),
    }),
   ),
  ),
  Effect.withSpan("LockfileReader.resolvedVersion", {
   attributes: { "workspace.package": packageName },
  }),
 ),
```

- [ ] **Step 6: Run existing tests to verify nothing breaks**

Run: `pnpm vitest run src/layers/LockfileReaderLive.test.ts`
Expected: All 8 existing tests pass.

- [ ] **Step 7: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass (171 + 2 from Task 2 = 173).

- [ ] **Step 8: Commit**

```bash
git add src/layers/LockfileReaderLive.ts
git commit -m "feat: refactor LockfileReader.resolvedVersion to use Request/RequestResolver

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

### Task 4: Add caching verification test for LockfileReader

**Files:**

- Modify: `src/layers/LockfileReaderLive.test.ts`

**Context:** The test file uses a `testLayer` helper (line 91) that creates a
`LockfileReaderLive` layer with mock `WorkspaceRoot`, `PackageManagerDetector`,
`FileSystem`, and `Path`. The pnpm fixture (`PNPM_FIXTURE`, line 11) contains
`lodash@4.17.21` as a resolved package.

- [ ] **Step 1: Add Duration and Request imports**

At line 2, update the import:

```typescript
import { Duration, Effect, Exit, Layer, Option, Request } from "effect";
```

- [ ] **Step 2: Write caching test for resolvedVersion**

Add a new `describe("request caching", ...)` block after the existing
"fails with LockfileReadError" test (after line 239), before the final `});`:

```typescript
describe("request caching", () => {
 it("caches resolvedVersion requests within the same scope", async () => {
  const layer = testLayer("pnpm", PNPM_FIXTURE);

  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const cache = yield* Request.makeCache({
     capacity: 100,
     timeToLive: Duration.seconds(60),
    });
    return yield* Effect.withRequestCache(
     Effect.gen(function* () {
      const reader = yield* LockfileReader;
      const first = yield* reader.resolvedVersion("lodash");
      const second = yield* reader.resolvedVersion("lodash");
      return { first, second };
     }),
     cache,
    );
   }).pipe(Effect.provide(layer)),
  );

  // Reference equality proves caching — without caching,
  // each call creates a new Option.fromNullable(...)
  expect(result.first).toBe(result.second);
  expect(Option.isSome(result.first)).toBe(true);
  if (Option.isSome(result.first)) {
   expect(result.first.value.version).toBe("4.17.21");
  }
 });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run src/layers/LockfileReaderLive.test.ts`
Expected: All 9 tests pass (8 existing + 1 new caching test).

- [ ] **Step 4: Run full test suite**

Run: `pnpm run test`
Expected: All 174 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/layers/LockfileReaderLive.test.ts
git commit -m "test: add request caching verification test for LockfileReader

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: 174 tests pass (171 original + 3 new caching tests).

- [ ] **Step 2: Run linter**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 3: Run type checker**

Run: `pnpm run typecheck`
Expected: No errors.
