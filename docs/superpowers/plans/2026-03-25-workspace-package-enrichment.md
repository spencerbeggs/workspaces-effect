# WorkspacePackage Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `WorkspacePackage` with dependency query methods, getters, root package inclusion, and `importerMap()` on `WorkspaceDiscovery` to replace `workspace-tools` in `pnpm-config-dependency-action`.

**Architecture:** Add new schema fields (`peerDependencies`, `optionalDependencies`) and getters/methods to `WorkspacePackage` as a `Schema.Class`. Standalone `Function.dual()` functions in `src/utils/workspace-package.ts` provide pipeable APIs, wired as static methods in `src/index.ts`. `WorkspaceDiscoveryLive` is modified to include the root package and implement `importerMap()`.

**Tech Stack:** Effect (`Schema.Class`, `Function.dual`, `Option`), Vitest, minimatch (for glob matching)

**Spec:** `docs/superpowers/specs/2026-03-25-workspace-package-enrichment-design.md`

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `src/schemas/core.ts` | `WorkspacePackage` schema fields, getters, instance methods; `DependencyDiff` interface; `PackageJsonSchema` update |
| `src/utils/workspace-package.ts` | **New** — standalone `Function.dual()` functions + `readPackageJson` utility |
| `src/services/WorkspaceDiscovery.ts` | Add `importerMap()` to service interface |
| `src/layers/WorkspaceDiscoveryLive.ts` | Root package inclusion, wire new fields, implement `importerMap()` |
| `src/index.ts` | Export utils, wire static methods, export `DependencyDiff` |
| `src/schemas/core.test.ts` | **New** — unit tests for `WorkspacePackage` getters and instance methods |
| `src/utils/workspace-package.test.ts` | **New** — unit tests for standalone dual functions and `readPackageJson` |
| `src/layers/WorkspaceDiscoveryLive.test.ts` | Update for root inclusion, add `importerMap()` tests |

---

### Task 1: Add `peerDependencies` and `optionalDependencies` to schemas

**Files:**

- Modify: `src/schemas/core.ts:195-261`

- [ ] **Step 1: Add `optionalDependencies` to `PackageJsonSchema`**

In `src/schemas/core.ts`, add after the `peerDependencies` line (line 202):

```typescript
optionalDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
```

- [ ] **Step 2: Add `peerDependencies` and `optionalDependencies` to `WorkspacePackage`**

In the `WorkspacePackage` class definition, add after the `devDependencies` field (line 259):

```typescript
peerDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    default: () => ({}),
}),
optionalDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    default: () => ({}),
}),
```

- [ ] **Step 3: Run typecheck to verify schema changes compile**

Run: `pnpm run typecheck`
Expected: PASS (no new type errors from schema additions)

- [ ] **Step 4: Commit**

```bash
git add src/schemas/core.ts
git commit -m "feat: add peerDependencies and optionalDependencies to WorkspacePackage schema

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 2: Add getters to `WorkspacePackage`

**Files:**

- Modify: `src/schemas/core.ts:248-261`
- Create: `src/schemas/core.test.ts`

- [ ] **Step 1: Write failing tests for getters**

Create `src/schemas/core.test.ts`:

```typescript
import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "./core.js";

const rootPkg = new WorkspacePackage({
    name: "my-monorepo",
    version: "1.0.0",
    path: "/workspace",
    relativePath: ".",
});

const scopedPkg = new WorkspacePackage({
    name: "@scope/utils",
    version: "2.0.0",
    path: "/workspace/packages/utils",
    relativePath: "packages/utils",
    private: false,
    dependencies: { effect: "^3.0.0" },
    devDependencies: { vitest: "^3.0.0" },
    peerDependencies: { react: "^18.0.0" },
    optionalDependencies: { fsevents: "^2.3.0" },
});

const unscopedPkg = new WorkspacePackage({
    name: "my-lib",
    version: "1.0.0",
    path: "/workspace/packages/my-lib",
    relativePath: "packages/my-lib",
    private: true,
});

describe("WorkspacePackage getters", () => {
    it("isRootWorkspace returns true for root", () => {
        expect(rootPkg.isRootWorkspace).toBe(true);
        expect(scopedPkg.isRootWorkspace).toBe(false);
    });

    it("packageJsonPath appends package.json", () => {
        expect(rootPkg.packageJsonPath).toBe("/workspace/package.json");
        expect(scopedPkg.packageJsonPath).toBe("/workspace/packages/utils/package.json");
    });

    it("isPublic is inverse of private", () => {
        expect(scopedPkg.isPublic).toBe(true);
        expect(unscopedPkg.isPublic).toBe(false);
    });

    it("scope extracts @scope from scoped name", () => {
        expect(scopedPkg.scope).toEqual(Option.some("@scope"));
        expect(unscopedPkg.scope).toEqual(Option.none());
    });

    it("unscopedName strips scope prefix", () => {
        expect(scopedPkg.unscopedName).toBe("utils");
        expect(unscopedPkg.unscopedName).toBe("my-lib");
    });

    it("allDependencies merges all 4 dep types", () => {
        expect(scopedPkg.allDependencies).toEqual({
            effect: "^3.0.0",
            vitest: "^3.0.0",
            react: "^18.0.0",
            fsevents: "^2.3.0",
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: FAIL (getters not defined)

- [ ] **Step 3: Implement getters on `WorkspacePackage`**

Add inside the `WorkspacePackage` class body (after the closing `})` of the schema fields, before the final `{}`:

```typescript
export class WorkspacePackage extends Schema.Class<WorkspacePackage>("WorkspacePackage")({
    // ... existing fields ...
}) {
    get isRootWorkspace(): boolean {
        return this.relativePath === ".";
    }

    get packageJsonPath(): string {
        return `${this.path}/package.json`;
    }

    get isPublic(): boolean {
        return !this.private;
    }

    get scope(): Option.Option<string> {
        const match = this.name.match(/^(@[^/]+)\//);
        return match ? Option.some(match[1]) : Option.none();
    }

    get unscopedName(): string {
        const slashIndex = this.name.indexOf("/");
        return this.name.startsWith("@") && slashIndex !== -1
            ? this.name.slice(slashIndex + 1)
            : this.name;
    }

    get allDependencies(): Record<string, string> {
        return {
            ...this.dependencies,
            ...this.devDependencies,
            ...this.peerDependencies,
            ...this.optionalDependencies,
        };
    }
}
```

Add `import { Option } from "effect";` at the top of `core.ts` (extend the existing `import { Schema } from "effect";`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas/core.ts src/schemas/core.test.ts
git commit -m "feat: add getters to WorkspacePackage (isRootWorkspace, packageJsonPath, scope, etc.)

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 3: Add instance methods to `WorkspacePackage`

**Files:**

- Modify: `src/schemas/core.ts`
- Modify: `src/schemas/core.test.ts`

- [ ] **Step 1: Write failing tests for instance methods**

Append to `src/schemas/core.test.ts`:

```typescript
describe("WorkspacePackage instance methods", () => {
    it("hasDependency checks dependencies only", () => {
        expect(scopedPkg.hasDependency("effect")).toBe(true);
        expect(scopedPkg.hasDependency("vitest")).toBe(false);
    });

    it("hasDevDependency checks devDependencies only", () => {
        expect(scopedPkg.hasDevDependency("vitest")).toBe(true);
        expect(scopedPkg.hasDevDependency("effect")).toBe(false);
    });

    it("hasPeerDependency checks peerDependencies only", () => {
        expect(scopedPkg.hasPeerDependency("react")).toBe(true);
        expect(scopedPkg.hasPeerDependency("effect")).toBe(false);
    });

    it("hasOptionalDependency checks optionalDependencies only", () => {
        expect(scopedPkg.hasOptionalDependency("fsevents")).toBe(true);
        expect(scopedPkg.hasOptionalDependency("effect")).toBe(false);
    });

    it("hasAnyDependencyOn checks all 4 dep types", () => {
        expect(scopedPkg.hasAnyDependencyOn("effect")).toBe(true);
        expect(scopedPkg.hasAnyDependencyOn("vitest")).toBe(true);
        expect(scopedPkg.hasAnyDependencyOn("react")).toBe(true);
        expect(scopedPkg.hasAnyDependencyOn("fsevents")).toBe(true);
        expect(scopedPkg.hasAnyDependencyOn("nonexistent")).toBe(false);
    });

    it("dependencyVersion returns version from any dep type", () => {
        expect(scopedPkg.dependencyVersion("effect")).toEqual(Option.some("^3.0.0"));
        expect(scopedPkg.dependencyVersion("react")).toEqual(Option.some("^18.0.0"));
        expect(scopedPkg.dependencyVersion("nonexistent")).toEqual(Option.none());
    });

    it("matchesDependency matches glob patterns against dep names", () => {
        expect(scopedPkg.matchesDependency("effect")).toBe(true);
        expect(scopedPkg.matchesDependency("*test*")).toBe(true);  // matches "vitest"
        expect(scopedPkg.matchesDependency("@scope/*")).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: FAIL (methods not defined)

- [ ] **Step 3: Install minimatch**

Run: `pnpm add minimatch`

Check if `@types/minimatch` is needed or if minimatch ships its own types.

- [ ] **Step 4: Implement instance methods on `WorkspacePackage`**

Add inside the `WorkspacePackage` class body, after the getters:

```typescript
hasDependency(name: string): boolean {
    return name in this.dependencies;
}

hasDevDependency(name: string): boolean {
    return name in this.devDependencies;
}

hasPeerDependency(name: string): boolean {
    return name in this.peerDependencies;
}

hasOptionalDependency(name: string): boolean {
    return name in this.optionalDependencies;
}

hasAnyDependencyOn(name: string): boolean {
    return this.hasDependency(name)
        || this.hasDevDependency(name)
        || this.hasPeerDependency(name)
        || this.hasOptionalDependency(name);
}

dependencyVersion(name: string): Option.Option<string> {
    const version = this.dependencies[name]
        ?? this.devDependencies[name]
        ?? this.peerDependencies[name]
        ?? this.optionalDependencies[name];
    return version !== undefined ? Option.some(version) : Option.none();
}

matchesDependency(pattern: string): boolean {
    return Object.keys(this.allDependencies).some((name) => minimatch(name, pattern));
}
```

Add `import { minimatch } from "minimatch";` at the top of `core.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/schemas/core.ts src/schemas/core.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add dependency query instance methods to WorkspacePackage

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 4: Add `DependencyDiff` and `dependencyDiff` method

**Files:**

- Modify: `src/schemas/core.ts`
- Modify: `src/schemas/core.test.ts`

- [ ] **Step 1: Write failing tests for dependencyDiff**

Append to `src/schemas/core.test.ts`:

```typescript
describe("WorkspacePackage.dependencyDiff", () => {
    it("detects added dependencies", () => {
        const before = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "1.0.0" },
        });
        const after = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "1.0.0", b: "2.0.0" },
        });
        const diff = after.dependencyDiff(before);
        expect(diff.added).toEqual({ b: "2.0.0" });
        expect(diff.removed).toEqual({});
        expect(diff.changed).toEqual({});
    });

    it("detects removed dependencies", () => {
        const before = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "1.0.0", b: "2.0.0" },
        });
        const after = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "1.0.0" },
        });
        const diff = after.dependencyDiff(before);
        expect(diff.added).toEqual({});
        expect(diff.removed).toEqual({ b: "2.0.0" });
        expect(diff.changed).toEqual({});
    });

    it("detects changed versions", () => {
        const before = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "1.0.0" },
        });
        const after = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            dependencies: { a: "2.0.0" },
        });
        const diff = after.dependencyDiff(before);
        expect(diff.added).toEqual({});
        expect(diff.removed).toEqual({});
        expect(diff.changed).toEqual({ a: { from: "1.0.0", to: "2.0.0" } });
    });

    it("compares across all dep types", () => {
        const before = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            peerDependencies: { react: "^17.0.0" },
        });
        const after = new WorkspacePackage({
            name: "pkg",
            version: "1.0.0",
            path: "/workspace/pkg",
            relativePath: "pkg",
            peerDependencies: { react: "^18.0.0" },
        });
        const diff = after.dependencyDiff(before);
        expect(diff.changed).toEqual({ react: { from: "^17.0.0", to: "^18.0.0" } });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: FAIL (dependencyDiff not defined)

- [ ] **Step 3: Implement `DependencyDiff` interface and `dependencyDiff` method**

Add the `DependencyDiff` interface in `src/schemas/core.ts` before the `WorkspacePackage` class:

```typescript
/**
 * Result of comparing two WorkspacePackage dependency snapshots.
 *
 * @public
 */
export interface DependencyDiff {
    readonly added: Record<string, string>;
    readonly removed: Record<string, string>;
    readonly changed: Record<string, { readonly from: string; readonly to: string }>;
}
```

Add the instance method to `WorkspacePackage`:

```typescript
dependencyDiff(other: WorkspacePackage): DependencyDiff {
    const selfDeps = this.allDependencies;
    const otherDeps = other.allDependencies;
    const added: Record<string, string> = {};
    const removed: Record<string, string> = {};
    const changed: Record<string, { from: string; to: string }> = {};

    for (const [name, version] of Object.entries(selfDeps)) {
        if (!(name in otherDeps)) {
            added[name] = version;
        } else if (otherDeps[name] !== version) {
            changed[name] = { from: otherDeps[name], to: version };
        }
    }
    for (const [name, version] of Object.entries(otherDeps)) {
        if (!(name in selfDeps)) {
            removed[name] = version;
        }
    }

    return { added, removed, changed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/schemas/core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas/core.ts src/schemas/core.test.ts
git commit -m "feat: add DependencyDiff and dependencyDiff method to WorkspacePackage

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 5: Create standalone `Function.dual()` functions

**Files:**

- Create: `src/utils/workspace-package.ts`
- Create: `src/utils/workspace-package.test.ts`

- [ ] **Step 1: Write failing tests for standalone dual functions**

Create `src/utils/workspace-package.test.ts`:

```typescript
import { FileSystem, Path } from "@effect/platform";
import { Effect, Option, pipe } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../schemas/core.js";
import {
    dependencyDiff,
    dependencyVersion,
    hasAnyDependencyOn,
    hasDependency,
    hasDevDependency,
    hasOptionalDependency,
    hasPeerDependency,
    matchesDependency,
    readPackageJson,
} from "./workspace-package.js";

const pkg = new WorkspacePackage({
    name: "@scope/utils",
    version: "1.0.0",
    path: "/workspace/packages/utils",
    relativePath: "packages/utils",
    dependencies: { effect: "^3.0.0" },
    devDependencies: { vitest: "^3.0.0" },
    peerDependencies: { react: "^18.0.0" },
    optionalDependencies: { fsevents: "^2.3.0" },
});

describe("standalone dual functions", () => {
    describe("data-first calling style", () => {
        it("hasDependency", () => {
            expect(hasDependency(pkg, "effect")).toBe(true);
            expect(hasDependency(pkg, "vitest")).toBe(false);
        });

        it("hasDevDependency", () => {
            expect(hasDevDependency(pkg, "vitest")).toBe(true);
        });

        it("hasPeerDependency", () => {
            expect(hasPeerDependency(pkg, "react")).toBe(true);
        });

        it("hasOptionalDependency", () => {
            expect(hasOptionalDependency(pkg, "fsevents")).toBe(true);
        });

        it("hasAnyDependencyOn", () => {
            expect(hasAnyDependencyOn(pkg, "effect")).toBe(true);
            expect(hasAnyDependencyOn(pkg, "nonexistent")).toBe(false);
        });

        it("dependencyVersion", () => {
            expect(dependencyVersion(pkg, "effect")).toEqual(Option.some("^3.0.0"));
            expect(dependencyVersion(pkg, "nonexistent")).toEqual(Option.none());
        });

        it("matchesDependency", () => {
            expect(matchesDependency(pkg, "*test*")).toBe(true);
        });
    });

    describe("data-last (pipeable) calling style", () => {
        it("hasDependency", () => {
            expect(pipe(pkg, hasDependency("effect"))).toBe(true);
        });

        it("dependencyVersion", () => {
            expect(pipe(pkg, dependencyVersion("effect"))).toEqual(Option.some("^3.0.0"));
        });

        it("matchesDependency", () => {
            expect(pipe(pkg, matchesDependency("*test*"))).toBe(true);
        });
    });

    describe("dependencyDiff standalone", () => {
        it("data-first", () => {
            const before = new WorkspacePackage({
                name: "pkg",
                version: "1.0.0",
                path: "/workspace/pkg",
                relativePath: "pkg",
                dependencies: { a: "1.0.0" },
            });
            const after = new WorkspacePackage({
                name: "pkg",
                version: "1.0.0",
                path: "/workspace/pkg",
                relativePath: "pkg",
                dependencies: { a: "2.0.0", b: "1.0.0" },
            });
            const diff = dependencyDiff(after, before);
            expect(diff.added).toEqual({ b: "1.0.0" });
            expect(diff.changed).toEqual({ a: { from: "1.0.0", to: "2.0.0" } });
        });

        it("data-last (pipeable)", () => {
            const before = new WorkspacePackage({
                name: "pkg",
                version: "1.0.0",
                path: "/workspace/pkg",
                relativePath: "pkg",
                dependencies: { a: "1.0.0" },
            });
            const after = new WorkspacePackage({
                name: "pkg",
                version: "1.0.0",
                path: "/workspace/pkg",
                relativePath: "pkg",
                dependencies: { b: "1.0.0" },
            });
            const diff = pipe(after, dependencyDiff(before));
            expect(diff.added).toEqual({ b: "1.0.0" });
            expect(diff.removed).toEqual({ a: "1.0.0" });
        });
    });
});

describe("readPackageJson", () => {
    it("reads and parses a package.json from the filesystem", async () => {
        const testPkg = new WorkspacePackage({
            name: "test-pkg",
            version: "1.0.0",
            path: "/workspace/packages/test",
            relativePath: "packages/test",
        });

        const mockFsLayer = FileSystem.layerNoop({
            readFileString: (path) => {
                if (path === "/workspace/packages/test/package.json") {
                    return Effect.succeed(
                        JSON.stringify({
                            name: "test-pkg",
                            version: "1.0.0",
                            dependencies: { effect: "^3.0.0" },
                        }),
                    );
                }
                return Effect.die(new Error(`ENOENT: ${path}`));
            },
        });

        const result = await Effect.runPromise(
            readPackageJson(testPkg).pipe(Effect.provide(mockFsLayer)),
        );

        expect(result.name).toBe("test-pkg");
        expect(result.dependencies).toEqual({ effect: "^3.0.0" });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/utils/workspace-package.test.ts`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement standalone dual functions**

Create `src/utils/workspace-package.ts`:

```typescript
/**
 * Standalone dual-API functions for WorkspacePackage.
 *
 * Each function supports both data-first and data-last (pipeable) calling styles
 * via `Function.dual()`.
 *
 * @packageDocumentation
 */

import { FileSystem } from "@effect/platform";
import { Effect, Function as Fn, Option, Schema } from "effect";
import { minimatch } from "minimatch";
import { PackageJsonParseError } from "../errors/PackageJsonParseError.js";
import { type DependencyDiff, PackageJsonSchema, WorkspacePackage } from "../schemas/core.js";

/** Check if a package has a production dependency. Dual API. */
export const hasDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasDependency(name));

/** Check if a package has a dev dependency. Dual API. */
export const hasDevDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasDevDependency(name));

/** Check if a package has a peer dependency. Dual API. */
export const hasPeerDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasPeerDependency(name));

/** Check if a package has an optional dependency. Dual API. */
export const hasOptionalDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasOptionalDependency(name));

/** Check if a package depends on a name in any dep type. Dual API. */
export const hasAnyDependencyOn: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, name: string): boolean => self.hasAnyDependencyOn(name));

/** Look up version across all dep types. Dual API. */
export const dependencyVersion: {
    (name: string): (self: WorkspacePackage) => Option.Option<string>;
    (self: WorkspacePackage, name: string): Option.Option<string>;
} = Fn.dual(2, (self: WorkspacePackage, name: string): Option.Option<string> => self.dependencyVersion(name));

/** Check if any dep name matches a glob pattern. Dual API. */
export const matchesDependency: {
    (pattern: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, pattern: string): boolean;
} = Fn.dual(2, (self: WorkspacePackage, pattern: string): boolean => self.matchesDependency(pattern));

/** Compare two WorkspacePackage dependency snapshots. Dual API. */
export const dependencyDiff: {
    (other: WorkspacePackage): (self: WorkspacePackage) => DependencyDiff;
    (self: WorkspacePackage, other: WorkspacePackage): DependencyDiff;
} = Fn.dual(2, (self: WorkspacePackage, other: WorkspacePackage): DependencyDiff => self.dependencyDiff(other));

/**
 * Read and parse a package's package.json from disk.
 *
 * Returns the minimal `PackageJsonType` schema fields. For full raw
 * package.json access, read `pkg.packageJsonPath` directly.
 *
 * Not a dual function — takes a single `WorkspacePackage` argument.
 * Pipeable via `pipe(pkg, readPackageJson)`.
 */
export const readPackageJson = (
    self: WorkspacePackage,
): Effect.Effect<Schema.Schema.Type<typeof PackageJsonSchema>, PackageJsonParseError, FileSystem.FileSystem> =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const content = yield* fs.readFileString(self.packageJsonPath).pipe(
            Effect.mapError(
                () => new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "failed to read file" }),
            ),
        );
        const raw = yield* Effect.try({
            try: () => JSON.parse(content) as Record<string, unknown>,
            catch: () =>
                new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "invalid JSON" }),
        });
        return yield* Schema.decodeUnknown(PackageJsonSchema)(raw).pipe(
            Effect.mapError(
                () => new PackageJsonParseError({ filePath: self.packageJsonPath, cause: "schema decode failed" }),
            ),
        );
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/utils/workspace-package.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/workspace-package.ts src/utils/workspace-package.test.ts
git commit -m "feat: add standalone dual-API functions for WorkspacePackage

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 6: Wire static methods and update exports in `src/index.ts`

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add exports for new utils and DependencyDiff**

Add to the Schemas section of `src/index.ts`:

```typescript
export type { DependencyDiff } from "./schemas/core.js";
```

Add a new Utils section:

```typescript
// ── Utils ────────────────────────────────────────────────────────────
export {
    dependencyDiff,
    dependencyVersion,
    hasAnyDependencyOn,
    hasDependency,
    hasDevDependency,
    hasOptionalDependency,
    hasPeerDependency,
    matchesDependency,
    readPackageJson,
} from "./utils/workspace-package.js";
```

- [ ] **Step 2: Wire static methods at module load**

Add at the bottom of `src/index.ts`, following the semver-effect pattern:

```typescript
// ── Wire cross-cutting static methods (avoids circular imports) ─────────

import { WorkspacePackage as _WP } from "./schemas/core.js";
import {
    dependencyDiff as _dependencyDiff,
    dependencyVersion as _dependencyVersion,
    hasAnyDependencyOn as _hasAnyDependencyOn,
    hasDependency as _hasDependency,
    hasDevDependency as _hasDevDependency,
    hasOptionalDependency as _hasOptionalDependency,
    hasPeerDependency as _hasPeerDependency,
    matchesDependency as _matchesDependency,
    readPackageJson as _readPackageJson,
} from "./utils/workspace-package.js";

// WorkspacePackage statics
_WP.hasDependency = _hasDependency;
_WP.hasDevDependency = _hasDevDependency;
_WP.hasPeerDependency = _hasPeerDependency;
_WP.hasOptionalDependency = _hasOptionalDependency;
_WP.hasAnyDependencyOn = _hasAnyDependencyOn;
_WP.dependencyVersion = _dependencyVersion;
_WP.matchesDependency = _matchesDependency;
_WP.dependencyDiff = _dependencyDiff;
_WP.readPackageJson = _readPackageJson;
```

- [ ] **Step 3: Add static method type declarations to `WorkspacePackage` class**

In `src/schemas/core.ts`, add static declarations inside the `WorkspacePackage` class body (similar to how `SemVer` declares them in `src/schemas/SemVer.ts:46-62` of semver-effect):

```typescript
// ── Cross-cutting statics (wired in index.ts) ───────────────────────
// Use `declare` to avoid "not definitely assigned" errors —
// these are assigned at module load time in src/index.ts.
static declare hasDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
};
static declare hasDevDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
};
static declare hasPeerDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
};
static declare hasOptionalDependency: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
};
static declare hasAnyDependencyOn: {
    (name: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, name: string): boolean;
};
static declare dependencyVersion: {
    (name: string): (self: WorkspacePackage) => Option.Option<string>;
    (self: WorkspacePackage, name: string): Option.Option<string>;
};
static declare matchesDependency: {
    (pattern: string): (self: WorkspacePackage) => boolean;
    (self: WorkspacePackage, pattern: string): boolean;
};
static declare dependencyDiff: {
    (other: WorkspacePackage): (self: WorkspacePackage) => DependencyDiff;
    (self: WorkspacePackage, other: WorkspacePackage): DependencyDiff;
};
static declare readPackageJson: (
    self: WorkspacePackage,
) => Effect.Effect<PackageJsonType, PackageJsonParseError, FileSystem.FileSystem>;
```

This requires adding imports for `Effect` and `FileSystem` types at the top of `core.ts`:

```typescript
import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";
import type { PackageJsonParseError } from "../errors/PackageJsonParseError.js";
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `pnpm run test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/schemas/core.ts
git commit -m "feat: wire WorkspacePackage static methods and export utils

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 7: Include root package in `listPackages()` and wire new fields

**Files:**

- Modify: `src/layers/WorkspaceDiscoveryLive.ts:208-267,336-352`
- Modify: `src/layers/WorkspaceDiscoveryLive.test.ts`

- [ ] **Step 1: Write failing test for root package inclusion**

Add to `src/layers/WorkspaceDiscoveryLive.test.ts`, inside the `describe("listPackages")` block:

```typescript
it("includes root workspace package as first entry", async () => {
    const root = "/projects/monorepo";
    const layer = testLayer(
        root,
        {
            [`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
            [`${root}/package.json`]: JSON.stringify({
                name: "my-monorepo",
                version: "0.0.0",
                private: true,
                dependencies: { typescript: "^5.0.0" },
            }),
            [`${root}/packages/pkg-a/package.json`]: JSON.stringify({
                name: "@scope/pkg-a",
                version: "1.0.0",
            }),
        },
        {
            [`${root}/packages`]: ["pkg-a"],
        },
    );

    const result = await Effect.runPromise(
        Effect.gen(function* () {
            const discovery = yield* WorkspaceDiscovery;
            return yield* discovery.listPackages();
        }).pipe(Effect.provide(layer)),
    );

    expect(result).toHaveLength(2);
    // Root is first
    expect(result[0].name).toBe("my-monorepo");
    expect(result[0].relativePath).toBe(".");
    expect(result[0].path).toBe(root);
    expect(result[0].isRootWorkspace).toBe(true);
    expect(result[0].dependencies).toEqual({ typescript: "^5.0.0" });
    // Workspace package follows
    expect(result[1].name).toBe("@scope/pkg-a");
    expect(result[1].isRootWorkspace).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/layers/WorkspaceDiscoveryLive.test.ts`
Expected: FAIL (root package not included, length is 1)

- [ ] **Step 3: Wire `peerDependencies` and `optionalDependencies` in `readWorkspacePackage`**

In `src/layers/WorkspaceDiscoveryLive.ts`, update the `WorkspacePackage` constructor call in `readWorkspacePackage` (around line 257-266):

```typescript
return new WorkspacePackage({
    name,
    version: decoded.version ?? "0.0.0",
    path: pkgDir,
    relativePath,
    private: decoded.private ?? false,
    dependencies: (decoded.dependencies as Record<string, string>) ?? {},
    devDependencies: (decoded.devDependencies as Record<string, string>) ?? {},
    peerDependencies: (decoded.peerDependencies as Record<string, string>) ?? {},
    optionalDependencies: (decoded.optionalDependencies as Record<string, string>) ?? {},
    publishConfig: decoded.publishConfig,
});
```

- [ ] **Step 4: Add root package to `discoverPackages`**

In the `discoverPackages` function (around line 336-352), add root package construction before returning:

```typescript
const discoverPackages = (): Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError> =>
    Effect.gen(function* () {
        if (cachedPackages) return cachedPackages;

        const patterns = yield* readWorkspacePatterns(fs, path, resolvedRoot);
        const dirs = yield* resolvePatterns(fs, path, resolvedRoot, patterns);

        const workspacePackages = yield* Effect.forEach(
            dirs,
            (dir) => readWorkspacePackage(fs, path, resolvedRoot, dir),
            { concurrency: 10 },
        );

        // Read root package.json and prepend as first entry.
        // The root may not have a `name` field, so read it manually
        // with a fallback to the directory basename.
        const rootPkgJsonPath = path.join(resolvedRoot, "package.json");
        const rootContent = yield* fs.readFileString(rootPkgJsonPath).pipe(
            Effect.mapError(() =>
                new WorkspaceDiscoveryError({
                    root: resolvedRoot,
                    reason: `failed to read root ${rootPkgJsonPath}`,
                }),
            ),
        );
        const rootRaw = yield* Effect.try({
            try: () => JSON.parse(rootContent) as Record<string, unknown>,
            catch: () =>
                new WorkspaceDiscoveryError({
                    root: resolvedRoot,
                    reason: `invalid JSON in root ${rootPkgJsonPath}`,
                }),
        });
        const rootDecoded = yield* Schema.decodeUnknown(PackageJsonSchema)(rootRaw).pipe(
            Effect.mapError(() =>
                new WorkspaceDiscoveryError({
                    root: resolvedRoot,
                    reason: `failed to parse root ${rootPkgJsonPath}`,
                }),
            ),
        );

        const rootPkg = new WorkspacePackage({
            name: rootDecoded.name ?? path.basename(resolvedRoot),
            version: rootDecoded.version ?? "0.0.0",
            path: resolvedRoot,
            relativePath: ".",
            private: rootDecoded.private ?? false,
            dependencies: (rootDecoded.dependencies as Record<string, string>) ?? {},
            devDependencies: (rootDecoded.devDependencies as Record<string, string>) ?? {},
            peerDependencies: (rootDecoded.peerDependencies as Record<string, string>) ?? {},
            optionalDependencies: (rootDecoded.optionalDependencies as Record<string, string>) ?? {},
            publishConfig: rootDecoded.publishConfig,
        });

        const packages = [rootPkg, ...workspacePackages];
        cachedPackages = packages;
        yield* Effect.logInfo("Workspace packages discovered").pipe(
            Effect.annotateLogs("workspace.packages.count", packages.length),
        );
        return packages;
    }).pipe(Effect.withSpan("WorkspaceDiscovery.listPackages"));

- [ ] **Step 5: Update existing tests for new length expectations**

Existing tests that assert `toHaveLength(N)` need to be updated to `N+1` to account for the root package. Each test's mock filesystem needs a root `package.json` added. Review each test case and update accordingly.

For example, the first test "discovers packages from pnpm-workspace.yaml" currently expects length 2. With root included, add a root `package.json` to the mock and expect length 3.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/layers/WorkspaceDiscoveryLive.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/layers/WorkspaceDiscoveryLive.ts src/layers/WorkspaceDiscoveryLive.test.ts
git commit -m "feat: include root workspace package in listPackages() (breaking change)

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 8: Add `importerMap()` to `WorkspaceDiscovery`

**Files:**

- Modify: `src/services/WorkspaceDiscovery.ts`
- Modify: `src/layers/WorkspaceDiscoveryLive.ts`
- Modify: `src/layers/WorkspaceDiscoveryLive.test.ts`

- [ ] **Step 1: Write failing test for `importerMap()`**

Add to `src/layers/WorkspaceDiscoveryLive.test.ts`:

```typescript
describe("importerMap", () => {
    it("returns map keyed by relativePath", async () => {
        const root = "/projects/monorepo";
        const layer = testLayer(
            root,
            {
                [`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
                [`${root}/package.json`]: JSON.stringify({
                    name: "my-monorepo",
                    version: "0.0.0",
                }),
                [`${root}/packages/core/package.json`]: JSON.stringify({
                    name: "@scope/core",
                    version: "1.0.0",
                }),
                [`${root}/packages/utils/package.json`]: JSON.stringify({
                    name: "@scope/utils",
                    version: "1.0.0",
                }),
            },
            {
                [`${root}/packages`]: ["core", "utils"],
            },
        );

        const result = await Effect.runPromise(
            Effect.gen(function* () {
                const discovery = yield* WorkspaceDiscovery;
                return yield* discovery.importerMap();
            }).pipe(Effect.provide(layer)),
        );

        expect(result.size).toBe(3);
        expect(result.get(".")?.name).toBe("my-monorepo");
        expect(result.get("packages/core")?.name).toBe("@scope/core");
        expect(result.get("packages/utils")?.name).toBe("@scope/utils");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/layers/WorkspaceDiscoveryLive.test.ts`
Expected: FAIL (importerMap not defined on service)

- [ ] **Step 3: Add `importerMap()` to service interface**

In `src/services/WorkspaceDiscovery.ts`, add to the service shape:

```typescript
/**
 * Get a map of workspace-relative directory paths to packages.
 *
 * Useful for mapping lockfile importer keys to their workspace packages.
 * Built from `listPackages()` output and inherits its caching.
 *
 * @returns An Effect that succeeds with a ReadonlyMap keyed by relativePath.
 */
readonly importerMap: () => Effect.Effect<
    ReadonlyMap<string, WorkspacePackage>,
    WorkspaceDiscoveryError
>;
```

Add the `WorkspacePackage` import at the top of the file.

- [ ] **Step 4: Implement `importerMap()` in `WorkspaceDiscoveryLive`**

In `src/layers/WorkspaceDiscoveryLive.ts`, add to the returned service object (inside the `return { ... }` block, after `getPackage`):

```typescript
importerMap: () =>
    Effect.gen(function* () {
        const packages = yield* discoverPackages();
        return new Map(packages.map((p) => [p.relativePath, p])) as ReadonlyMap<string, WorkspacePackage>;
    }).pipe(Effect.withSpan("WorkspaceDiscovery.importerMap")),
```

- [ ] **Step 5: Update mock discovery in other test files**

Any test file that creates a mock `WorkspaceDiscovery` (e.g. `DependencyGraphLive.test.ts`) needs to add `importerMap` to the mock. Check all test files that mock `WorkspaceDiscovery`:

```typescript
const mockDiscovery = (packages: WorkspacePackage[]) =>
    Layer.succeed(WorkspaceDiscovery, {
        listPackages: () => Effect.succeed(packages),
        getPackage: (name: string) => { /* existing */ },
        importerMap: () => Effect.succeed(
            new Map(packages.map((p) => [p.relativePath, p])) as ReadonlyMap<string, WorkspacePackage>,
        ),
    });
```

Files that mock `WorkspaceDiscovery` and need `importerMap` added:
`DependencyGraphLive.test.ts`, `TopologicalSorterLive.test.ts`, `PackageResolverLive.test.ts`, `index.test.ts`.

Files that use the real `WorkspaceDiscoveryLive` with mock filesystems — these need root `package.json` fixtures with `name` fields added:
`WorkspacesLive.test.ts`, `integration.test.ts`.

- [ ] **Step 6: Run all tests**

Run: `pnpm run test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/WorkspaceDiscovery.ts src/layers/WorkspaceDiscoveryLive.ts src/layers/WorkspaceDiscoveryLive.test.ts src/layers/DependencyGraphLive.test.ts src/layers/TopologicalSorterLive.test.ts src/layers/PackageResolverLive.test.ts src/index.test.ts src/layers/WorkspacesLive.test.ts src/layers/integration.test.ts
git commit -m "feat: add importerMap() to WorkspaceDiscovery service

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 9: Final verification and lint

**Files:** All modified files

- [ ] **Step 1: Run full typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `pnpm run test`
Expected: All 174+ tests PASS (existing + new)

- [ ] **Step 3: Run linter and fix**

Run: `pnpm run lint:fix`
Expected: PASS or auto-fixed

- [ ] **Step 4: Run markdown lint**

Run: `pnpm run lint:md:fix`
Expected: PASS

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```
