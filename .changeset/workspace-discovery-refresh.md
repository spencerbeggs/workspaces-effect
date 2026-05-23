---
"workspaces-effect": minor
---

## Features 

Add `WorkspaceDiscovery.refresh()` to discard the per-root package cache so the next `listPackages` (and `getPackage` / `importerMap`) re-reads each `package.json` from disk. Use it after mutating package files mid-process — e.g. running `changeset version` and then reading the bumped versions back — which previously returned the pre-mutation snapshot from the layer-lifetime cache.
