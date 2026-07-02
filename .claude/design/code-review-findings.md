---
title: "Known limitations"
module: core
category: review
status: current
completeness: 80
created: 2026-03-12
updated: 2026-07-02
last-synced: 2026-07-02
related:
  - architecture.md
  - phase2-dependency-graph.md
  - phase3-change-detection.md
  - point-in-time-workspace.md
authors:
  - C. Spencer Beggs
tags:
  - code-review
  - limitations
---

## Known limitations

Tracks behavioral limitations that are known and intentional-for-now, so a contributor does not mistake them for bugs. Each entry points at where it lives and the tracking issue where one exists.

## Recursive glob patterns are treated as single-level

`compileWorkspaceGlobs` in `src/layers/discovery/glob-core.ts` normalizes a trailing `/**` to `/*`, so `packages/*` and `packages/**` are handled identically — a single-level enumeration of the base directory keeping entries that contain a `package.json`. A genuinely recursive `/**` pattern (used by some Yarn Berry and npm setups) therefore silently misses nested packages such as `packages/utils/string`. The limitation lives in that shared core (and so applies identically to live discovery in `WorkspaceDiscoveryLive` and at-ref discovery in `PointInTimeWorkspaceLive.at`); the independent sync-API resolver in `src/sync.ts` has the same single-level behavior. Fixing it requires recursive traversal for `/**` patterns or an explicit rejection. Tracked in [#62](https://github.com/spencerbeggs/workspaces-effect/issues/62).

## PackageManagerDetector does not validate that a path is a workspace root

`PackageManagerDetector.detect` can return a package-manager type for a directory that is not actually a workspace root. The contract is that `detect` is called on a path produced by `WorkspaceRoot.find`; it does not re-validate that the path holds workspace configuration. Callers that synthesize paths by other means must validate the root themselves.
