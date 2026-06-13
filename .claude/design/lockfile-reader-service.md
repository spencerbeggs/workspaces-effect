---
title: "LockfileReader and PublishabilityDetector service interfaces"
module: core
category: architecture
status: current
completeness: 90
created: 2026-03-12
updated: 2026-06-12
last-synced: 2026-06-12
authors:
  - C. Spencer Beggs
tags:
  - lockfile
  - service
related:
  - architecture.md
  - phase4-configuration-lockfiles.md
  - lockfile-schemas.md
  - effect-patterns-core.md
---

## LockfileReader and PublishabilityDetector service interfaces

These are the two pure-query services in the Configuration and Lockfiles group (Group 4). `LockfileReader` exposes a PM-agnostic view over the four lockfile formats; `PublishabilityDetector` decides where a workspace package would publish. Both are class-based `Context.Tag` services with tag identifiers under the `@spencerbeggs/workspaces-effect/` namespace. See `src/services/LockfileReader.ts` and `src/services/PublishabilityDetector.ts` for the authoritative interfaces.

## Overview

`LockfileReader` reads the lockfile for the detected package manager (npm, pnpm, yarn Berry or bun) once, parses it into the unified `LockfileData` model (see `lockfile-schemas.md`), and answers version, workspace-dependency and integrity queries against the parsed result. `PublishabilityDetector` is orthogonal: it reads `package.json` metadata rather than the lockfile and returns the registries a package would publish to.

## LockfileReader interface

The service tag lives in `src/services/LockfileReader.ts`. Its methods:

- `readLockfile()` returns the full parsed `LockfileData`.
- `resolvedVersion(name)` returns `Option.Option<ResolvedPackage>` — `Option.none()` for a package absent from the lockfile, not a failure.
- `workspaceDependencies()` returns the inter-workspace dependency links.
- `checkIntegrity()` returns a `LockfileIntegrity` report, failing only with `LockfileIntegrityError` on a critical mismatch.

`resolvedVersion` uses `Effect.request` with a per-layer `Request.makeCache` to deduplicate repeated lookups (see `effect-patterns-core.md`).

### Lazy initialization and LockfileInitError

`LockfileReaderLive` defers all I/O — workspace-root walk, package-manager detection, lockfile read and parse — to the first method call via `Effect.cached`, so layer construction is O(1) and the init work runs (and is memoized) once per layer instance. Because that work is deferred, the init failure modes surface from each method's `E` channel rather than from `Layer.provide`. They are exported as the `LockfileInitError` union from the package barrel:

```typescript
export type LockfileInitError =
  | WorkspaceRootNotFoundError
  | PackageManagerDetectionError
  | LockfileReadError
  | LockfileParseError;
```

Every method's `E` channel includes `LockfileInitError`; `checkIntegrity` additionally includes `LockfileIntegrityError`. The Layer `E` channel itself is `never`. See `architecture.md` for the cross-service lazy-init decision and `effect-patterns-core.md` for the `Effect.cached` pattern.

### Why a unified service rather than per-PM services

Each lockfile format is structurally different (YAML, JSON, JSONC, different key conventions), but consumers overwhelmingly want the same operations: what version is locked, what are the workspace dependencies, is the integrity valid. A unified interface with PM-specific parsing behind it mirrors `PackageManagerDetector` — one tag, multiple internal strategies. The per-PM parsers live in `src/layers/parsers/`.

### Why methods return Option or empty collections instead of failing

Lookups by user-provided key (`resolvedVersion`) return `Option` so that "not in the lockfile" is a value, not an error. Aggregate queries return empty collections for the same reason — "no catalogs configured" is a valid answer. Only `checkIntegrity` raises a domain error, and only for a genuine integrity violation.

## PublishabilityDetector interface

The service tag lives in `src/services/PublishabilityDetector.ts`. Its single method is `detect(pkg, root)`, returning `ReadonlyArray<PublishTarget>`. An empty array means the package is not publishable; the array otherwise describes each registry the package would publish to. The method never fails.

A package is publishable when `private` is not `true` and it has a `name` and `version`. Targets are derived from `publishConfig` and related `package.json` fields. `PublishTarget` is a `Schema.Class` in `src/schemas/publish.ts`.

### Why it is separate from LockfileReader

Publishability is a higher-level concern with a different data source. It reads `package.json` (via the already-discovered `WorkspacePackage`), not the lockfile, so it can be used in repos that do not commit a lockfile. Keeping it as its own tag also lets consumers swap in a custom layer for monorepos with non-standard publishing conventions. `PublishabilityDetectorLive` is a pure `Layer.succeed` with no dependencies.

## Layer wiring

`LockfileReaderLive` depends on `WorkspaceRoot` and `PackageManagerDetector`, and requires `FileSystem` and `Path` from `@effect/platform`. `PublishabilityDetectorLive` has no dependencies. Both ship inside the `WorkspacesLive` composite (and therefore `WorkspacesFullLive`); see `phase4-configuration-lockfiles.md` for the composite wiring and `architecture.md` for the canonical layer shapes.

## Testing

Mock `LockfileReader` directly with `Layer.succeed` for consumer tests. Exercise `LockfileReaderLive` against `FileSystem.layerNoop` plus `Path.layer` with fixture lockfile strings, and against the real fixtures under `__test__/integration/fixtures/`. See `effect-patterns-testing.md` for the filesystem-mocking and fixture conventions.
