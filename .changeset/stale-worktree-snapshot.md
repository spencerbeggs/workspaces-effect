---
"workspaces-effect": patch
---

## Bug Fixes

`PointInTimeWorkspace.worktree()` now discards the `WorkspaceDiscovery` cache before reading, so a snapshot taken after `package.json` files changed on disk reflects the live manifests instead of the ones cached at the first discovery call. Previously a long-lived layer (one shared discovery instance) served the pre-change manifests, making a worktree snapshot compare equal to its base ref and silently producing an empty dependency diff downstream.
