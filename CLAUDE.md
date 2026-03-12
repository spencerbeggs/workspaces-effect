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

### Implementation Status

Phases 1 (Discovery) and 2 (Package Analysis) are complete. 76 tests passing,
all typechecking.

**Implemented services and layers** (`src/`):

- `schemas/core.ts` -- PackageManager, PackageName, WorkspacePath,
  PackageJsonSchema, WorkspacePackage, WorkspaceInfo
- `errors/index.ts` -- 7 typed errors with Data.TaggedError + Base exports
- `services/` -- WorkspaceRoot, PackageManagerDetector, WorkspaceDiscovery,
  DependencyGraph, TopologicalSorter
- `layers/WorkspaceRootLive.ts` -- walks up from cwd for workspace markers
- `layers/PackageManagerDetectorLive.ts` -- pnpm > bun > yarn > npm priority
- `layers/WorkspaceDiscoveryLive.ts` -- reads patterns, resolves globs, reads
  package.json for each workspace package
- `layers/DiscoveryLive.ts` -- composite layer for all discovery services
- `layers/DependencyGraphLive.ts` -- builds directed graph from
  WorkspaceDiscovery output; inter-workspace edges only, excludes self-deps
- `layers/TopologicalSorterLive.ts` -- Kahn's algorithm for deterministic
  ordering with parallel level detection

**Design documents** (`.claude/design/`):

- `architecture.md` -- service groups, error hierarchy, schemas, layers
- `research-notes.md` -- patterns from sibling repos
- `effect-best-practices.md` -- living doc of Effect patterns and gotchas
- `bun-lockfile.md` -- bun.lock JSONC format reference
- `phase2-dependency-graph.md` -- dependency graph design decisions

**Plans** (`.claude/plans/`, gitignored):

- `000-roadmap.md` -- phased development plan
- `001-phase1-discovery-services.md` -- Phase 1 (complete)
- `002-phase2-package-analysis.md` -- Phase 2 (complete)
- `003-phase3-change-detection.md` -- Phase 3 (next)

### Service Groups

1. **Discovery** (implemented): WorkspaceRoot, PackageManagerDetector,
   WorkspaceDiscovery
2. **Package Analysis** (implemented): DependencyGraph, TopologicalSorter
   (PackageJsonReader merged into WorkspaceDiscovery)
3. **Resolution** (planned): GlobResolver, PackageResolver, ChangeDetector
4. **Configuration** (planned): WorkspaceConfigReader, LockfileReader

### Key Design Decisions

- Use class-based `Context.Tag` (GenericTag is deprecated, verified with Rslib)
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
