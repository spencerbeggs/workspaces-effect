# workspaces-effect documentation

Effect-TS workspace tooling for npm, pnpm, yarn Berry and Bun monorepos.

## Pages

- [Getting started](./01-getting-started.md) — install, wire up a layer and run your first program. Includes platform setup and the sync helpers
- [WorkspacePackage API](./02-workspace-package.md) — the package model: computed getters, dependency queries, the dual-API pattern, diffs and `readPackageJson`
- [Dependency analysis](./03-dependency-analysis.md) — build a dependency graph, sort it topologically, surface parallel build levels and catch cycles
- [Change detection](./04-change-detection.md) — git-aware change detection for affected packages and CI pipelines
- [Lockfile parsing](./05-lockfile-parsing.md) — unified lockfile reading across all four package managers, including resolved versions, workspace deps, integrity checks and PM-specific extensions
- [Publishability](./06-publishability.md) — detect which packages are publishable, resolve publish targets and drive selective publishing
- [Architecture overview](./07-architecture-overview.md) — service groups, layer composites and the error model
- [Services reference](./08-services-reference.md) — service-by-service API reference
- [Troubleshooting](./09-troubleshooting.md) — every error the library throws, what causes it and how to fix it
