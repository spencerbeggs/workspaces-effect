# workspaces-effect

`workspaces-effect` — an Effect-TS library for monorepo workspace
tooling. Supports npm, pnpm, yarn Berry, and Bun workspaces.

## Status

All phases complete plus WorkspacePackage enrichment (Issue #12). 386 tests
passing (250 unit + 136 integration). Full observability (spans + structured
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
WorkspaceDiscovery.importerMap() added. listPackages() now includes root
workspace (breaking change). PnpmExtension.catalogs accepts union type for
pnpm v9+ format (catalogs defined in pnpm-workspace.yaml in v10).
PublishConfig is a Schema.Class with `tag` and `linkDirectory` fields
(PublishConfigSchema alias removed). DetectedPackageManager has `runtime`
field ("node" | "bun"). WorkspaceDiscoveryLive has standalone fallback
(returns root as single workspace when no config) and deduplicates root when
patterns include ".". resolvePattern errors on non-existent base directory.
readWorkspacePackage requires version field (no silent "0.0.0" default for
child packages). PublishTarget schema and shared parser utilities fully tested.
Sync API (`src/sync.ts`): `findWorkspaceRootSync` and
`getWorkspacePackagesSync` exported for non-Effect contexts (e.g., lint-staged
handlers); uses `node:fs`/`node:path` directly.

## Design Documents

Load these when working on the corresponding area:

- `.claude/design/architecture.md` — service groups, layers, composites, errors
- `.claude/design/effect-patterns-core.md` — service, error, layer, Request/RequestResolver patterns
- `.claude/design/effect-patterns-parsing.md` — Schema and parsing pipeline patterns
- `.claude/design/effect-patterns-testing.md` — testing, mocking, command patterns
- `.claude/design/phase2-dependency-graph.md` — dependency graph design
- `.claude/design/phase3-change-detection.md` — git change detection design
- `.claude/design/phase4-configuration-lockfiles.md` — lockfile parsing design
- `.claude/design/lockfile-reader-service.md` — LockfileReader service interface
- `.claude/design/lockfile-schemas.md` — all 4 lockfile format schemas
- `.claude/design/bun-lockfile.md` — bun.lock JSONC format reference
- `.claude/design/code-review-findings.md` — known issues (5/10 fixed)
- `.claude/design/research-notes.md` — patterns from sibling repos

## Key Conventions

- Class-based `Context.Tag` (GenericTag deprecated)
- `@effect/platform` for FileSystem, Path, Command (no `node:` imports)
- `Data.TaggedError` with exported Base constants
- CommandExecutor resolved at layer construction for R=never methods
- Eager data construction in `Layer.effect`
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
# Run tests for a specific package (replace with actual package name)
pnpm run test -- --filter=@spencerbeggs/<package-name>

# Run a specific test file
pnpm vitest run pkgs/<package-name>/__test__/index.test.ts
```

## Architecture

### Monorepo Structure

- **Package Manager**: pnpm with workspaces
- **Build Orchestration**: Turbo for caching and task dependencies
- **Packages**: Located in `pkgs/` directory
- **Shared Configs**: Located in `lib/configs/`

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
