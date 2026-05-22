# Troubleshooting

Reference for every error type in workspaces-effect. All errors extend `Data.TaggedError` and can be caught with `Effect.catchTag("ErrorName", handler)`.

## Table of contents

- [WorkspaceRootNotFoundError](#workspacerootnotfounderror)
- [PackageManagerDetectionError](#packagemanagerdetectionerror)
- [WorkspaceDiscoveryError](#workspacediscoveryerror)
- [PackageJsonParseError](#packagejsonparseerror)
- [PackageNotFoundError](#packagenotfounderror)
- [CyclicDependencyError](#cyclicdependencyerror)
- [DependencyResolutionError](#dependencyresolutionerror)
- [GitNotAvailableError](#gitnotavailableerror)
- [ChangeDetectionError](#changedetectionerror)
- [LockfileReadError](#lockfilereaderror)
- [LockfileParseError](#lockfileparseerror)
- [LockfileIntegrityError](#lockfileintegrityerror)
- [Platform layer missing](#platform-layer-missing)

---

## WorkspaceRootNotFoundError

**Message:** `Workspace root not found from "/path": <reason>`

**Fields:** `searchPath`, `reason`

**Causes:**

- Running from a directory outside any monorepo
- No workspace configuration at the root

**Solutions:**

1. Confirm the current working directory sits inside a monorepo
2. For pnpm: check that `pnpm-workspace.yaml` exists at the root
3. For npm/yarn/bun: check that root `package.json` has a `workspaces` field
4. Check whether the workspace config was deleted or renamed

```typescript
Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
  Effect.logError(`No workspace root from ${e.searchPath}: ${e.reason}`),
);
```

---

## PackageManagerDetectionError

**Message:** `Cannot detect package manager at "/path": <reason>`

**Fields:** `searchPath`, `reason`

**Causes:**

- No lockfile at the workspace root
- Ambiguous signals — multiple lockfiles from different package managers
- Missing `packageManager` field for yarn or bun

**Solutions:**

1. Run your package manager's install command to generate a lockfile
2. Delete stale lockfiles from other package managers (e.g. remove `package-lock.json` on a pnpm project)
3. For yarn or bun: add a `packageManager` field to root `package.json` (e.g. `"packageManager": "yarn@<version>"`)

```typescript
Effect.catchTag("PackageManagerDetectionError", (e) =>
  Effect.logError(`PM detection failed at ${e.searchPath}: ${e.reason}`),
);
```

---

## WorkspaceDiscoveryError

**Message:** `Workspace discovery failed at "/path": <reason>`

**Fields:** `root`, `reason`

**Causes:**

- Glob patterns resolve to invalid or inaccessible directories
- A pattern references a non-existent base directory (e.g. `"packages/*"` when `packages/` does not exist)
- Filesystem permissions block reading matched directories
- Malformed patterns in `pnpm-workspace.yaml` or `package.json#workspaces`
- A workspace `package.json` is missing `name` or `version`

**Solutions:**

1. Check that workspace patterns are correct (e.g. `["packages/*"]`)
2. Confirm each pattern's base directory exists on disk
3. Confirm matched directories contain a `package.json`
4. Add `name` and `version` to every workspace `package.json`
5. Fix filesystem permissions so the matched directories are readable

```typescript
Effect.catchTag("WorkspaceDiscoveryError", (e) =>
  Effect.logError(`Discovery failed at ${e.root}: ${e.reason}`),
);
```

---

## PackageJsonParseError

**Message:** `Failed to parse package.json at "/path": <cause>`

**Fields:** `filePath`, `cause`

**Causes:**

- Invalid JSON (syntax error, trailing comma)
- Missing fields the schema requires
- File exists but cannot be read (permissions)

**Solutions:**

1. Validate JSON syntax: `cat package.json | jq .`
2. Look for merge conflict markers in the file
3. Confirm the file is UTF-8

```typescript
Effect.catchTag("PackageJsonParseError", (e) =>
  Effect.logError(`Bad package.json at ${e.filePath}`),
);
```

---

## PackageNotFoundError

**Message:** `Package "<name>" not found (N packages available)`

**Fields:** `name`, `available`

**Causes:**

- Typo in the package name
- Package was removed from the workspace
- Package was not discovered — excluded by patterns or missing `package.json`

**Solutions:**

1. Double-check the exact name (case-sensitive, including scope)
2. Read the `available` field on the error — it lists every known package
3. Confirm the package directory matches your workspace patterns

```typescript
Effect.catchTag("PackageNotFoundError", (e) =>
  Effect.logWarning(`"${e.name}" not found. Available: ${e.available.join(", ")}`),
);
```

---

## CyclicDependencyError

**Message:** `Cyclic dependency detected: a -> b -> c -> a`

**Fields:** `cycle` (array of package names)

**Causes:**

- Two or more workspace packages depend on each other in a cycle

**Solutions:**

1. Read the cycle path on the error
2. Break the cycle by:
   - Moving shared code into a separate package
   - Using dynamic imports for optional features
   - Restructuring around dependency inversion
3. Call `DependencyGraph.hasCycle()` in CI to catch cycles before they merge

```typescript
Effect.catchTag("CyclicDependencyError", (e) =>
  Effect.logError(`Cycle: ${e.cycle.join(" -> ")}`),
);
```

---

## DependencyResolutionError

**Message:** `Cannot resolve "<dep>" from "<package>": <reason>`

**Fields:** `packageName`, `dependency`, `reason`

**Causes:**

- A workspace package declares a version constraint on another workspace package that cannot be satisfied
- The dependency name does not match any known workspace package

**Solutions:**

1. Check the dependency version constraint
2. Confirm the depended-upon package exists in the workspace
3. For the `workspace:*` protocol, both packages must live in the same workspace

```typescript
Effect.catchTag("DependencyResolutionError", (e) =>
  Effect.logError(`${e.packageName} -> ${e.dependency}: ${e.reason}`),
);
```

---

## GitNotAvailableError

**Message:** `Git is not available: <reason>`

**Fields:** `reason`

**Causes:**

- Git is not installed
- The directory is not inside a git repository
- `WorkspacesFullLive` is wired up in a non-git environment (e.g. a Docker build without git)

**Solutions:**

1. Install git
2. Initialize a repo: `git init`
3. If change detection is not needed, swap `WorkspacesFullLive` for `WorkspacesLive`
4. Catch the error and fall back:

```typescript
Effect.catchTag("GitNotAvailableError", () =>
  Effect.succeed([]), // Fall back to empty list
);
```

---

## ChangeDetectionError

**Message:** `Change detection failed during "<operation>": <reason>`

**Fields:** `operation`, `reason`

**Causes:**

- Invalid git ref (branch, tag or commit SHA does not exist)
- Merge conflicts blocking the diff
- Shallow clone without enough history

**Solutions:**

1. Resolve the refs first: `git rev-parse <ref>`
2. In CI, set `fetch-depth: 0` on the checkout action — or at least enough history to include the base ref
3. Resolve any in-progress merge before retrying

```typescript
Effect.catchTag("ChangeDetectionError", (e) =>
  Effect.logError(`Git ${e.operation} failed: ${e.reason}`),
);
```

---

## LockfileReadError

**Message:** `Failed to read lockfile at "/path": <reason>`

**Fields:** `lockfilePath`, `reason`

**Causes:**

- The lockfile does not exist (install never ran)
- File permissions block reading
- Wrong lockfile path — package manager mismatch

**Solutions:**

1. Run install to generate the lockfile
2. Check file permissions on the lockfile
3. Confirm the detected package manager matches the lockfile on disk

```typescript
Effect.catchTag("LockfileReadError", (e) =>
  Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`),
);
```

---

## LockfileParseError

**Message:** `Failed to parse <format> lockfile at "/path"`

**Fields:** `lockfilePath`, `format` (`"pnpm" | "npm" | "yarn" | "bun"`), `cause`

**Causes:**

- Corrupted lockfile
- Unsupported lockfile format version
- Manual edits introduced syntax errors
- Merge conflict markers in the file

**Solutions:**

1. Delete and reinstall: `rm pnpm-lock.yaml && pnpm install`
2. Search for conflict markers: `grep -r '<<<<<<' pnpm-lock.yaml`
3. Match your package manager version to the lockfile format version

```typescript
Effect.catchTag("LockfileParseError", (e) =>
  Effect.logError(`Cannot parse ${e.format} lockfile at ${e.lockfilePath}`),
);
```

---

## LockfileIntegrityError

**Message:** `Integrity check failed: <reason>`

**Fields:** `reason`, `cause`

**Causes:**

- The check itself could not complete. Actual mismatches surface in the `LockfileIntegrity` data, not as an error.
- Lockfile or workspace data is in an unexpected state

**Solutions:**

1. Reinstall to regenerate the lockfile
2. Check that workspace discovery succeeds without other errors
3. Read the `reason` field for the specific failure

```typescript
Effect.catchTag("LockfileIntegrityError", (e) =>
  Effect.logError(`Integrity check failed: ${e.reason}`),
);
```

---

## Platform layer missing

**Symptom:** Type error about a missing `FileSystem`, `Path` or `CommandExecutor` in the Effect context.

This is a compile-time type error, not a runtime failure. It means a platform layer is not provided.

**Causes:**

- `NodeContext.layer` or `BunContext.layer` is not provided
- `ChangeDetector` or `PackageResolver` is wired with `WorkspacesLive` instead of `WorkspacesFullLive`

**Solutions:**

1. Provide the platform layer:

```typescript
program.pipe(
  Effect.provide(WorkspacesLive),
  Effect.provide(NodeContext.layer), // provides FileSystem + Path + CommandExecutor
);
```

2. For change detection, switch to `WorkspacesFullLive`:

```typescript
program.pipe(
  Effect.provide(WorkspacesFullLive),
  Effect.provide(NodeContext.layer),
);
```

`NodeContext.layer` and `BunContext.layer` both ship all three platform services (`FileSystem`, `Path`, `CommandExecutor`), so either composite layer accepts either runtime.
