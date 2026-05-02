---
"workspaces-effect": minor
---

## Performance

### Defer I/O in `LockfileReaderLive` and `WorkspaceDiscoveryLive`

Moves all filesystem I/O out of the `Layer.effect` constructors and into the
service methods, memoized per layer instance via `Effect.cached`. Layer
construction is now O(1); the workspace root walk, package-manager detection,
lockfile read, and lockfile parse are paid on the first method call rather
than every time a fresh layer is composed.

Consumers that build a layer per call site — Vitest reporters with multiple
projects, CLIs that compose layers per subcommand, tests that swap layers
between cases — no longer pay the eager initialization cost N times.
Downstream `vitest-agent-reporter` measured a 10× wall-clock improvement
(44s → 4.3s) on a five-project monorepo by switching to the lighter slice
that was the workaround for this issue.

Closes #60.

## Breaking Changes

### `LockfileReader` service errors surface from method calls

Errors that previously failed `Layer.provide(LockfileReaderLive)` now surface
from the first invocation of `readLockfile`, `resolvedVersion`,
`workspaceDependencies`, or `checkIntegrity`. The error union exposed by these
methods has been widened to a new exported `LockfileInitError` alias:

```ts
type LockfileInitError =
  | WorkspaceRootNotFoundError
  | PackageManagerDetectionError
  | LockfileReadError
  | LockfileParseError;
```

Programs that previously relied on construction-time failure should move their
error handling to the call site. Programs that already wrapped a method call
in `Effect.runPromise` will continue to see failures, just routed through the
program's error channel rather than the layer's.
