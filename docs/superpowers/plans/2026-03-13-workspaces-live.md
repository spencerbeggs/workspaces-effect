# WorkspacesLive Composite Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phase-specific composite layers with two top-level
composites (`WorkspacesLive` and `WorkspacesFullLive`) that wire all
services together.

**Architecture:** Flat merge with explicit dependency threading using
`Layer.mergeAll` and `Layer.provide`. `WorkspacesLive` provides all
services except git-dependent ones. `WorkspacesFullLive` extends it
with ChangeDetector and PackageResolver. Old phase-specific composites
are deleted.

**Tech Stack:** Effect-TS (Layer.mergeAll, Layer.provide), Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-workspaces-live-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/layers/WorkspacesLive.ts` | Create | WorkspacesLive + WorkspacesFullLive composite layers |
| `src/layers/WorkspacesLive.test.ts` | Create | Composition tests for both layers |
| `src/layers/DiscoveryLive.ts` | Delete | Replaced by WorkspacesLive |
| `src/layers/ConfigurationLive.ts` | Delete | Replaced by WorkspacesLive |
| `src/layers/ChangeDetectionLive.ts` | Delete | Replaced by WorkspacesFullLive |
| `src/layers/index.ts` | Modify | Update internal barrel exports |
| `src/index.ts` | Modify | Remove old composite exports, add new ones |
| `src/layers/integration.test.ts` | Modify | Rename describe block |

---

## Chunk 1: Create WorkspacesLive and Delete Old Composites

### Task 1: Create WorkspacesLive.ts

**Files:**

- Create: `src/layers/WorkspacesLive.ts`

- [ ] **Step 1: Create the composite layer file**

Create `src/layers/WorkspacesLive.ts`:

```typescript
/**
 * Top-level composite layers that wire all services together.
 *
 * - WorkspacesLive: all services except git-dependent ones (ChangeDetector,
 *   PackageResolver). Requires FileSystem + Path.
 * - WorkspacesFullLive: all services including git-dependent ones.
 *   Additionally requires CommandExecutor.
 *
 * Individual *Live layers remain available for fine-grained composition.
 */

import type { CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Layer } from "effect";
import type { LockfileParseError, LockfileReadError, WorkspaceDiscoveryError } from "../errors/index.js";
import type { ChangeDetector } from "../services/ChangeDetector.js";
import type { DependencyGraph } from "../services/DependencyGraph.js";
import type { LockfileReader } from "../services/LockfileReader.js";
import type { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import type { PackageResolver } from "../services/PackageResolver.js";
import type { PublishabilityDetector } from "../services/PublishabilityDetector.js";
import type { TopologicalSorter } from "../services/TopologicalSorter.js";
import type { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import type { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { ChangeDetectorLive } from "./ChangeDetectorLive.js";
import { DependencyGraphLive } from "./DependencyGraphLive.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { PackageResolverLive } from "./PackageResolverLive.js";
import { PublishabilityDetectorLive } from "./PublishabilityDetectorLive.js";
import { TopologicalSorterLive } from "./TopologicalSorterLive.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/**
 * Composite layer providing all services except git-dependent ones.
 *
 * Provides: WorkspaceRoot, PackageManagerDetector, WorkspaceDiscovery,
 * DependencyGraph, TopologicalSorter, LockfileReader, PublishabilityDetector.
 *
 * Requires: FileSystem + Path (provide via NodeContext.layer or BunContext.layer).
 *
 * @example
 * ```typescript
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesLive } from "@spencerbeggs/workspaces-effect";
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 */
export const WorkspacesLive: Layer.Layer<
 | WorkspaceRoot
 | PackageManagerDetector
 | WorkspaceDiscovery
 | DependencyGraph
 | TopologicalSorter
 | LockfileReader
 | PublishabilityDetector,
 WorkspaceDiscoveryError | LockfileReadError | LockfileParseError,
 FileSystem.FileSystem | Path.Path
> = Layer.mergeAll(
 WorkspaceRootLive,
 PackageManagerDetectorLive,
 WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive)),
 DependencyGraphLive.pipe(
  Layer.provide(WorkspaceDiscoveryLive),
  Layer.provide(WorkspaceRootLive),
 ),
 TopologicalSorterLive.pipe(
  Layer.provide(DependencyGraphLive),
  Layer.provide(WorkspaceDiscoveryLive),
  Layer.provide(WorkspaceRootLive),
 ),
 LockfileReaderLive.pipe(
  Layer.provide(WorkspaceRootLive),
  Layer.provide(PackageManagerDetectorLive),
 ),
 PublishabilityDetectorLive, // pure layer, no dependencies
);

/**
 * Composite layer providing all services including git-dependent ones.
 *
 * Extends WorkspacesLive with PackageResolver and ChangeDetector.
 *
 * Requires: FileSystem + Path + CommandExecutor (provide via NodeContext.layer
 * or BunContext.layer).
 *
 * @example
 * ```typescript
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesFullLive } from "@spencerbeggs/workspaces-effect";
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 */
export const WorkspacesFullLive: Layer.Layer<
 | WorkspaceRoot
 | PackageManagerDetector
 | WorkspaceDiscovery
 | DependencyGraph
 | TopologicalSorter
 | LockfileReader
 | PublishabilityDetector
 | PackageResolver
 | ChangeDetector,
 WorkspaceDiscoveryError | LockfileReadError | LockfileParseError,
 FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = Layer.mergeAll(
 WorkspacesLive,
 PackageResolverLive.pipe(Layer.provide(WorkspacesLive)),
 ChangeDetectorLive.pipe(
  Layer.provide(PackageResolverLive),
  Layer.provide(WorkspacesLive),
 ),
);
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. The explicit type annotations will catch any wiring
errors at compile time.

- [ ] **Step 3: Commit**

```bash
git add src/layers/WorkspacesLive.ts
git commit -m "feat: add WorkspacesLive and WorkspacesFullLive composite layers"
```

---

### Task 2: Write composition tests

**Files:**

- Create: `src/layers/WorkspacesLive.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/layers/WorkspacesLive.test.ts`:

```typescript
/**
 * Tests for WorkspacesLive and WorkspacesFullLive composite layers.
 *
 * These are composition tests — they verify all services resolve through
 * the composite layer, not the service logic itself (individual layer
 * tests cover that).
 */

import { CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ChangeDetector } from "../services/ChangeDetector.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { LockfileReader } from "../services/LockfileReader.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { PackageResolver } from "../services/PackageResolver.js";
import { PublishabilityDetector } from "../services/PublishabilityDetector.js";
import { TopologicalSorter } from "../services/TopologicalSorter.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { WorkspacesFullLive, WorkspacesLive } from "./WorkspacesLive.js";

/** Mock filesystem with a minimal pnpm monorepo. */
const mockFs = () =>
 FileSystem.layerNoop({
  exists: (path) =>
   Effect.succeed(
    [
     "/projects/monorepo/pnpm-workspace.yaml",
     "/projects/monorepo/package.json",
     "/projects/monorepo/packages",
     "/projects/monorepo/packages/pkg-a",
     "/projects/monorepo/packages/pkg-a/package.json",
    ].includes(path),
   ),
  readFileString: (path) => {
   const files: Record<string, string> = {
    "/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'",
    "/projects/monorepo/package.json": JSON.stringify({
     name: "my-monorepo",
     packageManager: "pnpm@10.32.1",
    }),
    "/projects/monorepo/packages/pkg-a/package.json": JSON.stringify({
     name: "pkg-a",
     version: "1.0.0",
    }),
   };
   const content = files[path];
   if (content === undefined) {
    return Effect.die(new Error(`ENOENT: ${path}`));
   }
   return Effect.succeed(content);
  },
  readDirectory: (path) => {
   const dirs: Record<string, string[]> = {
    "/projects/monorepo/packages": ["pkg-a"],
   };
   const entries = dirs[path];
   if (entries === undefined) {
    return Effect.die(new Error(`ENOENT dir: ${path}`));
   }
   return Effect.succeed(entries);
  },
 });

/**
 * Mock WorkspaceRoot that returns a known path.
 * WorkspaceRootLive eagerly resolves process.cwd() at construction,
 * so we override it for testing.
 */
const mockRoot = Layer.succeed(WorkspaceRoot, {
 find: () => Effect.succeed("/projects/monorepo"),
});

/** WorkspacesLive with mockRoot swapped in for WorkspaceRoot. */
const testLayer = WorkspacesLive.pipe(
 Layer.provide(mockRoot),
 Layer.provide(Layer.mergeAll(mockFs(), Path.layer)),
);

describe("WorkspacesLive", () => {
 it("resolves WorkspaceRoot", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const root = yield* WorkspaceRoot;
    return yield* root.find("/any");
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result).toBe("/projects/monorepo");
 });

 it("resolves PackageManagerDetector", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const detector = yield* PackageManagerDetector;
    return yield* detector.detect("/projects/monorepo");
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result.type).toBe("pnpm");
 });

 it("resolves WorkspaceDiscovery", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const discovery = yield* WorkspaceDiscovery;
    return yield* discovery.listPackages();
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("pkg-a");
 });

 it("resolves DependencyGraph", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const graph = yield* DependencyGraph;
    return yield* graph.build();
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result.packages).toHaveLength(1);
 });

 it("resolves TopologicalSorter", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const sorter = yield* TopologicalSorter;
    return yield* sorter.sort();
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result).toHaveLength(1);
 });

 it("resolves PublishabilityDetector", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const detector = yield* PublishabilityDetector;
    const discovery = yield* WorkspaceDiscovery;
    const packages = yield* discovery.listPackages();
    return yield* detector.detect(packages[0], "/projects/monorepo");
   }).pipe(Effect.provide(testLayer)),
  );
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("pkg-a");
 });

 it("resolves LockfileReader", async () => {
  await Effect.runPromise(
   Effect.gen(function* () {
    const reader = yield* LockfileReader;
    expect(reader).toBeDefined();
    expect(typeof reader.read).toBe("function");
   }).pipe(Effect.provide(testLayer)),
  );
 });
});

describe("WorkspacesFullLive", () => {
 /** Mock CommandExecutor that returns empty git output. */
 const mockExecutor = Layer.succeed(CommandExecutor.CommandExecutor, {
  start: () => Effect.die(new Error("not implemented")),
 } as unknown as CommandExecutor.CommandExecutor);

 const fullTestLayer = WorkspacesFullLive.pipe(
  Layer.provide(mockRoot),
  Layer.provide(Layer.mergeAll(mockFs(), Path.layer, mockExecutor)),
 );

 it("resolves PackageResolver", async () => {
  const result = await Effect.runPromise(
   Effect.gen(function* () {
    const resolver = yield* PackageResolver;
    return yield* resolver.resolveFile("/projects/monorepo/packages/pkg-a/src/index.ts");
   }).pipe(Effect.provide(fullTestLayer)),
  );
  expect(result._tag).toBe("Some");
 });

 it("resolves ChangeDetector", async () => {
  await Effect.runPromise(
   Effect.gen(function* () {
    const detector = yield* ChangeDetector;
    expect(detector).toBeDefined();
    expect(typeof detector.changedFiles).toBe("function");
   }).pipe(Effect.provide(fullTestLayer)),
  );
 });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm run test`
Expected: All existing tests pass + new composition tests pass.

Note: Some tests may need adjustment if the mock filesystem or
`WorkspaceRoot` mock doesn't match what the services expect internally.
If tests fail, adjust the mock data to satisfy service requirements.
The goal is to verify each service tag resolves through the composite
layer — the detailed behavior is covered by individual layer tests.

- [ ] **Step 3: Commit**

```bash
git add src/layers/WorkspacesLive.test.ts
git commit -m "test: add composition tests for WorkspacesLive and WorkspacesFullLive"
```

---

### Task 3: Delete old composite layers

**Files:**

- Delete: `src/layers/DiscoveryLive.ts`
- Delete: `src/layers/ConfigurationLive.ts`
- Delete: `src/layers/ChangeDetectionLive.ts`

- [ ] **Step 1: Delete the three files**

```bash
rm src/layers/DiscoveryLive.ts
rm src/layers/ConfigurationLive.ts
rm src/layers/ChangeDetectionLive.ts
```

- [ ] **Step 2: Update src/layers/index.ts**

Replace the entire file `src/layers/index.ts` with:

```typescript
/**
 * Live layer implementations for workspace services.
 */

export { ChangeDetectorLive } from "./ChangeDetectorLive.js";
export { DependencyGraphLive } from "./DependencyGraphLive.js";
export { LockfileReaderLive } from "./LockfileReaderLive.js";
export { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
export { PackageResolverLive } from "./PackageResolverLive.js";
export { PublishabilityDetectorLive } from "./PublishabilityDetectorLive.js";
export { TopologicalSorterLive } from "./TopologicalSorterLive.js";
export { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
export { WorkspaceRootLive } from "./WorkspaceRootLive.js";
export { WorkspacesFullLive, WorkspacesLive } from "./WorkspacesLive.js";
```

Changes from current file (`src/layers/index.ts` currently has 9
exports and does not export `ConfigurationLive` or `FullConfigLive`):

- Remove: `ChangeDetectionLive`, `DiscoveryLive` exports
- Add: `LockfileReaderLive`, `PublishabilityDetectorLive`,
  `WorkspacesFullLive`, `WorkspacesLive` exports

- [ ] **Step 3: Update src/index.ts**

In `src/index.ts`, replace the Layers section (lines 24-36) with:

```typescript
// ── Layers ──────────────────────────────────────────────────────────
export { ChangeDetectorLive } from "./layers/ChangeDetectorLive.js";
export { DependencyGraphLive } from "./layers/DependencyGraphLive.js";
export { LockfileReaderLive } from "./layers/LockfileReaderLive.js";
export { PackageManagerDetectorLive } from "./layers/PackageManagerDetectorLive.js";
export { PackageResolverLive } from "./layers/PackageResolverLive.js";
export { PublishabilityDetectorLive } from "./layers/PublishabilityDetectorLive.js";
export { TopologicalSorterLive } from "./layers/TopologicalSorterLive.js";
export { WorkspaceDiscoveryLive } from "./layers/WorkspaceDiscoveryLive.js";
export { WorkspaceRootLive } from "./layers/WorkspaceRootLive.js";
export { WorkspacesFullLive, WorkspacesLive } from "./layers/WorkspacesLive.js";
```

Removed exports: `ChangeDetectionLive`, `ConfigurationLive`,
`FullConfigLive`, `DiscoveryLive`.
Added exports: `WorkspacesFullLive`, `WorkspacesLive`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. No other files import the deleted composites
(integration.test.ts uses individual layers directly).

- [ ] **Step 5: Run tests**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -u src/layers/DiscoveryLive.ts src/layers/ConfigurationLive.ts src/layers/ChangeDetectionLive.ts src/layers/index.ts src/index.ts
git commit -m "feat: replace phase-specific composites with WorkspacesLive exports"
```

---

### Task 4: Update integration tests

**Files:**

- Modify: `src/layers/integration.test.ts:1-7,177`

- [ ] **Step 1: Update file header comment**

In `src/layers/integration.test.ts`, replace lines 1-6:

```typescript
/**
 * Integration tests for composed discovery layers.
 *
 * Tests that WorkspaceRootLive and PackageManagerDetectorLive compose
 * correctly and can be used together in a single Effect program.
 */
```

With:

```typescript
/**
 * Integration tests for composed workspace layers.
 *
 * Tests that individual layers compose correctly and can be used
 * together in a single Effect program.
 */
```

- [ ] **Step 2: Rename describe block**

In `src/layers/integration.test.ts`, replace line 177:

```typescript
describe("DiscoveryLive composite layer", () => {
```

With:

```typescript
describe("Workspace layers composition", () => {
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/layers/integration.test.ts
git commit -m "refactor: rename integration test describe blocks for WorkspacesLive"
```

---

## Chunk 2: Final Verification

### Task 5: Full verification pass

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `pnpm run build`
Expected: Both dev and npm builds succeed.

- [ ] **Step 4: Run lint**

Run: `pnpm run lint:fix`
Expected: No errors.
