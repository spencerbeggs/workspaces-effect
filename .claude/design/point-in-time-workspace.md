---
title: "Point-in-time workspace design"
module: core
category: architecture
status: current
completeness: 90
created: 2026-07-01
updated: 2026-07-02
last-synced: 2026-07-02
related:
  - architecture.md
  - phase3-change-detection.md
  - phase4-configuration-lockfiles.md
  - effect-patterns-core.md
  - code-review-findings.md
authors:
  - C. Spencer Beggs
tags:
  - point-in-time
  - git
  - catalogs
  - snapshots
---

## Point-in-time workspace design

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Service surface](#service-surface)
- [Data flow topology](#data-flow-topology)
- [Shared cores](#shared-cores)
- [Value objects](#value-objects)
- [Git reader](#git-reader)
- [Rationale](#rationale)
- [Testing](#testing)

<!-- /TOC -->

## Overview

`PointInTimeWorkspace` answers "what did this workspace look like at that moment" — for any git ref, without checking the ref out, or for the live working tree. Each answer is a `WorkspaceStateSnapshot` carrying that moment's packages plus its assembled pnpm catalog set, so `catalog:`/`workspace:` specifiers resolve against the state as it existed *then*, not against the current tree. Primary consumer scenario: diffing declared versions and resolved specifiers between a ref and the worktree (release tooling, change analysis).

## Current State

Shipped on `feat/catalog-point-in-time` for the 2.0.0 release: the `PointInTimeWorkspace` service and `PointInTimeWorkspaceLive` layer (wired into `WorkspacesFullLive` only), the `CatalogSet` and `WorkspaceStateSnapshot`/`PackageStateSnapshot` value objects, `GitReadError` and the internal `GitReader`. `CatalogResolverLive` was rebuilt over `CatalogSet` in the same release with unchanged public behavior (see `phase4-configuration-lockfiles.md`).

Hardened on `feat/point-in-time-hardening` (stacked on that branch): both discovery producers now compile workspace globs through one shared core, the worktree catalog read collapsed into one shared pipeline that `CatalogResolverLive` overlays (dropping its `LockfileReader` dependency and narrowing `CatalogResolverError`), the `GitReader` gained a `cat-file -e` existence probe with locale pinning and timeouts, the at-ref cache became a bounded effect `Cache` and snapshots memoize their name/version indexes.

## Service surface

The tag lives in `src/services/PointInTimeWorkspace.ts` with two methods: `at(ref, options?)` and `worktree(options?)`, both taking `PointInTimeOptions`. `options.cwd` is a starting directory for workspace-root resolution — the root is found by walking UP from it (`workspaceRoot.find(cwd ?? process.cwd())`), the same semantics as `WorkspaceDiscovery`; it is not the root itself. Both methods return `WorkspaceStateSnapshot`; each fails with its own exported union — `PointInTimeAtError` (`at` never enumerates the live filesystem, so no `WorkspaceDiscoveryError`) and `PointInTimeWorktreeError` (`worktree` never invokes git, so no `GitReadError`) — and the umbrella `PointInTimeReadError` union of the two is retained for consumers handling either method uniformly. See the source for per-variant semantics. The live layer is `PointInTimeWorkspaceLive` (`src/layers/PointInTimeWorkspaceLive.ts`), wired into `WorkspacesFullLive` only — `at` needs `CommandExecutor`, so the service does not belong in the git-free `WorkspacesLive`.

## Data flow topology

- `at(ref)` — resolves the workspace root (`WorkspaceRoot`), then reads `pnpm-workspace.yaml`, `pnpm-lock.yaml` and each package's `package.json` at the ref through the internal `GitReader` (`git show`/`git ls-tree` over `CommandExecutor`). Package directories come from compiling the manifest's `packages:` globs through the shared glob core (below) and matching them against `ls-tree` listings.
- `worktree()` — enumerates live packages via `WorkspaceDiscovery.listPackages` and reads catalogs through the shared worktree-catalog pipeline (below), taking its merged set.
- Both paths assemble catalogs through the same value objects: `workspaceManifestFromYaml` (pure text parser in `src/layers/catalog/workspace-manifest.ts`, extracted from the filesystem-bound `readWorkspaceManifest`) and `CatalogSet` (`src/schemas/CatalogSet.ts`).

All dependencies (`WorkspaceRoot`, `WorkspaceDiscovery`, `CommandExecutor`, `FileSystem`, `Path`) are resolved at layer construction so both methods have `R = never`, per the standard convention.

## Shared cores

Two internal modules exist so that behavior which used to be duplicated has exactly one home. Both carry "do not add a second copy" contracts.

- **Glob core** — `compileWorkspaceGlobs` (`src/layers/discovery/glob-core.ts`) is the single compilation path for workspace `packages:` patterns, consumed by `WorkspaceDiscoveryLive` (filesystem enumeration) and `PointInTimeWorkspaceLive.at` (`ls-tree` enumeration), so live and at-ref pattern semantics cannot drift. Negation (`!`) patterns exclude candidate directories by pattern match, not by re-resolving them against the source. The one-level wildcard limitation (issue #62 — a trailing `/**` collapses to `/*`) lives in this file and nowhere else. Documented exception: `src/sync.ts` retains an independent synchronous glob resolver because the sync API must stay free of Effect internals — a drift risk; changes to glob semantics must be mirrored there by hand.
- **Worktree-catalog pipeline** — `readWorktreeCatalogState` (`src/layers/point-in-time/worktree-catalogs.ts`) is the only reader of the working tree's catalog sources (`pnpm-workspace.yaml` plus `pnpm-lock.yaml`). It returns the decomposed state (inline, lockfile, merged, config dependencies): `worktree()` takes the merged set; `CatalogResolverLive` re-composes with a config-dependency hook-replay overlay, seeding the `updateConfig` hooks with the inline set. `CatalogResolverLive` therefore no longer depends on `LockfileReader`, and `CatalogResolverError` narrowed to `CatalogAssemblyError | WorkspaceRootNotFoundError`. Failure semantics: a missing (NotFound) or malformed lockfile degrades to empty lockfile catalogs, but any other lockfile read failure (permissions, I/O) fails with `CatalogAssemblyError` rather than being masked as "no lockfile". The remaining asymmetry between snapshots and the resolver is one line: hook replay is an overlay only the live resolver applies by default.

## Value objects

- `CatalogSet` (`src/schemas/CatalogSet.ts`) — a pure, immutable `Schema.Class` wrapping normalized catalogs, extracted so `PointInTimeWorkspace` and `CatalogResolver` share one resolution semantic. Constructors cover the catalog sources (`fromWorkspaceYaml`, `fromLockfileCatalogs`, `fromCatalogs`) plus `merge` (later sets win per dependency); `resolveSpecifier` resolves a single `catalog:` specifier. `CatalogResolverLive` now routes lockfile-catalog normalization through `CatalogSet.fromLockfileCatalogs` instead of hand-rolling it.
- `WorkspaceStateSnapshot` / `PackageStateSnapshot` (`src/schemas/WorkspaceStateSnapshot.ts`) — packages plus a `CatalogSet` for one moment. `resolve(dependency, specifier)` dispatches `workspace:` against the snapshot's package versions and `catalog:` against the snapshot's catalogs; `package(name)` and the `versions` getter support comparisons. The `versions` map and the `package(name)` index are lazy, instance-cached in `#`-private fields — snapshots are immutable value objects, so computing once per instance is safe, and the `#` fields sit outside the schema's declared fields (verified compatible with `Schema.Class` construction including the decode path; they never encode).

These are load-bearing public exports: snapshots from different moments are compared by consumers, so their shapes must stay stable.

A review suggestion to unify `CatalogSet.resolveSpecifier` with `CatalogResolver.resolveSpecifier` was declined — the divergence is deliberate. The value object is catalog-only and returns `Option.none` on unresolvable refs; the live service additionally handles `workspace:` and fails with a typed `CatalogResolutionError`. Both route through `resolveManifest`, which stays the single resolution semantic.

## Git reader

`src/layers/point-in-time/git.ts` is the internal (not exported) low-level reader: `show(cwd, ref, path)` and `lsTree(cwd, ref, prefix)` over `CommandExecutor`. `show` is a two-step protocol: a `git cat-file -e <ref>:<path>` existence probe, then `git show` only when the object exists. The decisions that matter:

- **Absent path degrades to `Option.none`, never an error.** Every "not there" stderr shape — including ambiguous ones like `unknown revision` and `bad object` — is treated as path-absent, because callers validate the ref before reading files at it (mirrors silk-effects' `runGitShow`). Anything else fails as `GitReadError`.
- **The `NOT_AT_REF` stderr regex remains the primary missing-path classifier despite the probe.** Empirically verified during review (git 2.54): `cat-file -e <ref>:<path>` exits 128 with a fatal message for the realistic missing-path-at-valid-ref case — exit 1 occurs only for raw nonexistent object hashes, a form the `<ref>:<path>` argument never produces — so probe failures are classified by the same regex as before. The probe's realized value is different: a `show` failure after a confirmed-exists probe is a hard `GitReadError`, never a skip.
- **`LC_ALL=C` is pinned on every command**, making the stderr regex locale-stable.
- **Every command runs under a configurable timeout (default 30s)**, surfacing as `GitReadError` on expiry.
- **Stdout/stderr are drained concurrently with awaiting the exit code.** Collecting output only after `exitCode` resolves races the OS closing the pipes and can lose stdout entirely.

Open design question: the probe doubles the process count per file read; a follow-up may drop it and rely on the regex classification alone.

## Rationale

- **Read git objects, never check out.** `at(ref)` uses `git show`/`git ls-tree`; no temp worktrees, no mutation of the consumer's checkout.
- **Skip-not-fail package reads at a ref.** A `package.json` absent at the ref, unparseable or missing `name` is skipped, and `version` defaults to `"0.0.0"` — historical trees are not held to the live discovery contract (which requires `version` and fails on parse errors). A snapshot should degrade, not explode, on imperfect history.
- **Glob expansion at a ref routes through the shared core** (see [Shared cores](#shared-cores)): literal directories pass through; each compiled wildcard lists its parent via `ls-tree` and keeps matches; negations remove matches by pattern. The root (`.`) is always included. The one-level `/**` limitation (issue #62, `code-review-findings.md`) is a property of the shared core, so it applies identically here and to live discovery.
- **Catalog precedence is lockfile-then-inline (inline wins)**, matching `CatalogResolver`. Hook replay is an overlay only the live resolver applies by default: snapshots never replay config-dependency `pnpmfile` hooks — at an arbitrary ref the hook code is neither installed nor trustworthy — so hook-injected catalogs reach a snapshot only through the lockfile record. A malformed lockfile degrades to an empty catalog set; a malformed `pnpm-workspace.yaml` fails with `CatalogAssemblyError`.
- **Bounded at-ref cache.** `at` snapshots are cached per `(resolved root, ref)` in a per-layer effect `Cache` (`Cache.makeWith`, capacity `AT_CACHE_CAPACITY` = 64), which bounds memory for long-lived processes and deduplicates concurrent in-flight lookups for the same key. The TTL is exit-dependent — infinity on success, zero on failure — because `Cache.make`'s single fixed TTL memoizes failures too (verified against effect 3.21), which would replay a stale error instead of retrying. This decision supersedes the PR-review suggestion to use Request/RequestResolver: in this repo that pattern exists for request batching (`DependencyGraph`, `LockfileReader`), not bounded caching. Refs are treated as immutable — a moving branch ref read twice through one layer instance returns the first read (rebuild the layer or pass the SHA to bypass). `worktree` is uncached because the tree can change between calls.
- **`relativePath` parity between producers is pinned by contract test.** `at(HEAD)` and `worktree()` must agree on `relativePath` for every package, including the root as `"."`. Both producers hardcode `"."` for the root independently — `WorkspaceDiscoveryLive` at its single root-construction site, `PointInTimeWorkspaceLive.at` in its directory seed. No drift existed when the test was added; it exists to keep it that way.

## Testing

Unit tests: `__test__/layers/PointInTimeWorkspaceLive.test.ts` (includes the `relativePath` producer-parity contract test), `__test__/layers/point-in-time/git.test.ts` (mock `CommandExecutor` covering the probe protocol and the ambiguous stderr shapes), `__test__/layers/point-in-time/at-cache.test.ts` (exercises the shipped `Cache.makeWith` construction and pins failure-retry), `__test__/layers/point-in-time/worktree-catalogs.test.ts`, `__test__/layers/discovery/glob-core.test.ts`, `__test__/schemas/CatalogSet.test.ts`, `__test__/schemas/WorkspaceStateSnapshot.test.ts` (memoization plus encode-path compatibility), `__test__/errors/GitReadError.test.ts`.
