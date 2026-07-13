# workspaces-effect

`workspaces-effect` — an Effect-TS library for monorepo workspace
tooling. Supports npm, pnpm, yarn Berry, and Bun workspaces.

## Status

All phases complete plus WorkspacePackage enrichment (Issue #12) and the
CatalogResolver service. 514 tests passing (370 unit + 144 integration). Full
observability (spans + structured
logging at Debug level) across all services -- library is silent under
Effect's default logger; consumers opt in via
`Logger.withMinimumLogLevel(LogLevel.Debug)`. See README "Observability"
section. Request/RequestResolver with per-layer caching
for DependencyGraph and LockfileReader lookups. Integrity check works for all
4 package managers. Composite layers: WorkspacesLive (no git),
WorkspacesFullLive (with git). WorkspacePackage has peerDependencies,
optionalDependencies, packageJsonPath (stored Schema.NonEmptyString field,
computed at construction via Path.join in WorkspaceDiscoveryLive),
computed getters (isRootWorkspace, isPublic, scope, unscopedName,
allDependencies), instance methods + static
dual-API functions, DependencyDiff, readPackageJson utility.
ResolvedPackage has optional relativePath field for workspace-aware resolution.
WorkspaceDiscovery.importerMap() added. WorkspaceDiscovery.refresh() added
(branch feat/refresh-api): clears the per-resolved-root package cache so the
next listPackages/getPackage/importerMap re-reads each package.json from disk;
the resolved-root memo is preserved. See
`.claude/design/architecture.md` "Group 1: Discovery".
listPackages() now includes root
workspace (breaking change). PnpmExtension.catalogs accepts union type for
pnpm v9+ format (catalogs defined in pnpm-workspace.yaml in v10).
CatalogResolver service (Group 4) assembles a workspace's complete pnpm catalog set (inline pnpm-workspace.yaml catalogs, config-dependency-injected catalogs durably replayed from each plugin's installed pnpmfile updateConfig hook NOT the transient .pnpm-workspace-state-v1.json, and lockfile catalogs) and resolves catalog:/workspace: specifiers in a manifest; assembly = the shared `readWorktreeCatalogState` pipeline plus a hook-replay overlay (precedence unchanged); lazy Effect.cached; `CatalogResolverError = CatalogAssemblyError | WorkspaceRootNotFoundError` (resolve/resolveSpecifier add CatalogResolutionError); CatalogResolverLive no longer requires LockfileReader (needs WorkspaceRoot | WorkspaceDiscovery | FileSystem | Path); reuses @pnpm/catalogs.* primitives with a hand-rolled light hook loader (no @pnpm/config.reader), wired into WorkspacesLive (and thus WorkspacesFullLive). See `@.claude/design/architecture.md` Group 4 and `@.claude/design/phase4-configuration-lockfiles.md` "CatalogResolver Service".
PublishConfig is a Schema.Class with `tag` and `linkDirectory` fields
(PublishConfigSchema alias removed). DetectedPackageManager has `runtime`
field ("node" | "bun"). WorkspaceDiscoveryLive has standalone fallback
(returns root as single workspace when no config) and deduplicates root when
patterns include ".". resolvePattern errors on non-existent base directory.
readWorkspacePackage requires version field (no silent "0.0.0" default for
child packages). PublishTarget schema and shared parser utilities fully tested.
Sync API (`src/sync.ts`): `findWorkspaceRootSync` and
`getWorkspacePackagesSync` exported for non-Effect contexts (e.g., lint-staged
handlers); uses `node:fs`/`node:path` directly. `findWorkspaceRootSync` walks
up checking workspace markers first, then stops at the `.git` project
boundary -- returns the git-root directory when a `package.json` sits
alongside `.git` (single-package repo support), throws when it does not, and
returns `null` only when `cwd` is not inside any git project (Issue #103).
Lazy layer init (Issue #60): `LockfileReaderLive` and `WorkspaceDiscoveryLive`
defer all I/O via `Effect.cached`; layer construction is O(1), the
root-find/PM-detect/lockfile-read/parse/index-build runs once on first method
call. New exported `LockfileInitError` =
`WorkspaceRootNotFoundError | PackageManagerDetectionError | LockfileReadError | LockfileParseError`;
LockfileReader method signatures include `LockfileInitError` in their E
channels (breaking: previously construction-time failures only).
PointInTimeWorkspace service (2.0.0 major; hardened on branch feat/point-in-time-hardening): `at(ref, options?)` reads pnpm-workspace.yaml, pnpm-lock.yaml, and each package.json at any git ref via `git show`/`git ls-tree` over CommandExecutor (no checkout); `worktree(options?)` reads the live tree via WorkspaceDiscovery, uncached. Both take `PointInTimeOptions` (`cwd` walks UP to the workspace root via WorkspaceRoot.find; defaults to process.cwd()) and return WorkspaceStateSnapshot. Per-method error unions `PointInTimeAtError = GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError` and `PointInTimeWorktreeError = CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError`; umbrella `PointInTimeReadError` retained as their union. at-ref snapshots cached per (resolved root, ref) in a capacity-bounded effect `Cache.makeWith` (64 entries; failures not cached — zero TTL on failed exits). Wired into WorkspacesFullLive only (needs CommandExecutor), NOT WorkspacesLive. Shared cores: `compileWorkspaceGlobs` (`src/layers/discovery/glob-core.ts`) is the single glob-compilation path for WorkspaceDiscoveryLive AND at-ref reads, so at(ref) now honors `!` negations; `readWorktreeCatalogState` (`src/layers/point-in-time/worktree-catalogs.ts`) is the single worktree catalog reader (used by CatalogResolverLive and worktree()). Pure Schema.Class value objects: CatalogSet (statics empty/fromCatalogs/fromWorkspaceYaml/fromLockfileCatalogs/merge; instance resolveSpecifier/toCatalogs) and WorkspaceStateSnapshot/PackageStateSnapshot (`resolve()` answers catalog:/workspace: specifiers against the snapshot's own package versions and catalogs; plain or unresolvable → Option.none); snapshot `versions` and `package()` are memoized per instance. Internal GitReader (`src/layers/point-in-time/git.ts`, @internal): Option-based missing-path semantics (absent path at ref is Option.none, never an error), `cat-file -e` existence probe before `show`, `LC_ALL=C` pinned so the NOT_AT_REF stderr regex (still the primary missing-path classifier) sees untranslated messages, configurable timeout (default 30s) failing as GitReadError, concurrent stream draining. GitReadError added; `workspaceManifestFromYaml` + `WorkspaceManifestData` exported @public. Known limits: worktree() cannot see config-dependency edits not yet pnpm-installed; at(ref) glob expansion is one-level (matches #62). See `@.claude/design/point-in-time-workspace.md`.
Package-manager-aware workspace reads (2.1.0 minor; branch feat/pm-aware-workspace-reads): PackageManagerDetectorLive now reads `devEngines.packageManager` from the root package.json as its HIGHEST-priority signal, above lockfile/config-file presence (object and array forms accepted; when devEngines and the `packageManager` field name the same PM the field's exact pin supplies the version over devEngines' possible range; an unrecognized name falls through to the existing pnpm > bun > yarn > npm chain). PointInTimeWorkspace `at(ref)` and `worktree()` now read workspace globs AND catalogs from the root package.json `workspaces` field when there is no `pnpm-workspace.yaml` (`workspaces.catalog` -> the "default" catalog, `workspaces.catalogs[name]` -> catalog `name`); the reader is chosen by FILE PRESENCE, not PackageManagerDetector (nothing to detect against at a git ref, and it keeps the rule identical to WorkspaceDiscoveryLive.readWorkspacePatterns). Behavior change: a malformed root package.json in a repo with no pnpm-workspace.yaml now fails with CatalogAssemblyError instead of being silently ignored. New @public module `src/layers/catalog/package-json-workspaces.ts`: `PackageJsonWorkspaces`, `parsePackageJsonWorkspaces(content)`, `catalogSetFromPackageJson(content)`. Bun's bun.lock catalogs are deliberately NOT read (root package.json is the inline authority; `BunExtension.catalog`/`.catalogs` still expose the lockfile view). LockfileData gained `importers: ReadonlyArray<LockfileImporter>` with new @public Schema.Classes `LockfileImporter` (`path` relative to the workspace root, "." for root, matching WorkspaceDiscovery.importerMap() keys; `dependencies`) and `ImporterDependency` (`name`, `specifier`, optional `version`, `depType`); populated by the pnpm, bun and npm parsers, always `[]` for yarn, and `version` is populated by pnpm ONLY (bun/npm record resolved versions on package tuples/entries, not per importer). `parseLockfileContent(content, lockfilePath, packageManager)` is now @public — the pure parser dispatch, so a caller can parse a before/after lockfile pair in one process without the memoized LockfileReader service.

## Design Documents

Load these when working on the corresponding area:

- `.claude/design/architecture.md` — service groups, layers, composites, errors
- `.claude/design/effect-patterns-core.md` — service, error, layer, Request/RequestResolver patterns
- `.claude/design/effect-patterns-parsing.md` — Schema and parsing pipeline patterns
- `.claude/design/effect-patterns-testing.md` — testing, mocking, command patterns
- `.claude/design/phase2-dependency-graph.md` — dependency graph design
- `.claude/design/phase3-change-detection.md` — git change detection design
- `.claude/design/phase4-configuration-lockfiles.md` — configuration and lockfiles design (parsing, catalogs, CatalogResolver)
- `.claude/design/point-in-time-workspace.md` — PointInTimeWorkspace service, snapshots at a git ref, CatalogSet/WorkspaceStateSnapshot value objects, GitReader
- `.claude/design/lockfile-reader-service.md` — LockfileReader and PublishabilityDetector service interfaces
- `.claude/design/lockfile-schemas.md` — all 4 lockfile format schemas
- `.claude/design/bun-lockfile.md` — bun.lock JSONC format reference
- `.claude/design/code-review-findings.md` — known limitations (recursive `/**` glob #62, PM-detector root-validation caveat)
- `.claude/design/research-notes.md` — patterns from sibling repos

## Key Conventions

- Class-based `Context.Tag` (GenericTag deprecated)
- `@effect/platform` for FileSystem, Path, Command (no `node:` imports)
- `Data.TaggedError` with exported Base constants
- CommandExecutor resolved at layer construction for R=never methods
- Eager data construction in `Layer.effect` for pure in-memory services (`DependencyGraphLive`, `TopologicalSorterLive`); lazy `Effect.cached` initialization for I/O-bound layers (`LockfileReaderLive`, `WorkspaceDiscoveryLive`) so layer construction stays O(1) and init errors surface from the first method call via `LockfileInitError`
- Internal service events use `Effect.logDebug` (not `logInfo`); library stays silent under the default logger
- Request/RequestResolver with per-layer `Request.makeCache` for deduplication
- `Schema.transformOrFail` + `Schema.compose` for parsing pipelines
- PublishConfig is a `Schema.Class` (not Schema.Struct); no PublishConfigSchema alias
- Tests in `__test__/` using @savvy-web/vitest discovery convention
- Test fixtures in `__test__/integration/fixtures/` (real generated lockfiles for all 4 PMs)
- Shared test utilities in `__test__/utils/` (fixtures.ts, layers.ts, mock-fs.ts)
- Static dual-API wiring in `src/index.ts` (semver-effect pattern)
- Standalone utility functions in `src/utils/` directory
- Sync API in `src/sync.ts` uses `node:fs`/`node:path` directly (exception to `@effect/platform` rule); keep sync functions minimal and free of Effect dependencies

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run typecheck         # Type-check all workspaces via Turbo
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with coverage report
```

### Building

```bash
pnpm run build             # Build all packages (dev + prod)
pnpm run build:dev         # Build development output only
pnpm run build:prod        # Build production/npm output only
```

### Running a Single Test

```bash
# Run a specific test file
pnpm vitest run __test__/layers/DependencyGraphLive.test.ts

# Filter tests by name pattern
pnpm vitest run -t "lockfile integrity"
```

## Architecture

### Repository Structure

- **Package Manager**: pnpm (single-package workspace; `pnpm-workspace.yaml`
  declares `packages: [.]`)
- **Build Orchestration**: Turbo for caching and task dependencies
- **Source**: `src/` (services, layers, errors, schemas, utils)
- **Tests**: `__test__/` (unit, integration, fixtures, shared utilities)
- **Shared Configs**: `lib/configs/`

### Package Build Pipeline

Packages use Rslib with dual output:

1. `dist/dev/` - Development build with source maps
2. `dist/npm/` - Production build for npm publishing

Turbo tasks define dependencies: `typecheck` depends on `build` completing first.

### Code Quality

- **Biome**: Unified linting and formatting (replaces ESLint + Prettier)
- **Commitlint**: Enforces conventional commits with DCO signoff
- **Husky Hooks**:
  - `pre-commit`: Runs lint-staged
  - `commit-msg`: Validates commit message format
  - `pre-push`: Runs tests for affected packages

### TypeScript Configuration

- Composite builds with project references
- Strict mode enabled
- ES2022/ES2023 targets
- Import extensions required (`.js` for ESM)

### Testing

- **Framework**: Vitest with v8 coverage
- **Pool**: Uses forks (not threads) for Effect-TS compatibility
- **Config**: `vitest.config.ts` supports project-based filtering via
  `--project` flag

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (feat, fix, chore, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to both GitHub Packages and npm with provenance.
