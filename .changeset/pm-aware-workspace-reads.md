---
"workspaces-effect": minor
---

## Features

- `PackageManagerDetector` now reads `devEngines.packageManager` as its highest-priority signal, above lockfile and config-file presence. Accepts the object and array forms; the `packageManager` field still supplies the version when both name the same manager.
- `PointInTimeWorkspace` reads workspace globs and catalogs from the root `package.json` `workspaces` field when there is no `pnpm-workspace.yaml`, at a git ref and in the worktree. New public helpers `parsePackageJsonWorkspaces` and `catalogSetFromPackageJson` expose that reader.
- `LockfileData` gained an `importers` field: each workspace importer's declared dependencies with their specifier, resolved version (where the format records one — pnpm only), and dependency section. Populated by the pnpm, bun, and npm parsers; yarn leaves it empty.
- `parseLockfileContent(content, lockfilePath, packageManager)` is now public, so a caller can parse a before/after lockfile pair in one process rather than going through the memoized `LockfileReader` service.

## Bug Fixes

- `PointInTimeWorkspace.at(ref)` collapsed to the root package alone in a bun or npm workspace, because it read workspace globs only from `pnpm-workspace.yaml` and had no fallback. Consumers diffing two snapshots saw every declared dependency of every package as newly added, with no error raised.
