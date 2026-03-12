# workspaces-effect

`@spencerbeggs/workspaces-effect` — an Effect-TS library for monorepo workspace
tooling. Supports npm, pnpm, yarn Berry, and Bun workspaces.

## Status

Phases 1-3 complete. 104 tests passing. Phase 4 (Configuration & Lockfiles)
design at 85% — service interface drafted, test fixtures created, all schemas
defined. Ready to prototype parsing pipelines. Plans in `.claude/plans/`.

## Design Documents

Load these when working on the corresponding area:

- `.claude/design/architecture.md` — service groups, layers, schemas, errors
- `.claude/design/effect-best-practices.md` — Effect patterns and conventions
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
- `Schema.transformOrFail` + `Schema.compose` for parsing pipelines
- Test fixtures in `src/test-fixtures/` (lockfiles for all 4 PMs)

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
pnpm vitest run pkgs/<package-name>/src/index.test.ts
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
