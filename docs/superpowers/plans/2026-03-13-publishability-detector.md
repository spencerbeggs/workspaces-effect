# PublishabilityDetector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable PublishabilityDetector service that determines
which workspace packages are publishable and where they publish to.

**Architecture:** Enrich PackageJsonSchema and WorkspacePackage to carry
publishConfig data, add a PublishTarget schema, a PublishabilityDetector
service interface, and a default layer implementing standard npm semantics.
The default layer is pure (no FileSystem dependency).

**Tech Stack:** Effect-TS (Schema.Class, Context.Tag, Layer.effect,
Effect.withSpan, Effect.logDebug)

**Spec:** `docs/superpowers/specs/2026-03-13-publishability-detector-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/schemas/core.ts` | Modify | Add PublishConfigSchema to PackageJsonSchema, add publishConfig to WorkspacePackage |
| `src/schemas/publish.ts` | Create | PublishTarget Schema.Class |
| `src/services/PublishabilityDetector.ts` | Create | Service interface (Context.Tag) |
| `src/layers/PublishabilityDetectorLive.ts` | Create | Default layer with npm semantics + observability |
| `src/layers/PublishabilityDetectorLive.test.ts` | Create | Unit tests for default layer |
| `src/layers/WorkspaceDiscoveryLive.ts` | Modify | Pass publishConfig through in readWorkspacePackage |
| `src/index.ts` | Modify | Export new schemas, service, layer |

---

## Chunk 1: Schema and Service Foundation

### Task 1: Add PublishConfigSchema to PackageJsonSchema

**Files:**

- Modify: `src/schemas/core.ts:30-39`

- [ ] **Step 1: Add PublishConfigSchema and update PackageJsonSchema**

In `src/schemas/core.ts`, add above `PackageJsonSchema`:

```typescript
/** publishConfig field from package.json. */
export const PublishConfigSchema = Schema.Struct({
 access: Schema.optional(Schema.Literal("public", "restricted")),
 registry: Schema.optional(Schema.String),
 directory: Schema.optional(Schema.String),
});

export type PublishConfigType = Schema.Schema.Type<typeof PublishConfigSchema>;
```

Then add to `PackageJsonSchema` after the `packageManager` field:

```typescript
publishConfig: Schema.optional(PublishConfigSchema),
```

- [ ] **Step 2: Add publishConfig to WorkspacePackage**

In `src/schemas/core.ts`, add to the `WorkspacePackage` class fields
after `devDependencies`:

```typescript
publishConfig: Schema.optional(PublishConfigSchema),
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. Existing tests still pass because `publishConfig` is
optional with no default — existing `WorkspacePackage` constructors
remain valid without it.

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: All 154 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/core.ts
git commit -m "feat: add PublishConfigSchema to PackageJsonSchema and WorkspacePackage"
```

---

### Task 2: Create PublishTarget schema

**Files:**

- Create: `src/schemas/publish.ts`

- [ ] **Step 1: Create the PublishTarget Schema.Class**

Create `src/schemas/publish.ts`:

```typescript
/**
 * Schema for package publish targets.
 */

import { Schema } from "effect";

/** A single publish target for a workspace package. */
export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
 name: Schema.NonEmptyString,
 registry: Schema.NonEmptyString,
 directory: Schema.String,
 access: Schema.Literal("public", "restricted"),
 provenance: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/publish.ts
git commit -m "feat: add PublishTarget schema"
```

---

### Task 3: Create PublishabilityDetector service interface

**Files:**

- Create: `src/services/PublishabilityDetector.ts`

- [ ] **Step 1: Create the service interface**

Create `src/services/PublishabilityDetector.ts`:

```typescript
/**
 * PublishabilityDetector service — determines which packages are
 * publishable and where they publish to.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";
import type { PublishTarget } from "../schemas/publish.js";

export class PublishabilityDetector extends Context.Tag(
 "@spencerbeggs/workspaces-effect/PublishabilityDetector",
)<
 PublishabilityDetector,
 {
  readonly detect: (
   pkg: WorkspacePackage,
   root: string,
  ) => Effect.Effect<ReadonlyArray<PublishTarget>>;
 }
>() {}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/PublishabilityDetector.ts
git commit -m "feat: add PublishabilityDetector service interface"
```

---

### Task 4: Update WorkspaceDiscoveryLive to pass through publishConfig

**Files:**

- Modify: `src/layers/WorkspaceDiscoveryLive.ts:236-244`

- [ ] **Step 1: Update readWorkspacePackage**

In `src/layers/WorkspaceDiscoveryLive.ts`, in the `readWorkspacePackage`
function, update the `WorkspacePackage` constructor call (around line
236-244) to include `publishConfig`:

```typescript
return new WorkspacePackage({
 name,
 version: decoded.version ?? "0.0.0",
 path: pkgDir,
 relativePath,
 private: decoded.private ?? false,
 dependencies: (decoded.dependencies as Record<string, string>) ?? {},
 devDependencies: (decoded.devDependencies as Record<string, string>) ?? {},
 publishConfig: decoded.publishConfig,
});
```

The only change is the addition of the `publishConfig` line.

- [ ] **Step 2: Run tests**

Run: `pnpm run test`
Expected: All 154 tests pass. The test fixtures don't have publishConfig,
so it will be `undefined` (the optional default).

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/layers/WorkspaceDiscoveryLive.ts
git commit -m "feat: pass publishConfig through WorkspaceDiscoveryLive"
```

---

## Chunk 2: Default Layer Implementation (TDD)

### Task 5: Write failing tests for PublishabilityDetectorLive

**Files:**

- Create: `src/layers/PublishabilityDetectorLive.test.ts`

- [ ] **Step 1: Write the full test file**

Create `src/layers/PublishabilityDetectorLive.test.ts`:

```typescript
/**
 * Tests for PublishabilityDetectorLive layer.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../schemas/core.js";
import { PublishTarget } from "../schemas/publish.js";
import { PublishabilityDetector } from "../services/PublishabilityDetector.js";
import { PublishabilityDetectorLive } from "./PublishabilityDetectorLive.js";

/** Helper to create a WorkspacePackage with optional publishConfig. */
const pkg = (
 name: string,
 opts: {
  private?: boolean;
  publishConfig?: {
   access?: "public" | "restricted";
   registry?: string;
   directory?: string;
  };
 } = {},
): WorkspacePackage =>
 new WorkspacePackage({
  name,
  version: "1.0.0",
  path: `/workspace/packages/${name}`,
  relativePath: `packages/${name}`,
  private: opts.private ?? false,
  dependencies: {},
  devDependencies: {},
  publishConfig: opts.publishConfig,
 });

const ROOT = "/workspace";

const detect = (p: WorkspacePackage) =>
 Effect.gen(function* () {
  const detector = yield* PublishabilityDetector;
  return yield* detector.detect(p, ROOT);
 }).pipe(Effect.provide(PublishabilityDetectorLive));

describe("PublishabilityDetectorLive", () => {
 it("returns empty array for private package without publishConfig", async () => {
  const result = await Effect.runPromise(detect(pkg("private-pkg", { private: true })));
  expect(result).toEqual([]);
 });

 it("returns target when private but publishConfig.access is set", async () => {
  const result = await Effect.runPromise(
   detect(pkg("private-but-published", { private: true, publishConfig: { access: "public" } })),
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toBeInstanceOf(PublishTarget);
  expect(result[0].name).toBe("private-but-published");
  expect(result[0].access).toBe("public");
  expect(result[0].registry).toBe("https://registry.npmjs.org/");
  expect(result[0].directory).toBe(".");
  expect(result[0].provenance).toBe(false);
 });

 it("returns target with defaults for non-private package without publishConfig", async () => {
  const result = await Effect.runPromise(detect(pkg("public-pkg")));
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("public-pkg");
  expect(result[0].registry).toBe("https://registry.npmjs.org/");
  expect(result[0].directory).toBe(".");
  expect(result[0].access).toBe("public");
 });

 it("returns target with full publishConfig values", async () => {
  const result = await Effect.runPromise(
   detect(
    pkg("scoped-pkg", {
     publishConfig: {
      access: "restricted",
      registry: "https://npm.pkg.github.com/",
      directory: "dist/npm",
     },
    }),
   ),
  );
  expect(result).toHaveLength(1);
  expect(result[0].access).toBe("restricted");
  expect(result[0].registry).toBe("https://npm.pkg.github.com/");
  expect(result[0].directory).toBe("dist/npm");
 });

 it("returns target with defaults for undefined private field", async () => {
  // WorkspacePackage defaults private to false
  const result = await Effect.runPromise(detect(pkg("no-private-field")));
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("no-private-field");
 });

 it("returns target with custom registry only", async () => {
  const result = await Effect.runPromise(
   detect(pkg("custom-registry", { publishConfig: { registry: "https://custom.registry.dev/" } })),
  );
  expect(result).toHaveLength(1);
  expect(result[0].registry).toBe("https://custom.registry.dev/");
  expect(result[0].access).toBe("public");
  expect(result[0].directory).toBe(".");
 });

 it("returns target with custom directory only", async () => {
  const result = await Effect.runPromise(
   detect(pkg("custom-dir", { publishConfig: { directory: "dist/npm" } })),
  );
  expect(result).toHaveLength(1);
  expect(result[0].directory).toBe("dist/npm");
  expect(result[0].registry).toBe("https://registry.npmjs.org/");
 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — cannot import `PublishabilityDetectorLive` (file
doesn't exist yet). The 7 new tests should all fail.

---

### Task 6: Implement PublishabilityDetectorLive

**Files:**

- Create: `src/layers/PublishabilityDetectorLive.ts`

- [ ] **Step 1: Create the default layer implementation**

Create `src/layers/PublishabilityDetectorLive.ts`:

```typescript
/**
 * Default live implementation of PublishabilityDetector service.
 *
 * Implements standard npm publishing semantics:
 * - private + no publishConfig.access → not publishable
 * - publishConfig.access set → publishable (overrides private)
 * - not private → publishable with defaults
 *
 * This layer is pure — no FileSystem or other dependencies.
 * Custom layers can override by providing their own Layer for
 * PublishabilityDetector.
 */

import { Effect, Layer } from "effect";
import { PublishTarget } from "../schemas/publish.js";
import { PublishabilityDetector } from "../services/PublishabilityDetector.js";

export const PublishabilityDetectorLive = Layer.succeed(
 PublishabilityDetector,
 {
  detect: (pkg, _root) =>
   Effect.gen(function* () {
    const publishConfig = pkg.publishConfig;

    // Private with no publishConfig.access → not publishable
    if (pkg.private && !publishConfig?.access) {
     yield* Effect.logDebug("Publishability resolved").pipe(
      Effect.annotateLogs({
       "workspace.package": pkg.name,
       "workspace.publishable": false,
       "workspace.targets.count": 0,
      }),
     );
     return [] as ReadonlyArray<PublishTarget>;
    }

    // Publishable — build single target from publishConfig
    const target = new PublishTarget({
     name: pkg.name,
     registry: publishConfig?.registry ?? "https://registry.npmjs.org/",
     directory: publishConfig?.directory ?? ".",
     access: publishConfig?.access ?? "public",
     provenance: false,
    });

    const targets = [target] as ReadonlyArray<PublishTarget>;

    yield* Effect.logDebug("Publishability resolved").pipe(
     Effect.annotateLogs({
      "workspace.package": pkg.name,
      "workspace.publishable": true,
      "workspace.targets.count": targets.length,
     }),
    );

    return targets;
   }).pipe(
    Effect.withSpan("PublishabilityDetector.detect", {
     attributes: { "workspace.package": pkg.name },
    }),
   ),
 },
);
```

Note: This uses `Layer.succeed` (not `Layer.effect`) because the layer
has no dependencies and no construction-time effects. The `detect` method
itself returns an Effect for the span and logging.

- [ ] **Step 2: Run tests**

Run: `pnpm run test`
Expected: All tests pass (154 existing + 7 new = 161 total).

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/layers/PublishabilityDetectorLive.ts src/layers/PublishabilityDetectorLive.test.ts
git commit -m "feat: add PublishabilityDetectorLive with default npm semantics"
```

---

## Chunk 3: Exports and Verification

### Task 7: Update index.ts exports

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add exports for new schemas, service, and layer**

In `src/index.ts`, add the following exports in the appropriate sections:

In the Schemas section (after the lockfile exports):

```typescript
export { PublishTarget } from "./schemas/publish.js";
```

In the Layers section (alphabetically):

```typescript
export { PublishabilityDetectorLive } from "./layers/PublishabilityDetectorLive.js";
```

In the Services section:

```typescript
export { PublishabilityDetector } from "./services/PublishabilityDetector.js";
```

Also add `PublishConfigSchema` and `PublishConfigType` to the core
exports. Update the existing schemas export block:

```typescript
export {
 PackageJsonSchema,
 PackageManager,
 PackageName,
 PublishConfigSchema,
 WorkspaceInfo,
 WorkspacePackage,
 WorkspacePath,
} from "./schemas/core.js";
```

And add to the types export block:

```typescript
export type {
 PackageJsonType,
 PackageManagerType,
 PackageNameType,
 PublishConfigType,
 WorkspacePathType,
} from "./schemas/core.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run tests**

Run: `pnpm run test`
Expected: All 161 tests pass (including the re-export tests in
`src/index.test.ts` which verify exports).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export PublishabilityDetector service, layer, and schemas"
```

---

### Task 8: Full verification pass

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: 161 tests passing (154 existing + 7 new).

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `pnpm run build`
Expected: Both dev and npm builds succeed.

- [ ] **Step 4: Run lint**

Run: `pnpm run lint:fix`
Expected: No errors.
