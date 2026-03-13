# Observability Design Spec

## Goal

Add comprehensive tracing (spans) and structured logging to all service
methods across all 4 phases of workspaces-effect, using Effect's built-in
`Effect.withSpan` and `Effect.log*` APIs.

## Motivation

The architecture doc lists observability as design goal #7. Phases 1-3
have partial span coverage (7 methods) but no structured logging. Phase 4
has neither. Consumers need:

- **CI/CD pipeline tracing** -- OpenTelemetry spans exported to
  Datadog/Honeycomb/etc. to understand workspace discovery, lockfile
  parsing, and change detection timing
- **Library debugging** -- structured logs at tiered levels so consumers
  can diagnose issues by providing a Logger layer

Both are opt-in by design. Spans are no-ops without a tracer. Logs are
silent without a Logger layer.

## Approach

Inline spans and logs directly in each layer implementation file. No new
abstractions, no wrapper utilities, no decorator layers. This follows
the existing pattern in WorkspaceRootLive, PackageManagerDetectorLive,
WorkspaceDiscoveryLive, and ChangeDetectorLive.

## Supersedes

This spec covers the full observability surface. It adds new spans and
logging alongside existing ones. One existing attribute is normalized:
`WorkspaceDiscovery.getPackage` currently uses `package.name` -- this
work renames it to `workspace.package` for consistency with the
`workspace.*` namespace used everywhere else.

## Span Naming Convention

### Service methods

Pattern: `ServiceName.methodName`

```text
WorkspaceRoot.find
PackageManagerDetector.detect
WorkspaceDiscovery.listPackages
WorkspaceDiscovery.getPackage
DependencyGraph.dependenciesOf
DependencyGraph.dependentsOf
DependencyGraph.hasCycle
TopologicalSorter.sort
TopologicalSorter.sortSubset
TopologicalSorter.levels
ChangeDetector.changedFiles
ChangeDetector.changedPackages
ChangeDetector.affectedPackages
LockfileReader.resolvedVersion
LockfileReader.checkIntegrity
```

### Layer construction

Pattern: `ServiceName.construct`

```text
DependencyGraph.construct
TopologicalSorter.construct
PackageResolver.construct
LockfileReader.construct
```

### Parser spans

Pattern: `LockfileReader.parse.<pm>`

```text
LockfileReader.parse.pnpm
LockfileReader.parse.npm
LockfileReader.parse.yarn
LockfileReader.parse.bun
```

### Trivial methods excluded from spans

These are direct Map/Array lookups or pre-computed getters with no
meaningful duration:

- `DependencyGraph.packages`
- `DependencyGraph.adjacencyMap`
- `PackageResolver.packagePaths`
- `PackageResolver.resolveFile` -- in-memory sorted array scan
- `PackageResolver.resolveFiles` -- reduce over resolveFile
- `LockfileReader.readLockfile` -- returns pre-loaded lockfile data
- `LockfileReader.workspaceDependencies`

## Span Attributes

All attributes use the `workspace.*` namespace, consistent with existing
code.

| Attribute | Used on | Example |
| --- | --- | --- |
| `workspace.cwd` | WorkspaceRoot.find | `/Users/dev/project` |
| `workspace.root` | PackageManagerDetector.detect | `/Users/dev/project` |
| `workspace.package` | getPackage, dependenciesOf, etc. | `@my/app` |
| `workspace.pm` | LockfileReader.construct | `pnpm` |
| `workspace.lockfile` | LockfileReader.parse.* | `/project/pnpm-lock.yaml` |
| `workspace.packages.count` | listPackages, LockfileReader.construct | `15` |
| `workspace.deps.count` | dependenciesOf, dependentsOf | `5` |
| `workspace.files.count` | changedFiles | `42` |
| `workspace.base` | changedFiles | `main` |
| `workspace.head` | changedFiles | `HEAD` |

## Logging Convention

### Log levels

| Level | Use for | Example |
| --- | --- | --- |
| Info | Service boundary results | "Workspace root found" |
| Debug | Internal decisions, counts | "Parsed pnpm lockfile" |
| Trace | Per-item detail | "Skipping unparseable constraint" |

### Structured fields

Use `Effect.annotateLogs` to attach structured context alongside short
human-readable messages:

```typescript
yield* Effect.logInfo("Workspace root found").pipe(
  Effect.annotateLogs("workspace.root", root),
);

yield* Effect.logDebug("Parsed lockfile").pipe(
  Effect.annotateLogs({
    "workspace.pm": "pnpm",
    "workspace.packages.count": packages.length,
  }),
);

yield* Effect.logTrace("Skipping unparseable constraint").pipe(
  Effect.annotateLogs({
    "workspace.package": depName,
    constraint,
  }),
);
```

### Log placement by level

**Info** (service-level results):

- WorkspaceRoot.find -- root path found
- PackageManagerDetector.detect -- detected PM type
- WorkspaceDiscovery.listPackages -- package count
- ChangeDetector.changedFiles -- changed file count
- ChangeDetector.changedPackages -- changed package count
- ChangeDetector.affectedPackages -- affected package count
- LockfileReader.construct -- PM type and package count
- LockfileReader.checkIntegrity -- valid/invalid and issue count

**Debug** (internal counts and decisions):

- DependencyGraph.construct -- node and edge counts
- DependencyGraph.dependenciesOf -- dep count for queried package
- DependencyGraph.dependentsOf -- dependent count for queried package
- DependencyGraph.hasCycle -- result
- TopologicalSorter.sort -- sorted count
- TopologicalSorter.sortSubset -- subset size and sorted count
- TopologicalSorter.levels -- level count
- LockfileReader.resolvedVersion -- resolved version or none
- Each parser -- importer/workspace count and package count

**Trace** (per-item, high-volume):

- Integrity checking -- skipping workspace specifiers
- Integrity checking -- skipping unparseable constraints

## Full Method Inventory

| Service | Method | Has Span | Add Span | Add Log |
| --- | --- | --- | --- | --- |
| WorkspaceRoot | find | Yes | No | Info |
| PackageManagerDetector | detect | Yes | No | Info |
| WorkspaceDiscovery | listPackages | Yes | No | Info |
| WorkspaceDiscovery | getPackage | Yes | No | Debug |
| DependencyGraph | dependenciesOf | No | Yes | Debug |
| DependencyGraph | dependentsOf | No | Yes | Debug |
| DependencyGraph | packages | No | No | No |
| DependencyGraph | hasCycle | No | Yes | Debug |
| DependencyGraph | adjacencyMap | No | No | No |
| TopologicalSorter | sort | No | Yes | Debug |
| TopologicalSorter | sortSubset | No | Yes | Debug |
| TopologicalSorter | levels | No | Yes | Debug |
| PackageResolver | resolveFile | No | No | No |
| PackageResolver | resolveFiles | No | No | No |
| PackageResolver | packagePaths | No | No | No |
| ChangeDetector | changedFiles | Yes | No | Info |
| ChangeDetector | changedPackages | Yes | No | Info |
| ChangeDetector | affectedPackages | Yes | No | Info |
| LockfileReader | readLockfile | No | No | No |
| LockfileReader | resolvedVersion | No | Yes | Debug |
| LockfileReader | workspaceDependencies | No | No | No |
| LockfileReader | checkIntegrity | No | Yes | Info |

Layer construction spans to add:

- DependencyGraph.construct
- TopologicalSorter.construct
- PackageResolver.construct
- LockfileReader.construct

Parser spans to add:

- LockfileReader.parse.pnpm
- LockfileReader.parse.npm
- LockfileReader.parse.yarn
- LockfileReader.parse.bun

## Implementation Pattern

### Adding span + log to a service method

```typescript
dependenciesOf: (name: string) =>
  Effect.gen(function* () {
    const deps = graph.edges.get(name);
    if (deps === undefined) {
      return yield* Effect.fail(
        new PackageNotFoundError({ ... }),
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

### Adding span to a parser

```typescript
export const parsePnpmLockfile = (
  content: string,
  lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
  Effect.gen(function* () {
    // ... existing parsing code ...
    yield* Effect.logDebug("Parsed pnpm lockfile").pipe(
      Effect.annotateLogs({
        "workspace.importers.count":
          Object.keys(raw.importers).length,
        "workspace.packages.count": packages.length,
      }),
    );
    return toLockfileData(validated);
  }).pipe(
    Effect.withSpan("LockfileReader.parse.pnpm", {
      attributes: { "workspace.lockfile": lockfilePath },
    }),
  );
```

### Adding span to layer construction

```typescript
export const LockfileReaderLive = Layer.effect(
  LockfileReader,
  Effect.gen(function* () {
    // ... existing construction ...
    yield* Effect.logInfo(
      "Lockfile reader initialized",
    ).pipe(
      Effect.annotateLogs({
        "workspace.pm": pm,
        "workspace.packages.count":
          lockfileData.packages.length,
      }),
    );
    return { readLockfile, resolvedVersion, ... };
  }).pipe(
    Effect.withSpan("LockfileReader.construct"),
  ),
);
```

### Adding span via pipe (delegation methods)

For methods that delegate to a single call (e.g., `checkIntegrity`),
use `.pipe(Effect.withSpan(...))` instead of wrapping in `Effect.gen`:

```typescript
checkIntegrity: () =>
  checkLockfileIntegrity(lockfileData, root, fs, path).pipe(
    Effect.withSpan("LockfileReader.checkIntegrity"),
  ),
```

### Implementation notes

**`resolvedVersion` returns `Option`, not an error.** The current
implementation returns `Option.Option<ResolvedPackage>` -- it never
fails. The span and Debug log still provide value for tracing lookups,
but there is no error path to log.

**`resolveFile` and `resolveFiles` get no observability.** These are
in-memory array scans called per-file during change detection. Adding
spans or logs would produce excessive noise with no meaningful signal.

## Testing Strategy

No new test files. Spans and logs are transparent -- they do not change
inputs, outputs, or error behavior. The existing test suite covers all
service methods. If a span or log annotation introduces a type error or
runtime issue, the existing tests catch it.

Verification after each file change:

1. Full test suite passes
2. Typecheck passes
3. Build passes

## Dependencies

None. Effect's `Effect.withSpan`, `Effect.logInfo`, `Effect.logDebug`,
`Effect.logTrace`, and `Effect.annotateLogs` are all part of the core
`effect` package already in dependencies.

## Files Modified

No new files created. All changes are additions to existing layer and
parser files:

- `src/layers/WorkspaceRootLive.ts` -- add logging
- `src/layers/PackageManagerDetectorLive.ts` -- add logging
- `src/layers/WorkspaceDiscoveryLive.ts` -- add logging
- `src/layers/DependencyGraphLive.ts` -- add spans, logging,
  construction span
- `src/layers/TopologicalSorterLive.ts` -- add spans, logging,
  construction span
- `src/layers/PackageResolverLive.ts` -- add spans, logging,
  construction span
- `src/layers/ChangeDetectorLive.ts` -- add logging
- `src/layers/LockfileReaderLive.ts` -- add spans, logging,
  construction span
- `src/layers/parsers/pnpm.ts` -- add span, logging
- `src/layers/parsers/npm.ts` -- add span, logging
- `src/layers/parsers/yarn.ts` -- add span, logging
- `src/layers/parsers/bun.ts` -- add span, logging
- `src/layers/integrity.ts` -- add trace logging
