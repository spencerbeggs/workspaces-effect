---
"workspaces-effect": patch
---

## Refactoring

`WorkspacePackage.packageJsonPath` is now computed at construction time using
`@effect/platform`'s `Path.join` instead of a hardcoded forward slash,
ensuring consistent cross-platform path handling.
