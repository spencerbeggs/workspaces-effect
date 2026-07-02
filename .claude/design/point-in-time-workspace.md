---
title: "Point-in-time workspace design"
module: core
category: architecture
status: current
completeness: 90
created: 2026-07-01
updated: 2026-07-01
last-synced: 2026-07-01
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
- [Value objects](#value-objects)
- [Git reader](#git-reader)
- [Rationale](#rationale)
- [Testing](#testing)

<!-- /TOC -->

## Overview

`PointInTimeWorkspace` answers "what did this workspace look like at that moment" — for any git ref, without checking the ref out, or for the live working tree. Each answer is a `WorkspaceStateSnapshot` carrying that moment's packages plus its assembled pnpm catalog set, so `catalog:`/`workspace:` specifiers resolve against the state as it existed *then*, not against the current tree. Primary consumer scenario: diffing declared versions and resolved specifiers between a ref and the worktree (release tooling, change analysis).

## Current State

Shipped on `feat/catalog-point-in-time` for the 2.0.0 release: the `PointInTimeWorkspace` service and `PointInTimeWorkspaceLive` layer (wired into `WorkspacesFullLive` only), the `CatalogSet` and `WorkspaceStateSnapshot`/`PackageStateSnapshot` value objects, `GitReadError` and the internal `GitReader`. `CatalogResolverLive` was rebuilt over `CatalogSet` in the same release with unchanged public behavior (see `phase4-configuration-lockfiles.md`).

## Service surface

The tag lives in `src/services/PointInTimeWorkspace.ts` with two methods: `at(ref, cwd?)` and `worktree(cwd?)`. Both return `WorkspaceStateSnapshot` and fail with the exported `PointInTimeReadError` union (`GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError`); see the source for signatures and per-variant semantics. The live layer is `PointInTimeWorkspaceLive` (`src/layers/PointInTimeWorkspaceLive.ts`), wired into `WorkspacesFullLive` only — `at` needs `CommandExecutor`, so the service does not belong in the git-free `WorkspacesLive`.

## Data flow topology

- `at(ref)` — resolves the workspace root (`WorkspaceRoot`), then reads `pnpm-workspace.yaml`, `pnpm-lock.yaml` and each package's `package.json` at the ref through the internal `GitReader` (`git show`/`git ls-tree` over `CommandExecutor`). Package directories come from expanding the manifest's `packages:` globs against `ls-tree` listings.
- `worktree()` — enumerates live packages via `WorkspaceDiscovery.listPackages` and reads the on-disk `pnpm-workspace.yaml`/`pnpm-lock.yaml` via `FileSystem`.
- Both paths assemble catalogs through the same value objects: `workspaceManifestFromYaml` (pure text parser in `src/layers/catalog/workspace-manifest.ts`, extracted from the filesystem-bound `readWorkspaceManifest`) and `CatalogSet` (`src/schemas/CatalogSet.ts`).

All dependencies (`WorkspaceRoot`, `WorkspaceDiscovery`, `CommandExecutor`, `FileSystem`, `Path`) are resolved at layer construction so both methods have `R = never`, per the standard convention.

## Value objects

- `CatalogSet` (`src/schemas/CatalogSet.ts`) — a pure, immutable `Schema.Class` wrapping normalized catalogs, extracted so `PointInTimeWorkspace` and `CatalogResolver` share one resolution semantic. Constructors cover the catalog sources (`fromWorkspaceYaml`, `fromLockfileCatalogs`, `fromCatalogs`) plus `merge` (later sets win per dependency); `resolveSpecifier` resolves a single `catalog:` specifier. `CatalogResolverLive` now routes lockfile-catalog normalization through `CatalogSet.fromLockfileCatalogs` instead of hand-rolling it.
- `WorkspaceStateSnapshot` / `PackageStateSnapshot` (`src/schemas/WorkspaceStateSnapshot.ts`) — packages plus a `CatalogSet` for one moment. `resolve(dependency, specifier)` dispatches `workspace:` against the snapshot's package versions and `catalog:` against the snapshot's catalogs; `package(name)` and the `versions` getter support comparisons.

These are load-bearing public exports: snapshots from different moments are compared by consumers, so their shapes must stay stable.

## Git reader

`src/layers/point-in-time/git.ts` is the internal (not exported) low-level reader: `show(cwd, ref, path)` and `lsTree(cwd, ref, prefix)` over `CommandExecutor`. Two decisions matter:

- **Absent path degrades to `Option.none`, never an error.** Every "not there" stderr shape — including ambiguous ones like `unknown revision` and `bad object` — is treated as path-absent for `show`, because callers validate the ref before reading files at it (mirrors silk-effects' `runGitShow`). Anything else fails as `GitReadError`.
- **Stdout/stderr are drained concurrently with awaiting the exit code.** Collecting output only after `exitCode` resolves races the OS closing the pipes and can lose stdout entirely.

## Rationale

- **Read git objects, never check out.** `at(ref)` uses `git show`/`git ls-tree`; no temp worktrees, no mutation of the consumer's checkout.
- **Skip-not-fail package reads at a ref.** A `package.json` absent at the ref, unparseable or missing `name` is skipped, and `version` defaults to `"0.0.0"` — historical trees are not held to the live discovery contract (which requires `version` and fails on parse errors). A snapshot should degrade, not explode, on imperfect history.
- **Glob expansion at a ref is deliberately minimal.** Literal directories pass through; a single trailing wildcard segment expands via `ls-tree` of the parent; `/**` collapses to `/*`. The root (`.`) is always included. This parallels the live recursive-glob limitation (issue #62, `code-review-findings.md`).
- **Catalog precedence is lockfile-then-inline (inline wins)**, matching `CatalogResolver`. Snapshots do **not** replay config-dependency `pnpmfile` hooks at a ref — hook code at an arbitrary ref is neither installed nor trustworthy — so config-dependency-injected catalogs reach a snapshot only through the lockfile record. A malformed lockfile degrades to an empty catalog set; a malformed `pnpm-workspace.yaml` fails with `CatalogAssemblyError`.
- **Caching:** `at` snapshots are cached per `(resolved root, ref)` in a per-layer `Map`, treating refs as immutable — a moving branch ref read twice through one layer instance returns the first read (rebuild the layer or pass the SHA to bypass). `worktree` is uncached because the tree can change between calls.

## Testing

Unit tests: `__test__/layers/PointInTimeWorkspaceLive.test.ts`, `__test__/layers/point-in-time/git.test.ts` (mock `CommandExecutor` covering the ambiguous stderr shapes), `__test__/schemas/CatalogSet.test.ts`, `__test__/schemas/WorkspaceStateSnapshot.test.ts`, `__test__/errors/GitReadError.test.ts`.
