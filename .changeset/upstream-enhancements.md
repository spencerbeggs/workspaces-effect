---
"workspaces-effect": minor
---

## Features

### Standalone Package Fallback

WorkspaceDiscovery now returns the root package as a single workspace when no pnpm-workspace.yaml or package.json workspaces field is found, instead of failing with an error.

### Runtime Detection

PackageManagerDetector now includes a `runtime` field (`"node"` or `"bun"`) on the detection result. Bun PM implies bun runtime; all others are node.

### Extendable PublishConfig

PublishConfig is now a Schema.Class instead of a Schema.Struct, enabling downstream packages to extend it with additional fields via field spreading.

### Expanded PublishConfig Fields

PublishConfig now includes `tag` (npm standard) and `linkDirectory` (pnpm extension) fields.

### Synchronous Workspace API

New `findWorkspaceRootSync` and `getWorkspacePackagesSync` functions for non-Effect contexts (e.g., lint-staged handlers). Enables dropping the `workspace-tools` dependency.

## Bug Fixes

### Root-as-Package Deduplication

WorkspaceDiscovery no longer duplicates the root workspace when pnpm-workspace.yaml patterns include `"."`.
