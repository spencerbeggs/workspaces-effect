# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`@spencerbeggs/workspaces-effect` — an Effect-TS library for monorepo workspace
tooling, inspired by Microsoft's
[workspace-tools](https://github.com/microsoft/workspace-tools). Key traits:

- First-class Effect library: services, layers, typed errors, observability
- Supports npm, pnpm, yarn Berry, and Bun workspaces only
- Scope is being iteratively defined through design doc sessions

### Design Status

Active design phase. Key documents:

- **Architecture**: `.claude/design/architecture.md` -- service groups,
  error hierarchy, schemas, layer composition, platform abstraction
- **Research Notes**: `.claude/design/research-notes.md` -- patterns from
  sibling repos (runtime-resolver, semver-effect, type-registry-effect,
  github-action-effects, pnpm-config-dependency-action, claude-tools)
- **Roadmap**: `.claude/plans/000-roadmap.md` -- phased development plan
- **Phase 1 Plan**: `.claude/plans/001-phase1-discovery-services.md`

### Service Groups (Planned)

1. **Discovery**: WorkspaceRoot, PackageManagerDetector, WorkspaceDiscovery
2. **Package Analysis**: PackageJsonReader, DependencyGraph, TopologicalSorter
3. **Resolution**: GlobResolver, PackageResolver, ChangeDetector
4. **Configuration**: WorkspaceConfigReader, LockfileReader

### Key Design Decisions

- Use `Context.GenericTag` (not class Tag) for api-extractor DTS compat
- Platform-independent via `@effect/platform` (FileSystem, Path, Command)
- `Data.TaggedError` with exported Base constants for all errors
- Paired Live + Test layers for every service
- No dependency on workspace-tools; build on Effect platform directly

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
