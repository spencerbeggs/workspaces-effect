# workspaces-effect documentation

Effect-TS workspace tooling for npm, pnpm, yarn Berry and Bun monorepos.

## Pages

- [Getting started](./01-getting-started.md) — install, run a first program and pick a layer. Covers Bun setup and the sync helpers
- [WorkspacePackage API](./02-workspace-package.md) — the package model: computed getters, dependency queries, the dual-API pattern, diffs and `readPackageJson`
- [Dependency analysis](./03-dependency-analysis.md) — build a dependency graph and query it, then get a build order: sequential or grouped into parallel levels. Also covers subset sorting and cycle detection
- [Change detection](./04-change-detection.md) — map a git diff to the packages it touches and the packages that depend on them
- [Lockfile parsing](./05-lockfile-parsing.md) — parse any of the four lockfile formats into one schema, then query resolved versions, workspace deps, integrity and PM-specific extensions through the same API
- [Publishability](./06-publishability.md) — which packages are publishable and where they publish to. Ends with a worked selective-publishing example
- [Architecture overview](./07-architecture-overview.md) — service groups, layer composites and the error model
- [Services reference](./08-services-reference.md) — every service's tag, live layer, method signatures and error types
- [Troubleshooting](./09-troubleshooting.md) — every error the library throws, what causes it and how to fix it
