---
"workspaces-effect": major
---

## Breaking Changes

- Callers that expected `null` for a single-package git repo will now
  receive the git root path. The common shape — `if (root) { …
  getWorkspacePackagesSync(root) }` — continues to work and returns the
  single-package result via the existing root-only path.
- A `.git` directory without a sibling `package.json` now throws instead
  of returning `null`. This is a hard error: a project must have a root
  manifest.

## Bug Fixes

### `findWorkspaceRootSync` walks up to the git project boundary

`findWorkspaceRootSync` previously returned `null` for any repo without a
workspace marker, even if a `package.json` sat at the project root.
Downstream consumers (notably `vitest-agent-plugin`) had to special-case
single-package repos themselves.

The resolution order at each level is now:

1. `pnpm-workspace.yaml` — return this directory.
2. `package.json` with a `workspaces` field — return this directory.
3. `.git` (the project boundary) — stop the walk. If a `package.json`
   exists alongside `.git`, return that directory (single-package repo
   support); if not, throw — a project missing a root manifest is an
   error, not a silent miss.

The function still returns `null`, but now only when `cwd` is not inside
any git project at all (the walk reaches the filesystem root without
finding `.git`).

| Repo shape | Before | After |
| ---------- | ------ | ----- |
| Monorepo with workspace markers | workspace root | unchanged |
| Single-package repo (no markers, has `.git`) | `null` (caller had to special-case) | git root |
| Git project with no `package.json` at the root | `null` (or unrelated outer root) | throws |
| Path outside any git project | `null` | `null` |

Closes #103.
