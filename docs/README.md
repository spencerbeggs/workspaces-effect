# workspaces-effect Documentation

User-facing documentation for `workspaces-effect`, an Effect-TS library for
monorepo workspace tooling.

## Getting Started

- [Getting Started](./guides/getting-started.md) -- Installation, first
  program, layers, platform setup, and synchronous utilities

## Architecture

- [Architecture Overview](./architecture/overview.md) -- Service groups, layer
  composition, platform independence, and error model
- [Services Reference](./architecture/services.md) -- Complete API reference for
  all 9 services

## Guides

- [WorkspacePackage API](./guides/workspace-package.md) -- Computed getters,
  dependency queries, dual-API pattern, diffs, PublishConfig, and readPackageJson
- [Dependency Analysis](./guides/dependency-analysis.md) -- Dependency graphs,
  topological sorting, parallel build levels, and cycle detection
- [Change Detection](./guides/change-detection.md) -- Git-based change
  detection, affected packages, and CI pipeline integration
- [Lockfile Parsing](./guides/lockfile-parsing.md) -- Unified lockfile reading,
  resolved versions, workspace dependencies, integrity checking, and PM
  extensions
- [Publishability](./guides/publishability.md) -- Detecting publishable
  packages, publish targets, and selective publishing workflows

## Reference

- [Troubleshooting](./troubleshooting.md) -- Every error type with causes and
  solutions
