# WorkspacesLive Composite Layer Design Spec

## Goal

Replace the phase-specific composite layers (`DiscoveryLive`,
`ConfigurationLive`, `FullConfigLive`, `ChangeDetectionLive`) with two
top-level composite layers: `WorkspacesLive` (no git) and
`WorkspacesFullLive` (with git/change detection). Keep all individual
`*Live` layers for fine-grained composition.

## Motivation

Consumers currently assemble 3-4 composite layers plus individual layers
to get a working stack. The phase-specific composites were scaffolding
that mapped to implementation phases, not to meaningful consumer use
cases. Two composites — "everything without git" and "everything with
git" — cover the real usage patterns. Individual layers remain available
for consumers who need fine-grained control.

## Approach

Flat merge with explicit dependency threading. Each layer's internal
dependencies are wired with `Layer.provide` calls, making the dependency
graph readable and traceable. `WorkspacesFullLive` composes on top of
`WorkspacesLive` — no duplication. Layer memoization via reference
equality ensures shared layers instantiate once.

## Layer Definitions

### WorkspacesLive

Provides all services except ChangeDetector and PackageResolver.
Requires only platform dependencies.

```typescript
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
>
```

Wiring:

```typescript
export const WorkspacesLive = Layer.mergeAll(
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
```

### WorkspacesFullLive

Adds ChangeDetector and PackageResolver on top of WorkspacesLive.
Additionally requires `CommandExecutor` for git operations.

```typescript
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
>
```

Wiring:

```typescript
export const WorkspacesFullLive = Layer.mergeAll(
  WorkspacesLive,
  PackageResolverLive.pipe(
    Layer.provide(WorkspacesLive),
  ),
  ChangeDetectorLive.pipe(
    Layer.provide(PackageResolverLive),
    Layer.provide(WorkspacesLive),
  ),
);
```

## Files Modified

| File | Action | Responsibility |
| --- | --- | --- |
| `src/layers/WorkspacesLive.ts` | Create | WorkspacesLive + WorkspacesFullLive composite layers |
| `src/layers/WorkspacesLive.test.ts` | Create | Composition tests for both layers |
| `src/layers/DiscoveryLive.ts` | Delete | Replaced by WorkspacesLive |
| `src/layers/ConfigurationLive.ts` | Delete | Replaced by WorkspacesLive |
| `src/layers/ChangeDetectionLive.ts` | Delete | Replaced by WorkspacesFullLive |
| `src/index.ts` | Modify | Remove old composite exports, add WorkspacesLive + WorkspacesFullLive |
| `src/layers/integration.test.ts` | Modify | Update to use new composites |

Individual `*Live` layers remain exported for fine-grained composition.

## Consumer API

Before (simplified — actual usage required additional layer wiring):

```typescript
import {
  DiscoveryLive, DependencyGraphLive,
  FullConfigLive, ChangeDetectionLive
} from "@spencerbeggs/workspaces-effect";
import { NodeContext } from "@effect/platform-node";

Effect.runPromise(
  program.pipe(
    Effect.provide(ChangeDetectionLive),
    Effect.provide(DependencyGraphLive),
    Effect.provide(FullConfigLive),
    Effect.provide(NodeContext.layer),
  )
);
```

After:

```typescript
import { WorkspacesFullLive } from "@spencerbeggs/workspaces-effect";
import { NodeContext } from "@effect/platform-node";

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  )
);
```

## Error Handling

No new error types. Composite layers surface the union of constituent
layer errors:

- **WorkspacesLive**: `WorkspaceDiscoveryError | LockfileReadError | LockfileParseError`
- **WorkspacesFullLive**: same (ChangeDetector/PackageResolver have `never` error channels)

## Testing Strategy

**Composition tests** (`WorkspacesLive.test.ts`):

- Provide `WorkspacesLive` + mock platform deps, yield each service tag
  to verify resolution
- Provide `WorkspacesFullLive` + mock platform deps + CommandExecutor,
  yield ChangeDetector and PackageResolver to verify resolution

**Integration test updates** (`integration.test.ts`):

- The existing integration tests don't import the deleted composite
  layers directly — they manually compose individual layers. The only
  change needed is renaming the `describe("DiscoveryLive composite
  layer")` block to reflect the new `WorkspacesLive` naming.

No new service logic — this is pure composition. Individual layer tests
remain unchanged.

## Breaking Changes

Removes four named exports: `DiscoveryLive`, `ConfigurationLive`,
`FullConfigLive`, and `ChangeDetectionLive`. This is acceptable for a
pre-1.0 package with squash-merge workflow.

## Dependencies

None. All APIs used (`Layer.mergeAll`, `Layer.provide`) are core Effect.
