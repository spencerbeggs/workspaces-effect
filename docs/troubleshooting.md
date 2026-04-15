# Troubleshooting

Every error type in workspaces-effect with its description, common causes, and
solutions. All errors extend `Data.TaggedError` and can be caught with
`Effect.catchTag("ErrorName", handler)`.

## Table of Contents

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
- [Platform Layer Missing](#platform-layer-missing)

---

## WorkspaceRootNotFoundError

**Message:** `Workspace root not found from "/path": <reason>`

**Fields:** `searchPath`, `reason`

**Causes:**

- Running from a directory outside a monorepo
- Missing workspace configuration at the root

**Solutions:**

1. Verify you are running from within a monorepo directory
2. For pnpm: ensure `pnpm-workspace.yaml` exists at the root
3. For npm/yarn/bun: ensure `package.json` has a `workspaces` field
4. Check that you have not accidentally deleted or renamed the workspace config

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

- No lockfile present at the workspace root
- Ambiguous signals (e.g., multiple lockfiles from different package managers)
- Missing `packageManager` field for yarn or bun

**Solutions:**

1. Run your package manager's install command to generate a lockfile
2. Remove stale lockfiles from other package managers (e.g., delete
   `package-lock.json` if you use pnpm)
3. For yarn or bun: add a `packageManager` field to root `package.json`
   (e.g., `"packageManager": "yarn@4.0.0"`)

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

- Workspace glob patterns resolve to invalid or inaccessible directories
- A workspace pattern references a non-existent base directory (e.g.,
  `"packages/*"` when `packages/` does not exist)
- Filesystem permissions prevent reading matched directories
- Malformed patterns in `pnpm-workspace.yaml` or `package.json` `workspaces`
- A workspace `package.json` is missing the required `name` or `version` field

**Solutions:**

1. Verify workspace patterns are correct (e.g., `["packages/*"]`)
2. Check that base directories in patterns exist on disk
3. Check that matched directories exist and contain a `package.json`
4. Ensure every workspace `package.json` has both `name` and `version` fields
5. Ensure filesystem permissions allow reading

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

- `package.json` contains invalid JSON (syntax error, trailing comma)
- `package.json` is missing required fields expected by the schema
- File exists but cannot be read (permissions)

**Solutions:**

1. Validate JSON syntax: `cat package.json | jq .`
2. Check for merge conflict markers in the file
3. Ensure the file is UTF-8 encoded

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

- Typo in package name
- Package was removed from the workspace
- Package was not discovered (excluded by patterns, missing `package.json`)

**Solutions:**

1. Check the exact package name (case-sensitive, including scope)
2. Review the `available` field in the error -- it lists all known packages
3. Verify the package directory matches your workspace patterns

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

1. Review the cycle path in the error message
2. Break the cycle by:
   - Moving shared code into a separate package
   - Using dynamic imports for optional features
   - Restructuring to use dependency inversion
3. Use `DependencyGraph.hasCycle()` to detect cycles proactively

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

- A workspace package declares a dependency on another workspace package
  whose version constraint cannot be satisfied
- Dependency name does not match any known workspace package

**Solutions:**

1. Verify the dependency version constraint is compatible
2. Check that the depended-upon package exists in the workspace
3. For `workspace:*` protocol, ensure both packages are in the same workspace

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
- Using `WorkspacesFullLive` in a non-git environment (e.g., Docker build
  without git)

**Solutions:**

1. Install git if not present
2. Initialize a git repository: `git init`
3. If you do not need change detection, use `WorkspacesLive` instead of
   `WorkspacesFullLive`
4. Catch the error and fall back gracefully:

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

- Invalid git ref (branch, tag, or commit SHA does not exist)
- Git merge conflicts preventing diff
- Shallow clone without sufficient history

**Solutions:**

1. Verify the base and head refs exist: `git rev-parse <ref>`
2. For CI: ensure `fetch-depth: 0` in checkout action (or at least enough
   history to include the base ref)
3. Check that the repository is not in a conflicted state

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

- Lockfile does not exist (never ran install)
- File permissions prevent reading
- Wrong lockfile path (package manager mismatch)

**Solutions:**

1. Run your package manager's install command to generate the lockfile
2. Check file permissions on the lockfile
3. Ensure the detected package manager matches the lockfile that exists

```typescript
Effect.catchTag("LockfileReadError", (e) =>
  Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`),
);
```

---

## LockfileParseError

**Message:** `Failed to parse <format> lockfile at "/path"`

**Fields:** `lockfilePath`, `format` (`"pnpm" | "npm" | "yarn" | "bun"`),
`cause`

**Causes:**

- Corrupted lockfile
- Lockfile format version not supported
- Manual edits introduced syntax errors
- Merge conflict markers in the file

**Solutions:**

1. Delete the lockfile and reinstall:
   `rm pnpm-lock.yaml && pnpm install`
2. Check for merge conflict markers: `grep -r '<<<<<<' pnpm-lock.yaml`
3. Ensure your package manager version matches the lockfile format version

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

- The integrity check itself could not complete (not the same as finding
  mismatches, which are reported in the `LockfileIntegrity` data)
- Lockfile or workspace data is in an unexpected state

**Solutions:**

1. Run a fresh install to regenerate the lockfile
2. Check that workspace discovery is succeeding (no other errors)
3. Review the `reason` field for specific guidance

```typescript
Effect.catchTag("LockfileIntegrityError", (e) =>
  Effect.logError(`Integrity check failed: ${e.reason}`),
);
```

---

## Platform Layer Missing

**Symptom:** Type error about missing `FileSystem`, `Path`, or
`CommandExecutor` in the Effect context.

This is not a runtime error but a compile-time type error indicating you forgot
to provide platform services.

**Causes:**

- Forgot to provide `NodeContext.layer` or `BunContext.layer`
- Using `ChangeDetector` or `PackageResolver` with `WorkspacesLive` instead of
  `WorkspacesFullLive`

**Solutions:**

1. Add the platform layer:

```typescript
program.pipe(
  Effect.provide(WorkspacesLive),
  Effect.provide(NodeContext.layer), // provides FileSystem + Path + CommandExecutor
);
```

1. For change detection, use `WorkspacesFullLive`:

```typescript
program.pipe(
  Effect.provide(WorkspacesFullLive),
  Effect.provide(NodeContext.layer),
);
```

Both `NodeContext.layer` and `BunContext.layer` provide all three platform
services (`FileSystem`, `Path`, `CommandExecutor`), so they work with both
composite layers.
