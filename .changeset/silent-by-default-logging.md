---
"workspaces-effect": patch
---

## Refactoring

- Internal observability events now emit at `Debug` level instead of `Info`. The library is silent under Effect's default logger; consumers who want to see workspace-root discovery, package-manager detection, lockfile reads, and change-detection events can opt in via `Logger.withMinimumLogLevel(LogLevel.Debug)` or by attaching a custom logger. Affects `WorkspaceRootLive`, `PackageManagerDetectorLive`, `LockfileReaderLive`, `WorkspaceDiscoveryLive`, and `ChangeDetectorLive`. Log annotations (`workspace.root`, `workspace.pm`, `workspace.packages.count`, etc.) are unchanged.

## Documentation

- New "Observability" section in the README documenting how to subscribe to internal events by lowering the log level or replacing the logger.
