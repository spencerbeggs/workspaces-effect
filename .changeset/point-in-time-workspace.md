---
"workspaces-effect": major
---

## Breaking Changes

### Point-in-Time Workspace Reading

`workspaces-effect` gains a git-aware point-in-time reading engine. This is a
major version because it changes the library's identity from "read the
current working tree" to "read the working tree as of any moment" — the new
service reshapes how catalog and package state flow through the library, and
existing consumers should review the catalog precedence note below before
upgrading.

- **`PointInTimeWorkspace`** — a new service with two methods:
  - `at(ref, options?)` — workspace packages and catalogs as they existed at
    any git ref (SHA, branch, tag), read via `git show`/`git ls-tree` over
    `CommandExecutor` without checking the ref out. Workspace `!` negation
    patterns are honored identically to live discovery. Snapshots are cached
    per `(resolved root, ref)` in a capacity-bounded cache (64 entries, LRU);
    failed reads are never cached.
  - `worktree(options?)` — the same shape for the live working tree, via
    `WorkspaceDiscovery`.

  Both take `options.cwd` as a starting directory for workspace-root
  resolution (the root is found by walking up, matching `WorkspaceDiscovery`)
  and return a `WorkspaceStateSnapshot`. `at` fails with `PointInTimeAtError`
  (`GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError`) and
  `worktree` with `PointInTimeWorktreeError` (`CatalogAssemblyError |
  WorkspaceRootNotFoundError | WorkspaceDiscoveryError`); the umbrella
  `PointInTimeReadError` union remains exported. Wired into
  `WorkspacesFullLive` — no extra layer wiring required for consumers already
  on the full composite.

- **`CatalogSet`** — a pure, immutable value object for catalog assembly and
  resolution, extracted so `PointInTimeWorkspace` and `CatalogResolver` share
  one resolution semantic. `CatalogSet.fromWorkspaceYaml`,
  `CatalogSet.fromLockfileCatalogs`, and `CatalogSet.merge` build a set from
  inline `pnpm-workspace.yaml` catalogs and lockfile `catalogs:` entries
  (the lockfile record also carries config-dependency-injected catalogs,
  which is how they reach historical snapshots); `resolveSpecifier` resolves
  a `catalog:` specifier against it.

- **`WorkspaceStateSnapshot`** — packages plus an assembled `CatalogSet` for
  one moment in time. `resolve(dependency, specifier)` answers "what did this
  specifier mean here" — `catalog:` against the snapshot's catalogs,
  `workspace:` against the snapshot's package versions.

- **`GitReadError`** and the internal `GitReader` (`git cat-file`/`git show`/
  `git ls-tree` over `CommandExecutor`) support the above. Every git command
  pins `LC_ALL=C` and carries a 30-second timeout surfaced as `GitReadError`;
  a path absent at the ref is a skip, never an error.
  `workspaceManifestFromYaml` parses `pnpm-workspace.yaml` text independent
  of the filesystem, useful for parsing a ref's manifest without checking it
  out.

**Usage:**

```typescript
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { PointInTimeWorkspace, WorkspacesFullLive } from "workspaces-effect";

const program = Effect.gen(function* () {
  const pointInTime = yield* PointInTimeWorkspace;

  const atMainTip = yield* pointInTime.at("main");
  const live = yield* pointInTime.worktree();

  const before = atMainTip.package("my-lib");
  const after = live.package("my-lib");
  // compare `before`/`after` versions and dependency specifiers, or
  // resolve a specifier as it existed at that ref:
  const resolved = atMainTip.resolve("effect", "catalog:default");
});

Effect.runPromise(
  program.pipe(
    Effect.provide(WorkspacesFullLive),
    Effect.provide(NodeContext.layer),
  ),
);
```

**Migration note:** `CatalogResolverLive` is rebuilt over the same
worktree-catalog pipeline that powers `worktree()` snapshots. Catalog
precedence is unchanged: lockfile, then inline `pnpm-workspace.yaml`, then
config-dependency-injected catalogs (replayed from each plugin's installed
pnpmfile `updateConfig` hook — injected entries win). Only `at(ref)`
snapshots read config-dependency catalogs from the lockfile record instead,
since hooks cannot be replayed for a historical ref. Three visible changes:
the layer no longer requires `LockfileReader`, the `CatalogResolverError`
union narrows to `CatalogAssemblyError | WorkspaceRootNotFoundError`, and a
`pnpm-lock.yaml` that exists but cannot be read now fails assembly with
`CatalogAssemblyError` instead of silently yielding no lockfile catalogs (a
missing lockfile still degrades gracefully).
