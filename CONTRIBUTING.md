# Contributing to workspaces-effect

Thank you for your interest in contributing to workspaces-effect! This document
provides guidelines and instructions for development.

## Prerequisites

- Node.js 24+
- pnpm 10.32+

## Development Setup

```bash
# Clone the repository
git clone https://github.com/spencerbeggs/workspaces-effect.git
cd workspaces-effect

# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm run test
```

## Available Scripts

| Script | Description |
| --- | --- |
| `pnpm run build` | Build all packages (dev + prod) |
| `pnpm run build:dev` | Build development output only |
| `pnpm run build:prod` | Build production/npm output only |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with coverage report |
| `pnpm run lint` | Check code with Biome |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run typecheck` | Type-check all workspaces via Turbo |

## Code Quality

This project uses:

- **Biome** for linting and formatting
- **Commitlint** for enforcing conventional commits
- **Husky** for Git hooks

### Commit Format

All commits must follow the [Conventional Commits](https://conventionalcommits.org)
specification and include a DCO signoff:

```text
feat: add new workspace service

Signed-off-by: Your Name <your.email@example.com>
```

### Pre-commit Hooks

The following checks run automatically:

- **pre-commit**: Runs lint-staged
- **commit-msg**: Validates commit message format
- **pre-push**: Runs tests for affected packages

## Testing

Tests use [Vitest](https://vitest.dev) with v8 coverage. The test pool uses
forks (not threads) for Effect-TS compatibility.

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage

# Run a specific test file
pnpm vitest run src/layers/DependencyGraphLive.test.ts
```

## TypeScript

- Strict mode enabled
- ES2022/ES2023 targets
- Import extensions required (`.js` for ESM)

### Import Conventions

```typescript
// Use .js extensions for relative imports (ESM requirement)
import { WorkspaceRootLive } from "./layers/WorkspaceRootLive.js";

// Use @effect/platform abstractions, not node: imports
import { FileSystem } from "@effect/platform";

// Separate type imports
import type { WorkspacePackage } from "./schemas/core.js";
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `pnpm run test`
5. Run linting: `pnpm run lint:fix`
6. Commit with conventional format and DCO signoff
7. Push and open a pull request

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
