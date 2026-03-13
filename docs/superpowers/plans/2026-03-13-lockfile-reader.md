# LockfileReader Implementation Plan

> **For agentic workers:** REQUIRED: Use
> superpowers:subagent-driven-development (if subagents available) or
> superpowers:executing-plans to implement this plan. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Add a `LockfileReader` service that reads, parses, and
validates lockfiles from all 4 supported package managers (pnpm, npm,
yarn Berry, bun).

**Architecture:** Eager parse at layer construction, cache the unified
`LockfileData` model, serve all queries from memory. Four PM-specific
parser modules (pure functions) plus a shared utility module. Integrity
checking via `semver-effect` in a separate module.

**Tech Stack:** Effect-TS, `yaml` (YAML parsing), `jsonc-effect` (JSONC
parsing for bun.lock), `semver-effect` (constraint satisfaction)

**Spec:** `docs/superpowers/specs/2026-03-13-lockfile-reader-design.md`

---

## Chunk 1: Foundation (errors, schemas, shared utilities)

### Task 1: Add dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install production dependencies**

```bash
pnpm add jsonc-effect@^0.1.0 semver-effect@^0.1.0 yaml@^2.8.0
```

- [ ] **Step 2: Verify installation**

```bash
pnpm ls jsonc-effect semver-effect yaml --depth=0
```

Expected: all three listed as direct dependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add jsonc-effect, semver-effect, yaml deps for Phase 4"
```

### Task 2: Error types

**Files:**

- Modify: `src/errors/index.ts`

- [ ] **Step 1: Add lockfile error types**

Append to the end of `src/errors/index.ts`, after the Change Detection
Errors section:

```typescript
// -- Lockfile Errors -----------------------------------------------

/** @internal */
export const LockfileReadErrorBase =
  Data.TaggedError("LockfileReadError");

/** Emitted when a lockfile cannot be read from disk. */
export class LockfileReadError extends LockfileReadErrorBase<{
  readonly lockfilePath: string;
  readonly reason: string;
}> {
  get message(): string {
    return `Failed to read lockfile at "${this.lockfilePath}": ${this.reason}`;
  }
}

/** @internal */
export const LockfileParseErrorBase =
  Data.TaggedError("LockfileParseError");

/** Emitted when a lockfile exists but cannot be parsed. */
export class LockfileParseError extends LockfileParseErrorBase<{
  readonly lockfilePath: string;
  readonly format: "pnpm" | "npm" | "yarn" | "bun";
  readonly cause: unknown;
}> {
  get message(): string {
    return `Failed to parse ${this.format} lockfile at "${this.lockfilePath}"`;
  }
}

/** @internal */
export const LockfileIntegrityErrorBase =
  Data.TaggedError("LockfileIntegrityError");

/** Emitted when integrity checking cannot complete. */
export class LockfileIntegrityError extends LockfileIntegrityErrorBase<{
  readonly reason: string;
  readonly cause: unknown;
}> {
  get message(): string {
    return `Integrity check failed: ${this.reason}`;
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/errors/index.ts
git commit -m "feat: add LockfileReadError, LockfileParseError, LockfileIntegrityError"
```

### Task 3: Lockfile schemas

**Files:**

- Create: `src/schemas/lockfile.ts`

- [ ] **Step 1: Create unified lockfile schemas**

Create `src/schemas/lockfile.ts` with these types. Import `Schema`
from `effect` and `PackageManager` from `./core.js`.

```typescript
import { Schema } from "effect";
import { PackageManager } from "./core.js";

// -- Dep type literal (reused in multiple schemas) --

const DepType = Schema.Literal(
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
);

// -- Unified data model --

export class ResolvedPackage extends Schema.Class<ResolvedPackage>(
  "ResolvedPackage",
)({
  name: Schema.NonEmptyString,
  version: Schema.String,
  integrity: Schema.optional(Schema.String),
  isWorkspace: Schema.Boolean,
  dependencies: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
    { default: () => ({}) },
  ),
}) {}

export class WorkspaceDependency
  extends Schema.Class<WorkspaceDependency>(
    "WorkspaceDependency",
  )({
    from: Schema.NonEmptyString,
    to: Schema.NonEmptyString,
    depType: DepType,
    constraint: Schema.String,
  }) {}

// -- PM-specific extensions (before LockfileData) --

export class PnpmExtension extends Schema.Class<PnpmExtension>(
  "PnpmExtension",
)({
  _tag: Schema.Literal("pnpm"),
  catalogs: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    }),
  ),
  overrides: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  settings: Schema.optional(
    Schema.Struct({
      autoInstallPeers: Schema.optional(Schema.Boolean),
      excludeLinksFromLockfile: Schema.optional(
        Schema.Boolean,
      ),
    }),
  ),
}) {}

export class BunExtension extends Schema.Class<BunExtension>(
  "BunExtension",
)({
  _tag: Schema.Literal("bun"),
  catalog: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
  catalogs: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({
        key: Schema.String,
        value: Schema.Unknown,
      }),
    }),
  ),
  overrides: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  trustedDependencies: Schema.optional(
    Schema.Array(Schema.String),
  ),
}) {}

// -- Unified lockfile data --

export class LockfileData extends Schema.Class<LockfileData>(
  "LockfileData",
)({
  packageManager: PackageManager,
  lockfileVersion: Schema.String,
  packages: Schema.Array(ResolvedPackage),
  workspaceDependencies: Schema.Array(WorkspaceDependency),
  pmSpecific: Schema.optional(
    Schema.Union(PnpmExtension, BunExtension),
  ),
}) {}

// -- Integrity result --

export class LockfileIntegrity
  extends Schema.Class<LockfileIntegrity>(
    "LockfileIntegrity",
  )({
    valid: Schema.Boolean,
    missingWorkspaces: Schema.Array(Schema.String),
    extraWorkspaces: Schema.Array(Schema.String),
    unsatisfiedConstraints: Schema.Array(
      Schema.Struct({
        workspace: Schema.String,
        dependency: Schema.String,
        constraint: Schema.String,
        resolved: Schema.String,
        depType: DepType,
      }),
    ),
  }) {}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/schemas/lockfile.ts
git commit -m "feat: add lockfile schemas (LockfileData, ResolvedPackage, etc.)"
```

### Task 4: Service interface

**Files:**

- Create: `src/services/LockfileReader.ts`

- [ ] **Step 1: Create service tag**

```typescript
/**
 * LockfileReader service -- reads and queries lockfile data.
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { LockfileIntegrityError } from "../errors/index.js";
import type {
  LockfileData,
  LockfileIntegrity,
  ResolvedPackage,
  WorkspaceDependency,
} from "../schemas/lockfile.js";

export class LockfileReader extends Context.Tag(
  "@spencerbeggs/workspaces-effect/LockfileReader",
)<
  LockfileReader,
  {
    readonly readLockfile: () => Effect.Effect<LockfileData>;
    readonly resolvedVersion: (
      packageName: string,
    ) => Effect.Effect<Option.Option<ResolvedPackage>>;
    readonly workspaceDependencies: () => Effect.Effect<
      ReadonlyArray<WorkspaceDependency>
    >;
    readonly checkIntegrity: () => Effect.Effect<
      LockfileIntegrity,
      LockfileIntegrityError
    >;
  }
>() {}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/services/LockfileReader.ts
git commit -m "feat: add LockfileReader service interface"
```

### Task 5: Shared parser utilities

**Files:**

- Create: `src/layers/parsers/shared.ts`

- [ ] **Step 1: Create shared utilities**

```typescript
import { WorkspaceDependency } from "../../schemas/lockfile.js";

const DEP_TYPES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DepType = (typeof DEP_TYPES)[number];

export interface WorkspaceEntry {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

/** True if the specifier is a workspace/link/file reference. */
export const isWorkspaceSpecifier = (
  specifier: string,
): boolean =>
  specifier.startsWith("workspace:") ||
  specifier.startsWith("link:") ||
  specifier.startsWith("file:");

/**
 * Extract inter-workspace dependencies from a map of
 * workspace entries.
 */
export const extractWorkspaceDeps = (
  workspaces: ReadonlyMap<string, WorkspaceEntry>,
  workspaceNames: ReadonlySet<string>,
): ReadonlyArray<WorkspaceDependency> => {
  const deps: WorkspaceDependency[] = [];
  for (const [from, entry] of workspaces) {
    for (const depType of DEP_TYPES) {
      const depMap = entry[depType];
      if (!depMap) continue;
      for (const [name, constraint] of Object.entries(depMap)) {
        if (workspaceNames.has(name)) {
          deps.push(
            new WorkspaceDependency({
              from,
              to: name,
              depType,
              constraint,
            }),
          );
        }
      }
    }
  }
  return deps;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/shared.ts
git commit -m "feat: add shared parser utilities (extractWorkspaceDeps, isWorkspaceSpecifier)"
```

---

## Chunk 2: pnpm parser

### Task 6: pnpm parser -- tests first

**Files:**

- Create: `src/layers/parsers/pnpm.test.ts`

- [ ] **Step 1: Write pnpm parser tests**

Use the existing fixture at `src/test-fixtures/lockfiles/pnpm-lock.yaml`
as reference. Write inline fixture strings for focused unit tests.

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parsePnpmLockfile } from "./pnpm.js";

const MINIMAL_PNPM_LOCK = `
lockfileVersion: "9.0"

importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3

  packages/core:
    dependencies:
      "@my-monorepo/utils":
        specifier: "workspace:*"
        version: link:../utils
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

  packages/utils:
    dependencies:
      chalk:
        specifier: ^5.0.0
        version: 5.3.0

packages:
  chalk@5.3.0:
    resolution:
      integrity: sha512-abc123
  lodash@4.17.21:
    resolution:
      integrity: sha512-def456
  typescript@5.3.3:
    resolution:
      integrity: sha512-ghi789
`;

describe("parsePnpmLockfile", () => {
  it("parses lockfile version", async () => {
    const result = await Effect.runPromise(
      parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"),
    );
    expect(result.packageManager).toBe("pnpm");
    expect(result.lockfileVersion).toBe("9.0");
  });

  it("extracts resolved packages", async () => {
    const result = await Effect.runPromise(
      parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"),
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain("chalk");
    expect(names).toContain("lodash");
    expect(names).toContain("typescript");
  });

  it("marks workspace packages", async () => {
    const result = await Effect.runPromise(
      parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"),
    );
    const workspaces = result.packages.filter(
      (p) => p.isWorkspace,
    );
    // Workspace importers (., packages/core, packages/utils)
    // are workspace entries but the resolved packages in
    // "packages:" are not workspaces
    const nonWorkspaces = result.packages.filter(
      (p) => !p.isWorkspace,
    );
    expect(nonWorkspaces.length).toBeGreaterThan(0);
  });

  it("extracts workspace dependencies", async () => {
    const result = await Effect.runPromise(
      parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"),
    );
    const wsDeps = result.workspaceDependencies;
    // packages/core depends on @my-monorepo/utils
    expect(wsDeps).toContainEqual(
      expect.objectContaining({
        from: expect.any(String),
        to: "@my-monorepo/utils",
        depType: "dependencies",
      }),
    );
  });

  it("fails with LockfileParseError on malformed YAML",
    async () => {
    const result = await Effect.runPromiseExit(
      parsePnpmLockfile("{{invalid yaml", "/bad/path"),
    );
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/layers/parsers/pnpm.test.ts
```

Expected: FAIL (module `./pnpm.js` not found).

- [ ] **Step 3: Commit failing tests**

```bash
git add src/layers/parsers/pnpm.test.ts
git commit -m "test: add pnpm parser tests (failing -- implementation next)"
```

### Task 7: pnpm parser -- implementation

**Files:**

- Create: `src/layers/parsers/pnpm.ts`

- [ ] **Step 1: Implement pnpm parser**

```typescript
import { Effect, Schema } from "effect";
import YAML from "yaml";
import { LockfileParseError } from "../../errors/index.js";
import {
  LockfileData,
  PnpmExtension,
  ResolvedPackage,
} from "../../schemas/lockfile.js";
import {
  type WorkspaceEntry,
  extractWorkspaceDeps,
} from "./shared.js";

// -- Raw schema (internal) --

const PnpmImporterDeps = Schema.optional(
  Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      specifier: Schema.String,
      version: Schema.String,
    }),
  }),
);

const PnpmImporter = Schema.Struct({
  dependencies: PnpmImporterDeps,
  devDependencies: PnpmImporterDeps,
  peerDependencies: PnpmImporterDeps,
  optionalDependencies: PnpmImporterDeps,
});

const PnpmLockfileRaw = Schema.Struct({
  lockfileVersion: Schema.Union(Schema.String, Schema.Number),
  settings: Schema.optional(
    Schema.Struct({
      autoInstallPeers: Schema.optional(Schema.Boolean),
      excludeLinksFromLockfile: Schema.optional(
        Schema.Boolean,
      ),
    }),
  ),
  overrides: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  catalogs: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    }),
  ),
  importers: Schema.Record({
    key: Schema.String,
    value: PnpmImporter,
  }),
  packages: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        resolution: Schema.optional(
          Schema.Struct({
            integrity: Schema.optional(Schema.String),
          }),
        ),
      }),
    }),
  ),
});

type PnpmLockfileRawType = Schema.Schema.Type<
  typeof PnpmLockfileRaw
>;

// -- Parser --

export const parsePnpmLockfile = (
  content: string,
  lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
  Effect.gen(function* () {
    // Step 1: YAML parse
    const raw = yield* Effect.try({
      try: () => YAML.parse(content) as unknown,
      catch: (e) =>
        new LockfileParseError({
          lockfilePath,
          format: "pnpm",
          cause: e,
        }),
    });

    // Step 2: Schema validation
    const validated = yield* Schema.decodeUnknown(
      PnpmLockfileRaw,
    )(raw).pipe(
      Effect.mapError(
        (e) =>
          new LockfileParseError({
            lockfilePath,
            format: "pnpm",
            cause: e,
          }),
      ),
    );

    // Step 3: Transform to unified model
    return toLockfileData(validated);
  });

// -- Transform --

const toLockfileData = (raw: PnpmLockfileRawType): LockfileData => {
  // Build workspace entries map for dep extraction
  const workspaceEntries = new Map<string, WorkspaceEntry>();
  const workspaceNames = new Set<string>();

  for (const [importerPath, importer] of Object.entries(
    raw.importers,
  )) {
    // Importer paths are relative (., packages/core, etc.)
    // Use the path as the "name" for now; the real name
    // comes from package.json (which we don't have here)
    const toVersionMap = (
      deps:
        | Record<
            string,
            { specifier: string; version: string }
          >
        | undefined,
    ): Record<string, string> | undefined => {
      if (!deps) return undefined;
      const result: Record<string, string> = {};
      for (const [name, info] of Object.entries(deps)) {
        result[name] = info.specifier;
      }
      return result;
    };

    workspaceEntries.set(importerPath, {
      dependencies: toVersionMap(importer.dependencies),
      devDependencies: toVersionMap(
        importer.devDependencies,
      ),
      peerDependencies: toVersionMap(
        importer.peerDependencies,
      ),
      optionalDependencies: toVersionMap(
        importer.optionalDependencies,
      ),
    });

    // Collect workspace package names from link: deps
    // to identify inter-workspace dependencies
    for (const deps of [
      importer.dependencies,
      importer.devDependencies,
      importer.peerDependencies,
      importer.optionalDependencies,
    ]) {
      if (!deps) continue;
      for (const [name, info] of Object.entries(deps)) {
        if (info.version.startsWith("link:")) {
          workspaceNames.add(name);
        }
      }
    }
  }

  // Also add importer paths as workspace names
  // (the root "." is the monorepo itself)
  for (const path of Object.keys(raw.importers)) {
    if (path !== ".") {
      workspaceNames.add(path);
    }
  }

  // Build resolved packages
  const packages: ResolvedPackage[] = [];

  // Add workspace packages from importers
  for (const [importerPath] of Object.entries(
    raw.importers,
  )) {
    if (importerPath === ".") continue;
    packages.push(
      new ResolvedPackage({
        name: importerPath,
        version: "0.0.0",
        isWorkspace: true,
      }),
    );
  }

  // Add resolved packages from packages section
  if (raw.packages) {
    for (const [key, pkg] of Object.entries(raw.packages)) {
      // pnpm key format: "name@version"
      const atIndex = key.lastIndexOf("@");
      if (atIndex <= 0) continue;
      const name = key.slice(0, atIndex);
      const version = key.slice(atIndex + 1);
      packages.push(
        new ResolvedPackage({
          name,
          version,
          integrity: pkg.resolution?.integrity,
          isWorkspace: false,
        }),
      );
    }
  }

  // Build workspace dependencies
  const wsDeps = extractWorkspaceDeps(
    workspaceEntries,
    workspaceNames,
  );

  // PM-specific extension
  const pmSpecific = new PnpmExtension({
    _tag: "pnpm",
    catalogs: raw.catalogs,
    overrides: raw.overrides,
    settings: raw.settings,
  });

  return new LockfileData({
    packageManager: "pnpm",
    lockfileVersion: String(raw.lockfileVersion),
    packages,
    workspaceDependencies: [...wsDeps],
    pmSpecific,
  });
};
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/pnpm.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/layers/parsers/pnpm.ts
git commit -m "feat: implement pnpm lockfile parser"
```

### Task 8: pnpm parser -- catalogs test

**Files:**

- Modify: `src/layers/parsers/pnpm.test.ts`

- [ ] **Step 1: Add catalog extraction test**

Append to the existing describe block. Use the fixture at
`src/test-fixtures/lockfiles/pnpm-lock.yaml` which has catalogs.

```typescript
it("extracts pnpm catalogs into pmSpecific", async () => {
  const content = `lockfileVersion: "9.0"
catalogs:
  default:
    lodash: ^4.17.21
    chalk: ^5.0.0
importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3
packages:
  typescript@5.3.3:
    resolution:
      integrity: sha512-abc
`;
  const result = await Effect.runPromise(
    parsePnpmLockfile(content, "/project/pnpm-lock.yaml"),
  );
  expect(result.pmSpecific).toBeDefined();
  expect(result.pmSpecific?._tag).toBe("pnpm");
  if (result.pmSpecific?._tag === "pnpm") {
    expect(result.pmSpecific.catalogs).toBeDefined();
    expect(
      result.pmSpecific.catalogs?.default?.lodash,
    ).toBe("^4.17.21");
  }
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/pnpm.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/pnpm.test.ts
git commit -m "test: add pnpm catalog extraction test"
```

---

## Chunk 3: npm parser

### Task 9: npm parser -- tests first

**Files:**

- Create: `src/layers/parsers/npm.test.ts`

- [ ] **Step 1: Write npm parser tests**

Reference `src/test-fixtures/lockfiles/package-lock.json` for
fixture structure. npm v3 uses flat `packages` map keyed by
`node_modules/` paths. Workspace packages have `"link": true`.

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseNpmLockfile } from "./npm.js";

const MINIMAL_NPM_LOCK = JSON.stringify({
  name: "my-monorepo",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "my-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
      devDependencies: { typescript: "^5.3.0" },
    },
    "packages/app": {
      name: "@my-monorepo/app",
      version: "1.0.0",
      dependencies: {
        "@my-monorepo/lib": "*",
        express: "^4.18.0",
      },
    },
    "packages/lib": {
      name: "@my-monorepo/lib",
      version: "1.0.0",
      dependencies: { zod: "^3.22.0" },
    },
    "node_modules/@my-monorepo/app": {
      resolved: "packages/app",
      link: true,
    },
    "node_modules/@my-monorepo/lib": {
      resolved: "packages/lib",
      link: true,
    },
    "node_modules/express": {
      version: "4.21.2",
      integrity: "sha512-abc",
    },
    "node_modules/zod": {
      version: "3.23.8",
      integrity: "sha512-def",
    },
    "node_modules/typescript": {
      version: "5.3.3",
      integrity: "sha512-ghi",
      dev: true,
    },
  },
});

describe("parseNpmLockfile", () => {
  it("parses lockfile version", async () => {
    const result = await Effect.runPromise(
      parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"),
    );
    expect(result.packageManager).toBe("npm");
    expect(result.lockfileVersion).toBe("3");
  });

  it("extracts resolved packages from node_modules", async () => {
    const result = await Effect.runPromise(
      parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"),
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain("express");
    expect(names).toContain("zod");
  });

  it("identifies workspace packages via link entries", async () => {
    const result = await Effect.runPromise(
      parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"),
    );
    const ws = result.packages.filter((p) => p.isWorkspace);
    const wsNames = ws.map((p) => p.name);
    expect(wsNames).toContain("@my-monorepo/app");
    expect(wsNames).toContain("@my-monorepo/lib");
  });

  it("extracts workspace dependencies", async () => {
    const result = await Effect.runPromise(
      parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"),
    );
    expect(result.workspaceDependencies).toContainEqual(
      expect.objectContaining({
        to: "@my-monorepo/lib",
        depType: "dependencies",
      }),
    );
  });

  it("fails with LockfileParseError on invalid JSON", async () => {
    const result = await Effect.runPromiseExit(
      parseNpmLockfile("{invalid", "/bad/path"),
    );
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/layers/parsers/npm.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/npm.test.ts
git commit -m "test: add npm parser tests (failing)"
```

### Task 10: npm parser -- implementation

**Files:**

- Create: `src/layers/parsers/npm.ts`

- [ ] **Step 1: Implement npm parser**

npm v3 package-lock.json has `packages` map. Keys:

- `""` = root
- `"packages/foo"` = workspace package (has `name`, `version`)
- `"node_modules/foo"` = resolved dep (has `version`, `integrity`)
- `"node_modules/foo"` with `link: true` = workspace link

```typescript
import { Effect, Schema } from "effect";
import { LockfileParseError } from "../../errors/index.js";
import {
  LockfileData,
  ResolvedPackage,
} from "../../schemas/lockfile.js";
import {
  type WorkspaceEntry,
  extractWorkspaceDeps,
} from "./shared.js";

// -- Raw schema (internal) --

const NpmPackageEntry = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.String),
  integrity: Schema.optional(Schema.String),
  link: Schema.optional(Schema.Boolean),
  dev: Schema.optional(Schema.Boolean),
  dependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  devDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  peerDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  optionalDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  workspaces: Schema.optional(Schema.Unknown),
  license: Schema.optional(Schema.String),
  bin: Schema.optional(Schema.Unknown),
  engines: Schema.optional(Schema.Unknown),
  funding: Schema.optional(Schema.Unknown),
});

const NpmLockfileRaw = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  lockfileVersion: Schema.Union(Schema.Number, Schema.String),
  requires: Schema.optional(Schema.Boolean),
  packages: Schema.Record({
    key: Schema.String,
    value: NpmPackageEntry,
  }),
});

type NpmLockfileRawType = Schema.Schema.Type<
  typeof NpmLockfileRaw
>;

// -- Parser --

export const parseNpmLockfile = (
  content: string,
  lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: (e) =>
        new LockfileParseError({
          lockfilePath,
          format: "npm",
          cause: e,
        }),
    });

    const validated = yield* Schema.decodeUnknown(
      NpmLockfileRaw,
    )(raw).pipe(
      Effect.mapError(
        (e) =>
          new LockfileParseError({
            lockfilePath,
            format: "npm",
            cause: e,
          }),
      ),
    );

    return toLockfileData(validated);
  });

const toLockfileData = (raw: NpmLockfileRawType): LockfileData => {
  const packages: ResolvedPackage[] = [];
  const workspaceNames = new Set<string>();
  const workspaceEntries = new Map<string, WorkspaceEntry>();

  // First pass: identify workspace link entries
  for (const [key, entry] of Object.entries(raw.packages)) {
    if (
      key.startsWith("node_modules/") &&
      entry.link === true
    ) {
      const name =
        entry.name ?? key.slice("node_modules/".length);
      workspaceNames.add(name);
    }
  }

  // Second pass: build packages and workspace entries
  for (const [key, entry] of Object.entries(raw.packages)) {
    if (key === "") continue; // skip root

    if (
      key.startsWith("node_modules/") &&
      entry.link === true
    ) {
      // Workspace link -- get the actual package data
      // from the workspace path entry
      const resolved = entry.resolved;
      const wsEntry = resolved
        ? raw.packages[resolved]
        : undefined;
      const name =
        wsEntry?.name ??
        entry.name ??
        key.slice("node_modules/".length);
      packages.push(
        new ResolvedPackage({
          name,
          version: wsEntry?.version ?? "0.0.0",
          isWorkspace: true,
        }),
      );
      if (wsEntry) {
        workspaceEntries.set(name, {
          dependencies: wsEntry.dependencies,
          devDependencies: wsEntry.devDependencies,
          peerDependencies: wsEntry.peerDependencies,
          optionalDependencies:
            wsEntry.optionalDependencies,
        });
      }
    } else if (key.startsWith("node_modules/")) {
      // Regular resolved package
      const name = key.slice("node_modules/".length);
      if (entry.version) {
        packages.push(
          new ResolvedPackage({
            name,
            version: entry.version,
            integrity: entry.integrity,
            isWorkspace: false,
            dependencies: entry.dependencies ?? {},
          }),
        );
      }
    }
    // Skip workspace path entries (packages/foo) --
    // they're handled via the link entries above
  }

  const wsDeps = extractWorkspaceDeps(
    workspaceEntries,
    workspaceNames,
  );

  return new LockfileData({
    packageManager: "npm",
    lockfileVersion: String(raw.lockfileVersion),
    packages,
    workspaceDependencies: [...wsDeps],
  });
};
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/npm.test.ts
```

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/layers/parsers/npm.ts
git commit -m "feat: implement npm lockfile parser"
```

---

## Chunk 4: yarn Berry parser

### Task 11: yarn parser -- tests first

**Files:**

- Create: `src/layers/parsers/yarn.test.ts`

- [ ] **Step 1: Write yarn parser tests**

Yarn Berry format: YAML document. Entries keyed by
`"name@resolution"`. Workspace entries have
`resolution: "name@workspace:path"` and `linkType: soft`.

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseYarnLockfile } from "./yarn.js";

const MINIMAL_YARN_LOCK = `\
__metadata:
  version: 8
  cacheKey: 10c0

"my-monorepo@workspace:.":
  version: 0.0.0-use.local
  resolution: "my-monorepo@workspace:."
  dependencies:
    "@my-monorepo/web": "workspace:*"
    "@my-monorepo/shared": "workspace:*"
  devDependencies:
    typescript: "npm:^5.3.0"
  languageName: unknown
  linkType: soft

"@my-monorepo/web@workspace:packages/web":
  version: 0.0.0-use.local
  resolution: "@my-monorepo/web@workspace:packages/web"
  dependencies:
    "@my-monorepo/shared": "workspace:*"
    react: "npm:^18.2.0"
  languageName: unknown
  linkType: soft

"@my-monorepo/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@my-monorepo/shared@workspace:packages/shared"
  dependencies:
    date-fns: "npm:^3.0.0"
  languageName: unknown
  linkType: soft

"react@npm:^18.2.0":
  version: 18.3.1
  resolution: "react@npm:18.3.1"
  checksum: abc123
  languageName: node
  linkType: hard

"date-fns@npm:^3.0.0":
  version: 3.6.0
  resolution: "date-fns@npm:3.6.0"
  checksum: def456
  languageName: node
  linkType: hard

"typescript@npm:^5.3.0":
  version: 5.3.3
  resolution: "typescript@npm:5.3.3"
  checksum: ghi789
  languageName: node
  linkType: hard
`;

describe("parseYarnLockfile", () => {
  it("parses lockfile version from metadata", async () => {
    const result = await Effect.runPromise(
      parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"),
    );
    expect(result.packageManager).toBe("yarn");
    expect(result.lockfileVersion).toBe("8");
  });

  it("identifies workspace packages by linkType soft",
    async () => {
    const result = await Effect.runPromise(
      parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"),
    );
    const ws = result.packages.filter((p) => p.isWorkspace);
    const names = ws.map((p) => p.name);
    expect(names).toContain("@my-monorepo/web");
    expect(names).toContain("@my-monorepo/shared");
  });

  it("extracts resolved non-workspace packages", async () => {
    const result = await Effect.runPromise(
      parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"),
    );
    const nonWs = result.packages.filter(
      (p) => !p.isWorkspace,
    );
    const names = nonWs.map((p) => p.name);
    expect(names).toContain("react");
    expect(names).toContain("date-fns");
  });

  it("extracts workspace dependencies", async () => {
    const result = await Effect.runPromise(
      parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"),
    );
    expect(result.workspaceDependencies).toContainEqual(
      expect.objectContaining({
        to: "@my-monorepo/shared",
        depType: "dependencies",
      }),
    );
  });

  it("fails on malformed YAML", async () => {
    const result = await Effect.runPromiseExit(
      parseYarnLockfile("{{bad", "/bad"),
    );
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/layers/parsers/yarn.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/yarn.test.ts
git commit -m "test: add yarn Berry parser tests (failing)"
```

### Task 12: yarn parser -- implementation

**Files:**

- Create: `src/layers/parsers/yarn.ts`

- [ ] **Step 1: Implement yarn Berry parser**

Yarn Berry format quirks:

- Top-level keys are quoted strings like
  `"react@npm:^18.2.0":`
- `__metadata` entry has version and cacheKey
- Workspace entries: `linkType: soft`, resolution
  contains `@workspace:`
- Non-workspace: `linkType: hard`
- Extract package name from key: everything before the
  last `@npm:` or `@workspace:`

```typescript
import { Effect, Schema } from "effect";
import YAML from "yaml";
import { LockfileParseError } from "../../errors/index.js";
import {
  LockfileData,
  ResolvedPackage,
} from "../../schemas/lockfile.js";
import {
  type WorkspaceEntry,
  extractWorkspaceDeps,
} from "./shared.js";

// -- Raw schema (internal, permissive) --

const YarnEntrySchema = Schema.Struct({
  version: Schema.optional(Schema.String),
  resolution: Schema.optional(Schema.String),
  dependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  devDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  peerDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  optionalDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  checksum: Schema.optional(Schema.String),
  languageName: Schema.optional(Schema.String),
  linkType: Schema.optional(Schema.String),
  bin: Schema.optional(Schema.Unknown),
});

// -- Parser --

export const parseYarnLockfile = (
  content: string,
  lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => YAML.parse(content) as Record<string, unknown>,
      catch: (e) =>
        new LockfileParseError({
          lockfilePath,
          format: "yarn",
          cause: e,
        }),
    });

    // Extract metadata
    const metadata = raw.__metadata as
      | { version?: number | string }
      | undefined;
    const lockfileVersion = String(
      metadata?.version ?? "unknown",
    );

    const packages: ResolvedPackage[] = [];
    const workspaceNames = new Set<string>();
    const workspaceEntries = new Map<
      string,
      WorkspaceEntry
    >();

    // First pass: identify workspace entries
    for (const [key, value] of Object.entries(raw)) {
      if (key === "__metadata") continue;
      const entry = yield* Schema.decodeUnknown(
        YarnEntrySchema,
      )(value).pipe(
        Effect.mapError(
          (e) =>
            new LockfileParseError({
              lockfilePath,
              format: "yarn",
              cause: e,
            }),
        ),
      );

      if (entry.linkType === "soft") {
        const name = extractYarnPackageName(key);
        if (name) workspaceNames.add(name);
      }
    }

    // Second pass: build packages
    for (const [key, value] of Object.entries(raw)) {
      if (key === "__metadata") continue;
      const entry = yield* Schema.decodeUnknown(
        YarnEntrySchema,
      )(value).pipe(
        Effect.mapError(
          (e) =>
            new LockfileParseError({
              lockfilePath,
              format: "yarn",
              cause: e,
            }),
        ),
      );

      const name = extractYarnPackageName(key);
      if (!name) continue;

      const isWorkspace = entry.linkType === "soft";

      packages.push(
        new ResolvedPackage({
          name,
          version: entry.version ?? "0.0.0",
          integrity: entry.checksum,
          isWorkspace,
        }),
      );

      if (isWorkspace) {
        workspaceEntries.set(name, {
          dependencies: cleanYarnDeps(
            entry.dependencies,
          ),
          devDependencies: cleanYarnDeps(
            entry.devDependencies,
          ),
          peerDependencies: cleanYarnDeps(
            entry.peerDependencies,
          ),
          optionalDependencies: cleanYarnDeps(
            entry.optionalDependencies,
          ),
        });
      }
    }

    const wsDeps = extractWorkspaceDeps(
      workspaceEntries,
      workspaceNames,
    );

    return new LockfileData({
      packageManager: "yarn",
      lockfileVersion,
      packages,
      workspaceDependencies: [...wsDeps],
    });
  });

/** Extract package name from yarn key like
 * "@scope/name@npm:^1.0.0" or
 * "@scope/name@workspace:packages/foo" */
const extractYarnPackageName = (
  key: string,
): string | undefined => {
  // Find the last @npm: or @workspace: segment
  const npmIdx = key.lastIndexOf("@npm:");
  const wsIdx = key.lastIndexOf("@workspace:");
  const idx = Math.max(npmIdx, wsIdx);
  if (idx <= 0) return undefined;
  return key.slice(0, idx);
};

/** Strip "npm:" prefix from yarn dependency values. */
const cleanYarnDeps = (
  deps: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!deps) return undefined;
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(deps)) {
    result[name] = value.startsWith("npm:")
      ? value.slice(4)
      : value;
  }
  return result;
};
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/yarn.test.ts
```

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/layers/parsers/yarn.ts
git commit -m "feat: implement yarn Berry lockfile parser"
```

---

## Chunk 5: bun parser

### Task 13: bun parser -- tests first

**Files:**

- Create: `src/layers/parsers/bun.test.ts`

- [ ] **Step 1: Write bun parser tests**

Bun uses JSONC with trailing commas. Packages are tuple arrays:
`[id, registry_or_empty, meta_obj?, integrity?]`.
Workspaces are in `workspaces` map keyed by path.

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseBunLockfile } from "./bun.js";

// JSONC with trailing commas and comments
const MINIMAL_BUN_LOCK = `{
  // Bun lockfile v0
  "lockfileVersion": 0,
  "workspaces": {
    "": {
      "name": "my-monorepo",
      "devDependencies": {
        "typescript": "^5.3.0",
      },
    },
    "packages/api": {
      "name": "@my-monorepo/api",
      "version": "1.0.0",
      "dependencies": {
        "@my-monorepo/common": "packages/common",
        "hono": "^4.0.0",
      },
    },
    "packages/common": {
      "name": "@my-monorepo/common",
      "version": "1.0.0",
      "dependencies": {
        "zod": "^3.22.0",
      },
    },
  },
  "packages": {
    "hono": ["hono@4.6.14", "", {}, "sha512-abc"],
    "zod": ["zod@3.23.8", "", {}, "sha512-def"],
    "typescript": ["typescript@5.3.3", "", {}, "sha512-ghi"],
  },
  "overrides": {
    "lodash": "^4.17.23",
  },
}`;

describe("parseBunLockfile", () => {
  it("parses JSONC with comments and trailing commas",
    async () => {
    const result = await Effect.runPromise(
      parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"),
    );
    expect(result.packageManager).toBe("bun");
    expect(result.lockfileVersion).toBe("0");
  });

  it("extracts workspace packages", async () => {
    const result = await Effect.runPromise(
      parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"),
    );
    const ws = result.packages.filter((p) => p.isWorkspace);
    const names = ws.map((p) => p.name);
    expect(names).toContain("@my-monorepo/api");
    expect(names).toContain("@my-monorepo/common");
  });

  it("parses package tuples for resolved versions",
    async () => {
    const result = await Effect.runPromise(
      parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"),
    );
    const hono = result.packages.find(
      (p) => p.name === "hono",
    );
    expect(hono).toBeDefined();
    expect(hono?.version).toBe("4.6.14");
    expect(hono?.integrity).toBe("sha512-abc");
  });

  it("extracts workspace dependencies", async () => {
    const result = await Effect.runPromise(
      parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"),
    );
    expect(result.workspaceDependencies).toContainEqual(
      expect.objectContaining({
        to: "@my-monorepo/common",
        depType: "dependencies",
      }),
    );
  });

  it("extracts overrides into pmSpecific", async () => {
    const result = await Effect.runPromise(
      parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"),
    );
    expect(result.pmSpecific?._tag).toBe("bun");
    if (result.pmSpecific?._tag === "bun") {
      expect(result.pmSpecific.overrides?.lodash).toBe(
        "^4.17.23",
      );
    }
  });

  it("fails on invalid JSONC", async () => {
    const result = await Effect.runPromiseExit(
      parseBunLockfile("{invalid content", "/bad"),
    );
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/layers/parsers/bun.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/bun.test.ts
git commit -m "test: add bun parser tests (failing)"
```

### Task 14: bun parser -- implementation

**Files:**

- Create: `src/layers/parsers/bun.ts`

- [ ] **Step 1: Implement bun parser**

Uses `jsonc-effect` for JSONC parsing. Bun package tuples:
`[id, registry, meta?, integrity?]` where `id` is
`"name@version"`.

```typescript
import { Effect, Schema } from "effect";
import { parse as parseJsonc } from "jsonc-effect";
import { LockfileParseError } from "../../errors/index.js";
import {
  BunExtension,
  LockfileData,
  ResolvedPackage,
} from "../../schemas/lockfile.js";
import {
  type WorkspaceEntry,
  extractWorkspaceDeps,
} from "./shared.js";

// -- Raw schema (internal) --

const BunWorkspaceEntrySchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  dependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  devDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  peerDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  optionalDependencies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
});

const BunLockfileRawSchema = Schema.Struct({
  lockfileVersion: Schema.Number,
  workspaces: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: BunWorkspaceEntrySchema,
    }),
  ),
  packages: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Array(Schema.Unknown),
    }),
  ),
  catalog: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
  catalogs: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({
        key: Schema.String,
        value: Schema.Unknown,
      }),
    }),
  ),
  overrides: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  trustedDependencies: Schema.optional(
    Schema.Array(Schema.String),
  ),
});

type BunLockfileRaw = Schema.Schema.Type<
  typeof BunLockfileRawSchema
>;

// -- Parser --

export const parseBunLockfile = (
  content: string,
  lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
  Effect.gen(function* () {
    // Step 1: Parse JSONC via jsonc-effect
    const parsed = yield* parseJsonc(content).pipe(
      Effect.mapError(
        (e) =>
          new LockfileParseError({
            lockfilePath,
            format: "bun",
            cause: e,
          }),
      ),
    );

    // Step 2: Validate against schema
    const lockfile = yield* Schema.decodeUnknown(
      BunLockfileRawSchema,
    )(parsed).pipe(
      Effect.mapError(
        (e) =>
          new LockfileParseError({
            lockfilePath,
            format: "bun",
            cause: e,
          }),
      ),
    );

    return toLockfileData(lockfile);
  });

type BunWorkspaceEntry = Schema.Schema.Type<
  typeof BunWorkspaceEntrySchema
>;

const toLockfileData = (
  raw: BunLockfileRaw,
): LockfileData => {
  const packages: ResolvedPackage[] = [];
  const workspaceNames = new Set<string>();
  const workspaceEntries = new Map<
    string,
    WorkspaceEntry
  >();

  // Process workspace entries
  if (raw.workspaces) {
    for (const [wsPath, wsEntry] of Object.entries(
      raw.workspaces,
    )) {
      if (wsPath === "") continue; // skip root
      const name = wsEntry.name ?? wsPath;
      workspaceNames.add(name);
      packages.push(
        new ResolvedPackage({
          name,
          version: wsEntry.version ?? "0.0.0",
          isWorkspace: true,
        }),
      );
      workspaceEntries.set(name, {
        dependencies: wsEntry.dependencies,
        devDependencies: wsEntry.devDependencies,
        peerDependencies: wsEntry.peerDependencies,
        optionalDependencies:
          wsEntry.optionalDependencies,
      });
    }
  }

  // Process package tuples
  if (raw.packages) {
    for (const [, tuple] of Object.entries(
      raw.packages,
    )) {
      if (!Array.isArray(tuple) || tuple.length < 1)
        continue;
      const id = String(tuple[0]); // "name@version"
      const integrity =
        tuple.length >= 4
          ? String(tuple[3])
          : undefined;

      // Parse "name@version" -- handle scoped packages
      const atIdx = id.lastIndexOf("@");
      if (atIdx <= 0) continue;
      const name = id.slice(0, atIdx);
      const version = id.slice(atIdx + 1);

      // Skip if this is a workspace package
      // (already added above)
      if (workspaceNames.has(name)) continue;

      packages.push(
        new ResolvedPackage({
          name,
          version,
          integrity,
          isWorkspace: false,
        }),
      );
    }
  }

  const wsDeps = extractWorkspaceDeps(
    workspaceEntries,
    workspaceNames,
  );

  const pmSpecific = new BunExtension({
    _tag: "bun",
    catalog: raw.catalog,
    catalogs: raw.catalogs,
    overrides: raw.overrides,
    trustedDependencies: raw.trustedDependencies,
  });

  return new LockfileData({
    packageManager: "bun",
    lockfileVersion: String(raw.lockfileVersion),
    packages,
    workspaceDependencies: [...wsDeps],
    pmSpecific,
  });
};
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/bun.test.ts
```

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/layers/parsers/bun.ts
git commit -m "feat: implement bun lockfile parser (jsonc-effect)"
```

---

## Chunk 6: Integrity checking

### Task 15: integrity module -- tests first

**Files:**

- Create: `src/layers/integrity.test.ts`

- [ ] **Step 1: Write integrity tests**

```typescript
import { Effect } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { describe, expect, it } from "vitest";
import {
  LockfileData,
  LockfileIntegrity,
  ResolvedPackage,
} from "../schemas/lockfile.js";
import { checkLockfileIntegrity } from "./integrity.js";

// Helper: mock FileSystem that returns package.json content
const mockFs = (
  files: Record<string, string>,
): FileSystem.FileSystem =>
  ({
    readFileString: (path: string) => {
      const content = files[path];
      if (content === undefined) {
        return Effect.fail(
          new Error(`ENOENT: ${path}`),
        );
      }
      return Effect.succeed(content);
    },
  }) as unknown as FileSystem.FileSystem;

const mockPath: Path.Path = {
  join: (...parts: string[]) => parts.join("/"),
} as unknown as Path.Path;

describe("checkLockfileIntegrity", () => {
  it("returns valid when lockfile matches package.json",
    async () => {
    const lockfileData = new LockfileData({
      packageManager: "npm",
      lockfileVersion: "3",
      packages: [
        new ResolvedPackage({
          name: "@my/app",
          version: "1.0.0",
          isWorkspace: true,
        }),
        new ResolvedPackage({
          name: "lodash",
          version: "4.17.21",
          isWorkspace: false,
        }),
      ],
      workspaceDependencies: [],
    });

    const fs = mockFs({
      "/project/@my/app/package.json": JSON.stringify({
        name: "@my/app",
        dependencies: { lodash: "^4.17.0" },
      }),
    });

    const result = await Effect.runPromise(
      checkLockfileIntegrity(
        lockfileData,
        "/project",
        fs,
        mockPath,
      ),
    );
    expect(result.valid).toBe(true);
    expect(result.unsatisfiedConstraints).toHaveLength(0);
  });

  it("detects unsatisfied version constraints",
    async () => {
    const lockfileData = new LockfileData({
      packageManager: "npm",
      lockfileVersion: "3",
      packages: [
        new ResolvedPackage({
          name: "@my/app",
          version: "1.0.0",
          isWorkspace: true,
        }),
        new ResolvedPackage({
          name: "lodash",
          version: "5.0.0",
          isWorkspace: false,
        }),
      ],
      workspaceDependencies: [],
    });

    const fs = mockFs({
      "/project/@my/app/package.json": JSON.stringify({
        name: "@my/app",
        dependencies: { lodash: "^4.17.0" },
      }),
    });

    const result = await Effect.runPromise(
      checkLockfileIntegrity(
        lockfileData,
        "/project",
        fs,
        mockPath,
      ),
    );
    expect(result.valid).toBe(false);
    expect(
      result.unsatisfiedConstraints,
    ).toHaveLength(1);
    expect(
      result.unsatisfiedConstraints[0]?.dependency,
    ).toBe("lodash");
  });

  it("skips workspace specifiers", async () => {
    const lockfileData = new LockfileData({
      packageManager: "pnpm",
      lockfileVersion: "9.0",
      packages: [
        new ResolvedPackage({
          name: "@my/app",
          version: "1.0.0",
          isWorkspace: true,
        }),
        new ResolvedPackage({
          name: "@my/lib",
          version: "1.0.0",
          isWorkspace: true,
        }),
      ],
      workspaceDependencies: [],
    });

    const fs = mockFs({
      "/project/@my/app/package.json": JSON.stringify({
        name: "@my/app",
        dependencies: { "@my/lib": "workspace:*" },
      }),
      "/project/@my/lib/package.json": JSON.stringify({
        name: "@my/lib",
      }),
    });

    const result = await Effect.runPromise(
      checkLockfileIntegrity(
        lockfileData,
        "/project",
        fs,
        mockPath,
      ),
    );
    expect(result.valid).toBe(true);
  });

  it("skips unparseable constraints", async () => {
    const lockfileData = new LockfileData({
      packageManager: "npm",
      lockfileVersion: "3",
      packages: [
        new ResolvedPackage({
          name: "@my/app",
          version: "1.0.0",
          isWorkspace: true,
        }),
        new ResolvedPackage({
          name: "my-dep",
          version: "1.0.0",
          isWorkspace: false,
        }),
      ],
      workspaceDependencies: [],
    });

    const fs = mockFs({
      "/project/@my/app/package.json": JSON.stringify({
        name: "@my/app",
        dependencies: {
          "my-dep": "github:user/repo#main",
        },
      }),
    });

    const result = await Effect.runPromise(
      checkLockfileIntegrity(
        lockfileData,
        "/project",
        fs,
        mockPath,
      ),
    );
    // Should skip unparseable, not fail
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/layers/integrity.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/integrity.test.ts
git commit -m "test: add integrity checking tests (failing)"
```

### Task 16: integrity module -- implementation

**Files:**

- Create: `src/layers/integrity.ts`

- [ ] **Step 1: Implement integrity checking**

```typescript
import { Effect, Exit } from "effect";
import type { FileSystem } from "@effect/platform";
import type { Path } from "@effect/platform";
import { Range, SemVer } from "semver-effect";
import { LockfileIntegrityError } from "../errors/index.js";
import type { LockfileData } from "../schemas/lockfile.js";
import { LockfileIntegrity } from "../schemas/lockfile.js";
import { isWorkspaceSpecifier } from "./parsers/shared.js";

const DEP_TYPES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DepType = (typeof DEP_TYPES)[number];

interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export const checkLockfileIntegrity = (
  lockfileData: LockfileData,
  root: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.Effect<
  LockfileIntegrity,
  LockfileIntegrityError
> =>
  Effect.gen(function* () {
    const workspacePackages =
      lockfileData.packages.filter(
        (p) => p.isWorkspace,
      );

    // Read package.json for each workspace package
    const packageJsons = yield* Effect.forEach(
      workspacePackages,
      (pkg) =>
        Effect.gen(function* () {
          const pkgJsonPath = path.join(
            root,
            pkg.name,
            "package.json",
          );
          const content = yield* fs.readFileString(
            pkgJsonPath,
          );
          const parsed = JSON.parse(
            content,
          ) as PackageJsonDeps;
          return [pkg.name, parsed] as const;
        }),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (e) =>
          new LockfileIntegrityError({
            reason: `Failed to read workspace package.json: ${e}`,
            cause: e,
          }),
      ),
    );

    // Check workspace presence
    const lockfileWsNames = new Set(
      workspacePackages.map((p) => p.name),
    );
    const pkgJsonNames = new Set(
      packageJsons.map(([name]) => name),
    );
    const missingWorkspaces = [...pkgJsonNames].filter(
      (n) => !lockfileWsNames.has(n),
    );
    const extraWorkspaces = [...lockfileWsNames].filter(
      (n) => !pkgJsonNames.has(n),
    );

    // Check constraint satisfaction
    const unsatisfied = yield* checkConstraints(
      lockfileData,
      packageJsons,
    );

    return new LockfileIntegrity({
      valid:
        missingWorkspaces.length === 0 &&
        extraWorkspaces.length === 0 &&
        unsatisfied.length === 0,
      missingWorkspaces,
      extraWorkspaces,
      unsatisfiedConstraints: unsatisfied,
    });
  });

const checkConstraints = (
  lockfileData: LockfileData,
  packageJsons: ReadonlyArray<
    readonly [string, PackageJsonDeps]
  >,
) =>
  Effect.gen(function* () {
    const resolvedIndex = new Map(
      lockfileData.packages.map(
        (p) => [p.name, p.version] as const,
      ),
    );

    const unsatisfied: Array<{
      workspace: string;
      dependency: string;
      constraint: string;
      resolved: string;
      depType: DepType;
    }> = [];

    for (const [wsName, deps] of packageJsons) {
      for (const depType of DEP_TYPES) {
        const depMap = deps[depType];
        if (!depMap) continue;

        for (const [depName, constraint] of Object.entries(
          depMap,
        )) {
          if (isWorkspaceSpecifier(constraint)) continue;

          const resolved = resolvedIndex.get(depName);
          if (!resolved) continue;

          const rangeExit = yield* Effect.exit(
            Range.fromString(constraint),
          );
          const versionExit = yield* Effect.exit(
            SemVer.fromString(resolved),
          );

          if (
            Exit.isFailure(rangeExit) ||
            Exit.isFailure(versionExit)
          ) {
            continue; // skip unparseable
          }

          if (
            !Range.satisfies(
              versionExit.value,
              rangeExit.value,
            )
          ) {
            unsatisfied.push({
              workspace: wsName,
              dependency: depName,
              constraint,
              resolved,
              depType,
            });
          }
        }
      }
    }

    return unsatisfied;
  });
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/integrity.test.ts
```

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/layers/integrity.ts
git commit -m "feat: implement lockfile integrity checking with semver-effect"
```

---

## Chunk 7: Layer, composite, exports, integration tests

### Task 17: LockfileReaderLive layer

**Files:**

- Create: `src/layers/LockfileReaderLive.ts`

- [ ] **Step 1: Implement LockfileReaderLive**

```typescript
import { Effect, Layer, Option } from "effect";
import {
  FileSystem,
  Path,
} from "@effect/platform";
import {
  LockfileReadError,
  type LockfileParseError,
} from "../errors/index.js";
import type {
  ResolvedPackage,
} from "../schemas/lockfile.js";
import type { PackageManagerType } from "../schemas/core.js";
import { LockfileReader } from "../services/LockfileReader.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { parsePnpmLockfile } from "./parsers/pnpm.js";
import { parseNpmLockfile } from "./parsers/npm.js";
import { parseYarnLockfile } from "./parsers/yarn.js";
import { parseBunLockfile } from "./parsers/bun.js";
import { checkLockfileIntegrity } from "./integrity.js";

const lockfileNameFor = (
  pm: PackageManagerType,
): string => {
  switch (pm) {
    case "pnpm":
      return "pnpm-lock.yaml";
    case "npm":
      return "package-lock.json";
    case "yarn":
      return "yarn.lock";
    case "bun":
      return "bun.lock";
  }
};

const parseLockfile = (
  content: string,
  lockfilePath: string,
  pm: PackageManagerType,
) => {
  switch (pm) {
    case "pnpm":
      return parsePnpmLockfile(content, lockfilePath);
    case "npm":
      return parseNpmLockfile(content, lockfilePath);
    case "yarn":
      return parseYarnLockfile(content, lockfilePath);
    case "bun":
      return parseBunLockfile(content, lockfilePath);
  }
};

export const LockfileReaderLive: Layer.Layer<
  LockfileReader,
  LockfileReadError | LockfileParseError,
  | WorkspaceRoot
  | PackageManagerDetector
  | FileSystem.FileSystem
  | Path.Path
> = Layer.effect(
  LockfileReader,
  Effect.gen(function* () {
    const rootService = yield* WorkspaceRoot;
    const detector = yield* PackageManagerDetector;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = yield* rootService.find(
      globalThis.process?.cwd() ?? "/",
    );
    const { type: pm } = yield* detector.detect(root);

    const lockfilePath = path.join(
      root,
      lockfileNameFor(pm),
    );

    const content = yield* fs
      .readFileString(lockfilePath)
      .pipe(
        Effect.mapError(
          () =>
            new LockfileReadError({
              lockfilePath,
              reason:
                "file not found or unreadable",
            }),
        ),
      );

    const lockfileData = yield* parseLockfile(
      content,
      lockfilePath,
      pm,
    );

    // Build multi-version lookup index
    const packageIndex = new Map<
      string,
      Array<ResolvedPackage>
    >();
    for (const pkg of lockfileData.packages) {
      const existing =
        packageIndex.get(pkg.name) ?? [];
      existing.push(pkg);
      packageIndex.set(pkg.name, existing);
    }

    return {
      readLockfile: () =>
        Effect.succeed(lockfileData),

      resolvedVersion: (packageName: string) =>
        Effect.succeed(
          Option.fromNullable(
            packageIndex.get(packageName)?.[0],
          ),
        ),

      workspaceDependencies: () =>
        Effect.succeed(
          lockfileData.workspaceDependencies,
        ),

      checkIntegrity: () =>
        checkLockfileIntegrity(
          lockfileData,
          root,
          fs,
          path,
        ),
    };
  }),
);
```

**Note on `rootService.find()`:** The existing `WorkspaceRoot`
service has `find(cwd: string)`. We pass `process.cwd()` via
`globalThis.process` to stay platform-aware. In tests this is
mocked away entirely via `Layer.succeed`.

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/LockfileReaderLive.ts
git commit -m "feat: implement LockfileReaderLive layer"
```

### Task 18: Composite layer

**Files:**

- Create: `src/layers/ConfigurationLive.ts`

- [ ] **Step 1: Create composite layer**

```typescript
import { Layer } from "effect";
import { LockfileReaderLive } from "./LockfileReaderLive.js";
import { DiscoveryLive } from "./DiscoveryLive.js";

/** All Phase 4 services. */
export const ConfigurationLive = LockfileReaderLive;

/** Full stack: Discovery + Configuration. */
export const FullConfigLive = ConfigurationLive.pipe(
  Layer.provide(DiscoveryLive),
);
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/layers/ConfigurationLive.ts
git commit -m "feat: add ConfigurationLive and FullConfigLive composite layers"
```

### Task 19: Update exports

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add new exports to index.ts**

Add the following exports in the appropriate sections
(errors with errors, layers with layers, etc.):

Errors section -- add:

```typescript
export {
  LockfileIntegrityError,
  LockfileParseError,
  LockfileReadError,
} from "./errors/index.js";
```

Layers section -- add:

```typescript
export {
  ConfigurationLive,
  FullConfigLive,
} from "./layers/ConfigurationLive.js";
export { LockfileReaderLive } from "./layers/LockfileReaderLive.js";
```

Schemas section -- add:

```typescript
export {
  BunExtension,
  LockfileData,
  LockfileIntegrity,
  PnpmExtension,
  ResolvedPackage,
  WorkspaceDependency,
} from "./schemas/lockfile.js";
```

Services section -- add:

```typescript
export { LockfileReader } from "./services/LockfileReader.js";
```

- [ ] **Step 2: Lint, typecheck, and run all existing tests**

```bash
pnpm run lint:fix && pnpm run typecheck && pnpm run test
```

Expected: all 104+ existing tests still pass, plus the new
parser and integrity tests.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export LockfileReader service and Phase 4 types"
```

### Task 20: Integration tests

**Files:**

- Create: `src/layers/LockfileReaderLive.test.ts`

- [ ] **Step 1: Write integration tests**

Mock all service dependencies. Test end-to-end for each PM.

```typescript
import { Effect, Exit, Layer, Option } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { describe, expect, it } from "vitest";
import { LockfileReader } from "../services/LockfileReader.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";

// Inline fixtures (shortened for test focus)
const PNPM_FIXTURE = `lockfileVersion: "9.0"
importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3
  packages/core:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
packages:
  lodash@4.17.21:
    resolution:
      integrity: sha512-abc
  typescript@5.3.3:
    resolution:
      integrity: sha512-def
`;

const testLayer = (
  pm: "pnpm" | "npm" | "yarn" | "bun",
  lockfileContent: string,
) =>
  LockfileReaderLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(WorkspaceRoot, {
          find: () => Effect.succeed("/project"),
        }),
        Layer.succeed(PackageManagerDetector, {
          detect: (_root: string) =>
            Effect.succeed({
              type: pm,
              version: undefined,
            }),
        }),
        FileSystem.layerNoop({
          readFileString: (filePath: string) => {
            if (filePath.endsWith(".lock") ||
                filePath.endsWith(".yaml") ||
                (filePath.endsWith(".json") &&
                filePath.includes("lock"))) {
              return Effect.succeed(lockfileContent);
            }
            return Effect.fail(
              new Error(`ENOENT: ${filePath}`),
            );
          },
        }),
        Path.layer,
      ),
    ),
  );

describe("LockfileReaderLive", () => {
  it("reads pnpm lockfile end-to-end", async () => {
    const layer = testLayer("pnpm", PNPM_FIXTURE);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* LockfileReader;
        return yield* reader.readLockfile();
      }).pipe(Effect.provide(layer)),
    );
    expect(result.packageManager).toBe("pnpm");
    expect(result.packages.length).toBeGreaterThan(0);
  });

  it("resolvedVersion returns Some for known package",
    async () => {
    const layer = testLayer("pnpm", PNPM_FIXTURE);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* LockfileReader;
        return yield* reader.resolvedVersion("lodash");
      }).pipe(Effect.provide(layer)),
    );
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.version).toBe("4.17.21");
    }
  });

  it("resolvedVersion returns None for unknown package",
    async () => {
    const layer = testLayer("pnpm", PNPM_FIXTURE);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* LockfileReader;
        return yield* reader.resolvedVersion(
          "nonexistent",
        );
      }).pipe(Effect.provide(layer)),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with LockfileReadError when lockfile missing",
    async () => {
    const layer = LockfileReaderLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceRoot, {
            find: () => Effect.succeed("/project"),
          }),
          Layer.succeed(PackageManagerDetector, {
            detect: () =>
              Effect.succeed({
                type: "pnpm" as const,
                version: undefined,
              }),
          }),
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.fail(new Error("ENOENT")),
          }),
          Path.layer,
        ),
      ),
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reader = yield* LockfileReader;
        return yield* reader.readLockfile();
      }).pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
pnpm vitest run src/layers/LockfileReaderLive.test.ts
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm run test
```

Expected: all tests pass (existing 104 + new parser,
integrity, and integration tests).

- [ ] **Step 4: Lint and typecheck**

```bash
pnpm run lint:fix && pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/LockfileReaderLive.test.ts
git commit -m "test: add LockfileReaderLive integration tests"
```

### Task 21: Final verification

- [ ] **Step 1: Run full test suite with coverage**

```bash
pnpm run test:coverage
```

- [ ] **Step 2: Verify all exports work**

```bash
pnpm run build
```

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git status
```

If clean, this chunk is complete.
