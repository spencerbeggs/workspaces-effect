---
"workspaces-effect": minor
---

## Features

- Add the `CatalogResolver` service. It assembles a workspace's complete pnpm
  catalog set — inline `pnpm-workspace.yaml` catalogs, catalogs injected by config
  dependencies (replayed from their installed pnpmfile `updateConfig` hooks), and
  lockfile catalogs — without depending on the transient
  `.pnpm-workspace-state-v1.json` install artifact. It also resolves `catalog:` and
  `workspace:` specifiers in a manifest to concrete version specifiers, surfacing
  `CatalogAssemblyError` and `CatalogResolutionError` as typed, catchable failures.
  The service is wired into `WorkspacesLive` and `WorkspacesFullLive`.
