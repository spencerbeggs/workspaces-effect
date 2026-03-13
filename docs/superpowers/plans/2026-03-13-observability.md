# Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive OpenTelemetry spans and structured logging to all
service methods across all 4 phases of workspaces-effect.

**Architecture:** Inline `Effect.withSpan` and `Effect.log*` calls directly in
each layer implementation file. No new files, abstractions, or wrapper
utilities. Spans are no-ops without a tracer; logs are silent without a Logger
layer.

**Tech Stack:** Effect (`Effect.withSpan`, `Effect.logInfo`, `Effect.logDebug`,
`Effect.logTrace`, `Effect.annotateLogs`) — all already in dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-observability-design.md`

---

## Chunk 1: Phase 1 — WorkspaceRoot and PackageManagerDetector

### Task 1: Add Info logging to WorkspaceRootLive

**Files:**

- Modify: `src/layers/WorkspaceRootLive.ts`

**Context:** This file already has a span on `findWorkspaceRoot`
(`Effect.withSpan("WorkspaceRoot.find")`). We only need to add an Info log
when the root is found. The log goes inside `findWorkspaceRoot`, after the
successful `result.value` return path.

- [ ] **Step 1: Add the Info log**

In `src/layers/WorkspaceRootLive.ts`, inside `findWorkspaceRoot`, after
`if (result._tag === "Some")` and before `return result.value`, add the log:

```typescript
if (result._tag === "Some") {
 yield* Effect.logInfo("Workspace root found").pipe(
  Effect.annotateLogs("workspace.root", result.value),
 );
 return result.value;
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/WorkspaceRootLive.test.ts
```

Expected: All tests pass. The log is transparent — no output without a Logger.

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/layers/WorkspaceRootLive.ts
git commit -m "feat(observability): add Info log to WorkspaceRoot.find"
```

---

### Task 2: Add Info logging to PackageManagerDetectorLive

**Files:**

- Modify: `src/layers/PackageManagerDetectorLive.ts`

**Context:** This file already has a span on `detectPackageManager`
(`Effect.withSpan("PackageManagerDetector.detect")`). Add an Info log before
each successful return statement (there are 4 return paths: pnpm, bun, yarn,
npm).

- [ ] **Step 1: Add Info logs to each detection path**

In `src/layers/PackageManagerDetectorLive.ts`, inside `detectPackageManager`,
add a log before each `return` statement. There are 4 success paths. The
current code returns object literals directly (`return { type: ... }`).
Extract each into a `const result` variable first, then log, then return:

**pnpm path (after `if (hasPnpmWorkspace)`):**

```typescript
if (hasPnpmWorkspace) {
 const result = {
  type: "pnpm" as PackageManagerType,
  version: pmInfo?.name === "pnpm" ? pmInfo.version : undefined,
 };
 yield* Effect.logInfo("Package manager detected").pipe(
  Effect.annotateLogs("workspace.pm", result.type),
 );
 return result;
}
```

**bun path (after `if ((hasBunLock || hasBunLockb) && ...)`):**

```typescript
if ((hasBunLock || hasBunLockb) && pmInfo?.name === "bun") {
 const result = {
  type: "bun" as PackageManagerType,
  version: pmInfo.version,
 };
 yield* Effect.logInfo("Package manager detected").pipe(
  Effect.annotateLogs("workspace.pm", result.type),
 );
 return result;
}
```

**yarn path (after `if (hasYarnLock && ...)`):**

```typescript
if (hasYarnLock && pmInfo?.name === "yarn") {
 const result = {
  type: "yarn" as PackageManagerType,
  version: pmInfo.version,
 };
 yield* Effect.logInfo("Package manager detected").pipe(
  Effect.annotateLogs("workspace.pm", result.type),
 );
 return result;
}
```

**npm path (inside the `if ("workspaces" in parsed ...)` block):**

```typescript
if ("workspaces" in parsed && parsed.workspaces != null) {
 const result = {
  type: "npm" as PackageManagerType,
  version: pmInfo?.name === "npm" ? pmInfo.version : undefined,
 };
 yield* Effect.logInfo("Package manager detected").pipe(
  Effect.annotateLogs("workspace.pm", result.type),
 );
 return result;
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/PackageManagerDetectorLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/layers/PackageManagerDetectorLive.ts
git commit -m "feat(observability): add Info log to PackageManagerDetector.detect"
```

---

## Chunk 2: Phase 1 — WorkspaceDiscovery

### Task 3: Add logging to WorkspaceDiscoveryLive

**Files:**

- Modify: `src/layers/WorkspaceDiscoveryLive.ts`

**Context:** This file has existing spans on `listPackages` and `getPackage`.
We add:

- Info log to `listPackages` (package count)
- Debug log to `getPackage` (queried name)
- Normalize `getPackage` span attribute from `package.name` to
  `workspace.package`

- [ ] **Step 1: Add Info log to listPackages**

In `discoverPackages`, after `cachedPackages = packages` and before
`return packages`, add:

```typescript
cachedPackages = packages;
yield* Effect.logInfo("Workspace packages discovered").pipe(
 Effect.annotateLogs("workspace.packages.count", packages.length),
);
return packages;
```

- [ ] **Step 2: Add Debug log to getPackage and normalize attribute**

In the `getPackage` method, after `if (found) return found`, add a Debug log.
Also change `"package.name": name` to `"workspace.package": name` in the
existing span:

```typescript
getPackage: (name: string) =>
 Effect.gen(function* () {
  const packages = yield* discoverPackages();
  const found = packages.find((p) => p.name === name);
  if (found) {
   yield* Effect.logDebug("Package resolved").pipe(
    Effect.annotateLogs("workspace.package", name),
   );
   return found;
  }
  return yield* Effect.fail(
   new PackageNotFoundError({
    name,
    available: packages.map((p) => p.name),
   }),
  );
 }).pipe(
  Effect.withSpan("WorkspaceDiscovery.getPackage", {
   attributes: { "workspace.package": name },
  }),
 ),
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run src/layers/WorkspaceDiscoveryLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/layers/WorkspaceDiscoveryLive.ts
git commit -m "feat(observability): add logging to WorkspaceDiscovery, normalize getPackage attribute"
```

---

## Chunk 3: Phase 2 — DependencyGraph and TopologicalSorter

### Task 4: Add spans and logging to DependencyGraphLive

**Files:**

- Modify: `src/layers/DependencyGraphLive.ts`

**Context:** This file has NO existing spans. We add:

- Construction span `DependencyGraph.construct` wrapping the `Effect.gen` body
- Spans + Debug logs to `dependenciesOf`, `dependentsOf`, `hasCycle`
- Debug log to construction (node and edge counts)

The current `dependenciesOf` and `dependentsOf` return `Effect.fail` or
`Effect.succeed` directly (no `Effect.gen`). To add both a span and a log, we
need to wrap them in `Effect.gen`.

- [ ] **Step 1: Wrap `dependenciesOf` in Effect.gen with span and log**

Replace the `dependenciesOf` method body:

```typescript
dependenciesOf: (name: string) =>
 Effect.gen(function* () {
  const deps = graph.edges.get(name);
  if (deps === undefined) {
   return yield* Effect.fail(
    new PackageNotFoundError({
     name,
     available: Array.from(graph.nodes),
    }),
   );
  }
  yield* Effect.logDebug("Resolved dependencies").pipe(
   Effect.annotateLogs({
    "workspace.package": name,
    "workspace.deps.count": deps.size,
   }),
  );
  return Array.from(deps).sort();
 }).pipe(
  Effect.withSpan("DependencyGraph.dependenciesOf", {
   attributes: { "workspace.package": name },
  }),
 ),
```

- [ ] **Step 2: Wrap `dependentsOf` in Effect.gen with span and log**

Replace the `dependentsOf` method body:

```typescript
dependentsOf: (name: string) =>
 Effect.gen(function* () {
  const dependents = graph.reverseEdges.get(name);
  if (dependents === undefined) {
   return yield* Effect.fail(
    new PackageNotFoundError({
     name,
     available: Array.from(graph.nodes),
    }),
   );
  }
  yield* Effect.logDebug("Resolved dependents").pipe(
   Effect.annotateLogs({
    "workspace.package": name,
    "workspace.deps.count": dependents.size,
   }),
  );
  return Array.from(dependents).sort();
 }).pipe(
  Effect.withSpan("DependencyGraph.dependentsOf", {
   attributes: { "workspace.package": name },
  }),
 ),
```

- [ ] **Step 3: Wrap `hasCycle` with span and log**

Replace the `hasCycle` method body:

```typescript
hasCycle: () =>
 Effect.gen(function* () {
  const result = detectCycle(graph);
  yield* Effect.logDebug("Cycle detection complete").pipe(
   Effect.annotateLogs("workspace.hasCycle", result),
  );
  return result;
 }).pipe(Effect.withSpan("DependencyGraph.hasCycle")),
```

- [ ] **Step 4: Add construction span and Debug log**

Wrap the outer `Effect.gen` with `.pipe(Effect.withSpan("DependencyGraph.construct"))`.
Add the Debug log after `buildGraph`. The full return object after all 4 steps:

```typescript
export const DependencyGraphLive = Layer.effect(
 DependencyGraph,
 Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();
  const graph = buildGraph(packages);

  const edgeCount = Array.from(graph.edges.values()).reduce((sum, deps) => sum + deps.size, 0);
  yield* Effect.logDebug("Dependency graph constructed").pipe(
   Effect.annotateLogs({
    "workspace.nodes.count": graph.nodes.size,
    "workspace.edges.count": edgeCount,
   }),
  );

  return {
   dependenciesOf: (name: string) =>
    Effect.gen(function* () {
     // ... method body from Step 1
    }).pipe(
     Effect.withSpan("DependencyGraph.dependenciesOf", {
      attributes: { "workspace.package": name },
     }),
    ),

   dependentsOf: (name: string) =>
    Effect.gen(function* () {
     // ... method body from Step 2
    }).pipe(
     Effect.withSpan("DependencyGraph.dependentsOf", {
      attributes: { "workspace.package": name },
     }),
    ),

   packages: () => Effect.succeed(Array.from(graph.nodes).sort()),

   hasCycle: () =>
    Effect.gen(function* () {
     const result = detectCycle(graph);
     yield* Effect.logDebug("Cycle detection complete").pipe(
      Effect.annotateLogs("workspace.hasCycle", result),
     );
     return result;
    }).pipe(Effect.withSpan("DependencyGraph.hasCycle")),

   adjacencyMap: () => Effect.succeed(graph.edges),
  };
 }).pipe(Effect.withSpan("DependencyGraph.construct")),
);
```

Note: The `dependenciesOf` and `dependentsOf` method bodies are the complete
implementations from Steps 1 and 2 above. Use the full code from those steps
— the `// ... method body from Step N` comments are references, not literals.

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run src/layers/DependencyGraphLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/layers/DependencyGraphLive.ts
git commit -m "feat(observability): add spans and logging to DependencyGraph"
```

---

### Task 5: Add spans and logging to TopologicalSorterLive

**Files:**

- Modify: `src/layers/TopologicalSorterLive.ts`

**Context:** This file has NO existing spans. The methods delegate to
`kahnSort`, `kahnSortSubset`, and `kahnLevels`. We add spans via `.pipe()`
and Debug logs inside `Effect.gen` wrappers.

- [ ] **Step 1: Add span + log to `sort`**

Replace the `sort` method:

```typescript
sort: () =>
 Effect.gen(function* () {
  const result = yield* kahnSort(adjacency);
  yield* Effect.logDebug("Topological sort complete").pipe(
   Effect.annotateLogs("workspace.sorted.count", result.length),
  );
  return result;
 }).pipe(Effect.withSpan("TopologicalSorter.sort")),
```

- [ ] **Step 2: Add span + log to `sortSubset`**

Replace the `sortSubset` method:

```typescript
sortSubset: (names: ReadonlyArray<string>) =>
 Effect.gen(function* () {
  const result = yield* kahnSortSubset(adjacency, names);
  yield* Effect.logDebug("Topological sort subset complete").pipe(
   Effect.annotateLogs({
    "workspace.subset.size": names.length,
    "workspace.sorted.count": result.length,
   }),
  );
  return result;
 }).pipe(Effect.withSpan("TopologicalSorter.sortSubset")),
```

- [ ] **Step 3: Add span + log to `levels`**

Replace the `levels` method:

```typescript
levels: () =>
 Effect.gen(function* () {
  const result = yield* kahnLevels(adjacency);
  yield* Effect.logDebug("Topological levels computed").pipe(
   Effect.annotateLogs("workspace.levels.count", result.length),
  );
  return result;
 }).pipe(Effect.withSpan("TopologicalSorter.levels")),
```

- [ ] **Step 4: Add construction span**

Wrap the `Effect.gen` body with `.pipe(Effect.withSpan(...))`. The return
object contains the method bodies from Steps 1-3:

```typescript
export const TopologicalSorterLive: Layer.Layer<TopologicalSorter, never, DependencyGraph> = Layer.effect(
 TopologicalSorter,
 Effect.gen(function* () {
  const graph = yield* DependencyGraph;
  const adjacency = yield* graph.adjacencyMap();

  return {
   sort: () =>
    Effect.gen(function* () {
     const result = yield* kahnSort(adjacency);
     yield* Effect.logDebug("Topological sort complete").pipe(
      Effect.annotateLogs("workspace.sorted.count", result.length),
     );
     return result;
    }).pipe(Effect.withSpan("TopologicalSorter.sort")),

   sortSubset: (names: ReadonlyArray<string>) =>
    Effect.gen(function* () {
     const result = yield* kahnSortSubset(adjacency, names);
     yield* Effect.logDebug("Topological sort subset complete").pipe(
      Effect.annotateLogs({
       "workspace.subset.size": names.length,
       "workspace.sorted.count": result.length,
      }),
     );
     return result;
    }).pipe(Effect.withSpan("TopologicalSorter.sortSubset")),

   levels: () =>
    Effect.gen(function* () {
     const result = yield* kahnLevels(adjacency);
     yield* Effect.logDebug("Topological levels computed").pipe(
      Effect.annotateLogs("workspace.levels.count", result.length),
     );
     return result;
    }).pipe(Effect.withSpan("TopologicalSorter.levels")),
  };
 }).pipe(Effect.withSpan("TopologicalSorter.construct")),
);
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run src/layers/TopologicalSorterLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/layers/TopologicalSorterLive.ts
git commit -m "feat(observability): add spans and logging to TopologicalSorter"
```

---

## Chunk 4: Phase 2 — PackageResolver and Phase 3 — ChangeDetector

### Task 6: Add construction span to PackageResolverLive

**Files:**

- Modify: `src/layers/PackageResolverLive.ts`

**Context:** Per the spec, `resolveFile`, `resolveFiles`, and `packagePaths`
are all trivial in-memory lookups — no spans or logs. We only add a
construction span.

- [ ] **Step 1: Add construction span**

Wrap the `Effect.gen` body with `.pipe(Effect.withSpan(...))`:

```typescript
export const PackageResolverLive = Layer.effect(
 PackageResolver,
 Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const path = yield* Path.Path;

  const packages = yield* discovery.listPackages();
  const pathIndex = buildPathIndex(packages, path.sep);

  return {
   resolveFile: (filePath: string) => Effect.succeed(findOwner(filePath, pathIndex)),

   resolveFiles: (filePaths: ReadonlyArray<string>) =>
    Effect.succeed(
     filePaths.reduce((map, fp) => {
      const owner = findOwner(fp, pathIndex);
      if (Option.isSome(owner)) {
       map.set(fp, owner.value);
      }
      return map;
     }, new Map<string, WorkspacePackage>()),
    ),

   packagePaths: () =>
    Effect.succeed(
     pathIndex.map((entry) => ({
      path: entry.path,
      package: entry.package,
     })),
    ),
  };
 }).pipe(Effect.withSpan("PackageResolver.construct")),
);
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/PackageResolverLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/layers/PackageResolverLive.ts
git commit -m "feat(observability): add construction span to PackageResolver"
```

---

### Task 7: Add Info logging to ChangeDetectorLive

**Files:**

- Modify: `src/layers/ChangeDetectorLive.ts`

**Context:** This file already has spans on `changedFiles`, `changedPackages`,
and `affectedPackages`. We add Info logs to each, reporting counts.

- [ ] **Step 1: Add Info log to changedFiles**

Inside the `changedFiles` `Effect.gen`, before the final return statements,
add a log. There are two return paths (with and without uncommitted). Add
the log before each return:

Before `return committedFiles` (line 92 area):

```typescript
if (!options.includeUncommitted) {
 yield* Effect.logInfo("Changed files detected").pipe(
  Effect.annotateLogs("workspace.files.count", committedFiles.length),
 );
 return committedFiles;
}
```

Before the final return (line 100 area), extract to a variable:

```typescript
const sorted = Array.from(allFiles).sort();
yield* Effect.logInfo("Changed files detected").pipe(
 Effect.annotateLogs("workspace.files.count", sorted.length),
);
return sorted;
```

- [ ] **Step 2: Add Info log to changedPackages**

Before the final return in `changedPackages`:

```typescript
const sorted = packages.sort((a, b) => a.name.localeCompare(b.name));
yield* Effect.logInfo("Changed packages detected").pipe(
 Effect.annotateLogs("workspace.packages.count", sorted.length),
);
return sorted;
```

- [ ] **Step 3: Add Info log to affectedPackages**

Before the final return in `affectedPackages`:

```typescript
const result = Array.from(affected)
 .map((name) => packageMap.get(name))
 .filter((pkg): pkg is WorkspacePackage => pkg !== undefined)
 .sort((a, b) => a.name.localeCompare(b.name));
yield* Effect.logInfo("Affected packages detected").pipe(
 Effect.annotateLogs("workspace.packages.count", result.length),
);
return result;
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/layers/ChangeDetectorLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/layers/ChangeDetectorLive.ts
git commit -m "feat(observability): add Info logging to ChangeDetector"
```

---

## Chunk 5: Phase 4 — LockfileReader, parsers, and integrity

### Task 8: Add spans and logging to LockfileReaderLive

**Files:**

- Modify: `src/layers/LockfileReaderLive.ts`

**Context:** This file has NO existing spans. We add:

- Construction span `LockfileReader.construct`
- Info log at construction (PM type + package count)
- Span on `resolvedVersion` with Debug log
- Span on `checkIntegrity` via `.pipe()` with Info log

The `readLockfile` and `workspaceDependencies` methods are trivial getters — no
observability.

- [ ] **Step 1: Add construction span and Info log**

Wrap the `Effect.gen` body and add the log after `packageIndex` is built:

```typescript
export const LockfileReaderLive = Layer.effect(
 LockfileReader,
 Effect.gen(function* () {
  const rootService = yield* WorkspaceRoot;
  const detector = yield* PackageManagerDetector;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const root = yield* rootService.find(process.cwd());
  const { type: pm } = yield* detector.detect(root);

  const lockfilePath = path.join(root, lockfileNameFor(pm));

  const content = yield* fs.readFileString(lockfilePath).pipe(
   Effect.mapError(
    () =>
     new LockfileReadError({
      lockfilePath,
      reason: "file not found or unreadable",
     }),
   ),
  );

  const lockfileData = yield* parseLockfile(content, lockfilePath, pm);

  // Build multi-version lookup index
  const packageIndex = new Map<string, Array<ResolvedPackage>>();
  for (const pkg of lockfileData.packages) {
   const existing = packageIndex.get(pkg.name) ?? [];
   existing.push(pkg);
   packageIndex.set(pkg.name, existing);
  }

  yield* Effect.logInfo("Lockfile reader initialized").pipe(
   Effect.annotateLogs({
    "workspace.pm": pm,
    "workspace.packages.count": lockfileData.packages.length,
   }),
  );

  return {
   readLockfile: () => Effect.succeed(lockfileData),

   resolvedVersion: (packageName: string) =>
    Effect.gen(function* () {
     const result = Option.fromNullable(packageIndex.get(packageName)?.[0]);
     yield* Effect.logDebug("Resolved version lookup").pipe(
      Effect.annotateLogs({
       "workspace.package": packageName,
       "workspace.found": Option.isSome(result),
      }),
     );
     return result;
    }).pipe(
     Effect.withSpan("LockfileReader.resolvedVersion", {
      attributes: { "workspace.package": packageName },
     }),
    ),

   workspaceDependencies: () => Effect.succeed(lockfileData.workspaceDependencies),

   checkIntegrity: () =>
    Effect.gen(function* () {
     const result = yield* checkLockfileIntegrity(lockfileData, root, fs, path);
     yield* Effect.logInfo("Lockfile integrity check complete").pipe(
      Effect.annotateLogs({
       "workspace.integrity.valid": result.valid,
       "workspace.integrity.issues":
        result.missingWorkspaces.length +
        result.extraWorkspaces.length +
        result.unsatisfiedConstraints.length,
      }),
     );
     return result;
    }).pipe(Effect.withSpan("LockfileReader.checkIntegrity")),
  };
 }).pipe(Effect.withSpan("LockfileReader.construct")),
);
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/LockfileReaderLive.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/layers/LockfileReaderLive.ts
git commit -m "feat(observability): add spans and logging to LockfileReader"
```

---

### Task 9: Add span and logging to pnpm parser

**Files:**

- Modify: `src/layers/parsers/pnpm.ts`

**Context:** The `parsePnpmLockfile` function uses `Effect.gen`. Add a span
wrapping the entire effect and a Debug log after parsing completes.

- [ ] **Step 1: Add span and Debug log**

Add a Debug log before `return toLockfileData(validated)` and pipe the entire
`Effect.gen` with `Effect.withSpan`:

```typescript
export const parsePnpmLockfile = (
 content: string,
 lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
 Effect.gen(function* () {
  const raw = yield* Effect.try({
   try: () => YAML.parse(content) as unknown,
   catch: (e) =>
    new LockfileParseError({
     lockfilePath,
     format: "pnpm",
     cause: e,
    }),
  });

  const validated = yield* Schema.decodeUnknown(PnpmLockfileRaw)(raw).pipe(
   Effect.mapError(
    (e) =>
     new LockfileParseError({
      lockfilePath,
      format: "pnpm",
      cause: e,
     }),
   ),
  );

  yield* Effect.logDebug("Parsed pnpm lockfile").pipe(
   Effect.annotateLogs({
    "workspace.importers.count": Object.keys(validated.importers).length,
    "workspace.packages.count": Object.keys(validated.packages ?? {}).length,
   }),
  );

  return toLockfileData(validated);
 }).pipe(
  Effect.withSpan("LockfileReader.parse.pnpm", {
   attributes: { "workspace.lockfile": lockfilePath },
  }),
 );
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/pnpm.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/pnpm.ts
git commit -m "feat(observability): add span and logging to pnpm parser"
```

---

### Task 10: Add span and logging to npm parser

**Files:**

- Modify: `src/layers/parsers/npm.ts`

**Context:** Same pattern as pnpm. Add span + Debug log.

- [ ] **Step 1: Add span and Debug log**

Add a Debug log before `return toLockfileData(validated)` and pipe with
`Effect.withSpan`:

```typescript
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

  const validated = yield* Schema.decodeUnknown(NpmLockfileRaw)(raw).pipe(
   Effect.mapError(
    (e) =>
     new LockfileParseError({
      lockfilePath,
      format: "npm",
      cause: e,
     }),
   ),
  );

  const workspaceCount = Object.values(validated.packages).filter((p) => p.link === true).length;
  yield* Effect.logDebug("Parsed npm lockfile").pipe(
   Effect.annotateLogs({
    "workspace.workspaces.count": workspaceCount,
    "workspace.packages.count": Object.keys(validated.packages).length,
   }),
  );

  return toLockfileData(validated);
 }).pipe(
  Effect.withSpan("LockfileReader.parse.npm", {
   attributes: { "workspace.lockfile": lockfilePath },
  }),
 );
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/npm.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/npm.ts
git commit -m "feat(observability): add span and logging to npm parser"
```

---

### Task 11: Add span and logging to yarn parser

**Files:**

- Modify: `src/layers/parsers/yarn.ts`

**Context:** The yarn parser uses `Effect.gen` with two passes. Add span +
Debug log.

- [ ] **Step 1: Add span and Debug log**

Add a Debug log before the final `return new LockfileData(...)` and pipe with
`Effect.withSpan`. The workspace count is `workspaceNames.size` and the
package count is `packages.length`:

```typescript
export const parseYarnLockfile = (
 content: string,
 lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
 Effect.gen(function* () {
  // ... existing YAML parse and two-pass logic (unchanged) ...

  const wsDeps = extractWorkspaceDeps(workspaceEntries, workspaceNames);

  yield* Effect.logDebug("Parsed yarn lockfile").pipe(
   Effect.annotateLogs({
    "workspace.workspaces.count": workspaceNames.size,
    "workspace.packages.count": packages.length,
   }),
  );

  return new LockfileData({
   packageManager: "yarn",
   lockfileVersion,
   packages,
   workspaceDependencies: [...wsDeps],
  });
 }).pipe(
  Effect.withSpan("LockfileReader.parse.yarn", {
   attributes: { "workspace.lockfile": lockfilePath },
  }),
 );
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/yarn.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/yarn.ts
git commit -m "feat(observability): add span and logging to yarn parser"
```

---

### Task 12: Add span and logging to bun parser

**Files:**

- Modify: `src/layers/parsers/bun.ts`

**Context:** Same pattern. Add span + Debug log.

- [ ] **Step 1: Add span and Debug log**

Add a Debug log before `return toLockfileData(lockfile)` and pipe with
`Effect.withSpan`:

```typescript
export const parseBunLockfile = (
 content: string,
 lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
 Effect.gen(function* () {
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

  const lockfile = yield* Schema.decodeUnknown(BunLockfileRawSchema)(parsed).pipe(
   Effect.mapError(
    (e) =>
     new LockfileParseError({
      lockfilePath,
      format: "bun",
      cause: e,
     }),
   ),
  );

  const workspaceCount = lockfile.workspaces ? Object.keys(lockfile.workspaces).length - 1 : 0;
  yield* Effect.logDebug("Parsed bun lockfile").pipe(
   Effect.annotateLogs({
    "workspace.workspaces.count": Math.max(0, workspaceCount),
    "workspace.packages.count": Object.keys(lockfile.packages ?? {}).length,
   }),
  );

  return toLockfileData(lockfile);
 }).pipe(
  Effect.withSpan("LockfileReader.parse.bun", {
   attributes: { "workspace.lockfile": lockfilePath },
  }),
 );
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/parsers/bun.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/layers/parsers/bun.ts
git commit -m "feat(observability): add span and logging to bun parser"
```

---

### Task 13: Add trace logging to integrity checker

**Files:**

- Modify: `src/layers/integrity.ts`

**Context:** The integrity checker has two places where it silently skips
entries: workspace specifiers and unparseable constraints. Add Trace logs to
both.

- [ ] **Step 1: Add Trace log for skipping workspace specifiers**

In `checkConstraints`, after `if (isWorkspaceSpecifier(constraint)) continue`:

```typescript
for (const [depName, constraint] of Object.entries(depMap)) {
 if (isWorkspaceSpecifier(constraint)) {
  yield* Effect.logTrace("Skipping workspace specifier").pipe(
   Effect.annotateLogs({
    "workspace.package": depName,
    constraint,
   }),
  );
  continue;
 }
```

- [ ] **Step 2: Add Trace log for unparseable constraints**

After the `if (Exit.isFailure(rangeExit) || Exit.isFailure(versionExit))`
check:

```typescript
if (Exit.isFailure(rangeExit) || Exit.isFailure(versionExit)) {
 yield* Effect.logTrace("Skipping unparseable constraint").pipe(
  Effect.annotateLogs({
   "workspace.package": depName,
   constraint,
   resolved: resolved ?? "unknown",
  }),
 );
 continue;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run src/layers/integrity.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/layers/integrity.ts
git commit -m "feat(observability): add Trace logging to integrity checker"
```

---

## Chunk 6: Final verification

### Task 14: Full verification pass

- [ ] **Step 1: Run full test suite**

```bash
pnpm run test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
pnpm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Run lint**

```bash
pnpm run lint:fix
```

Expected: No unfixable errors.
