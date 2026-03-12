---
title: "Code Review Findings — Phase 1/2 Audit"
module: core
category: review
status: current
created: 2026-03-12
updated: 2026-03-12
authors:
  - C. Spencer Beggs
tags:
  - code-review
  - bugs
  - improvements
---

## Code Review Findings — Phase 1/2 Audit

Automated code review of Phase 1 and Phase 2 implementation. Issues
ranked by confidence and severity.

## Critical Issues

### 1. WorkspaceDiscoveryLive — process.cwd() hardcoded (confidence: 95%)

`discoverPackages()` calls `rootService.find(process.cwd())` which:

- Locks all `listPackages()` calls to the process working directory
- Bypasses Effect platform abstraction (direct Node.js global)
- Cannot support CLI `--cwd` flags or non-Node runtimes
- Cache is keyed implicitly on first call's cwd

**Fix**: Accept `cwd` as parameter to `listPackages()` or at layer
construction via config. Key cache on resolved root path.

**Impact**: Service interface change required. Phase 3 ChangeDetector
needs this fixed to support arbitrary working directories.

### 2. WorkspaceDiscoveryLive — getPackage swallows WorkspaceDiscoveryError (confidence: 95%)

```typescript
const packages = yield* discoverPackages().pipe(
  Effect.catchTag("WorkspaceDiscoveryError", () =>
    Effect.succeed([] as ReadonlyArray<WorkspacePackage>)),
);
```

When discovery fails (malformed config, unreadable file), `getPackage`
reports `PackageNotFoundError` with `available: []`. The real error is
lost. Callers cannot distinguish "package doesn't exist" from "discovery
completely failed."

**Fix**: Remove `catchTag`. Let `WorkspaceDiscoveryError` propagate.
Update service interface to `Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>`.

### 3. WorkspaceDiscoveryLive — `/**` glob treated as `/*` (confidence: 90%)

`resolvePattern` treats `packages/**` same as `packages/*` — single-level
`readDirectory` only. Yarn Berry and some npm setups use `/**` for
recursive matching. Nested packages (e.g., `packages/utils/string`) are
silently missed.

**Fix**: Implement recursive traversal for `/**` patterns, or reject
with specific error.

## Important Issues

### 4. CRLF line endings in pnpm-workspace.yaml (confidence: 85%)

`parsePnpmWorkspacePatterns` splits on `\n` only. Windows CRLF files
retain `\r` in trimmed values, causing `"packages:\r" !== "packages:"`
check to fail silently.

**Fix**: `content.replace(/\r\n/g, "\n").split("\n")`.

### 5. JSON.parse without try/catch in readWorkspacePackage (confidence: 88%)

`JSON.parse(content)` at line 205 throws synchronous `SyntaxError` inside
`Effect.gen`. Effect catches this as a defect (not typed error). Callers
cannot use `Effect.catchTag("WorkspaceDiscoveryError", ...)`.

**Fix**: Wrap in `Effect.try({ try: () => JSON.parse(content), catch: ... })`.

### 6. DiscoveryLive — WorkspaceRootLive instantiated twice (confidence: 90%)

```typescript
Layer.mergeAll(
  WorkspaceRootLive,
  PackageManagerDetectorLive,
  WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive)),
)
```

Two independent `WorkspaceRootLive` instances. Currently harmless
(stateless) but prevents Effect's layer memoization.

**Fix**: Use `Layer.provide` on the composite to thread shared deps.

### 7. WorkspacePackage missing peerDependencies (confidence: 85%)

`PackageJsonSchema` includes `peerDependencies` but `WorkspacePackage`
does not. Phase 2 DependencyGraph ignores peer deps silently.

**Fix**: Add `peerDependencies` field to `WorkspacePackage` with same
`optionalWith` + empty default pattern.

### 8. PackageJsonParseError never thrown (confidence: 85%)

`PackageJsonParseError` is defined and exported but never used.
`readWorkspacePackage` maps JSON parse failures to
`WorkspaceDiscoveryError` instead, conflating infrastructure and data
errors.

**Fix**: Use `PackageJsonParseError` for malformed package.json.

### 9. WORKSPACE_MARKERS naming (confidence: 85%)

Only contains `["pnpm-workspace.yaml"]` but name implies multiple
markers. npm/yarn/bun detection uses separate code path.

**Fix**: Rename to `PNPM_MARKERS` or consolidate into strategy array.

### 10. PM detection without workspace validation (confidence: 85%)

`PackageManagerDetectorLive.detect()` can return a PM type for
non-workspace repos. No guard that the path is actually a workspace root.

**Fix**: Document that `detect()` should only be called on paths from
`find()`, or add workspace config validation.

## Prioritization for Future Iterations

**Fixed (iteration 5)**:

- Issue 1 (process.cwd) — FIXED: Root resolved eagerly at layer construction
- Issue 2 (swallowed errors) — FIXED: WorkspaceDiscoveryError propagates from getPackage
- Issue 4 (CRLF) — FIXED: parsePnpmWorkspacePatterns now normalizes CRLF
- Issue 5 (JSON.parse) — FIXED: Wrapped in Effect.try with typed error
- Issue 6 (double WorkspaceRootLive) — FIXED: Integration test uses mock root

**Should fix soon**:

- Issue 3 (`/**` glob) — affects Yarn Berry users
- Issue 7 (peerDependencies) — Phase 2 graph completeness

**Nice to have**:

- Issues 8, 9, 10 — structural improvements
