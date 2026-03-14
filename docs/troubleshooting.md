# Troubleshooting

Common issues and solutions when using workspaces-effect.

## Table of Contents

- [WorkspaceRootNotFoundError](#workspacerootnotfounderror)
- [PackageManagerDetectionError](#packagemanagerdetectionerror)
- [GitNotAvailableError](#gitnotavailableerror)
- [LockfileReadError](#lockfilereaderror)
- [LockfileParseError](#lockfileparseerror)
- [CyclicDependencyError](#cyclicdependencyerror)
- [Platform Layer Missing](#platform-layer-missing)

## WorkspaceRootNotFoundError

**Symptom:** "Workspace root not found from /path"

**Causes:**

- Running from a directory outside a monorepo
- Missing workspace configuration (no `pnpm-workspace.yaml` and no `workspaces`
  field in package.json)

**Solutions:**

1. Verify you are running from within a monorepo directory
2. Check that your workspace root has the correct configuration file for your
   package manager
3. For pnpm: ensure `pnpm-workspace.yaml` exists at the root
4. For npm/yarn/bun: ensure `package.json` has a `workspaces` field

## PackageManagerDetectionError

**Symptom:** "Cannot detect package manager at /path"

**Causes:**

- No lockfile present at the workspace root
- Ambiguous signals (e.g., multiple lockfiles from different package managers)

**Solutions:**

1. Run your package manager's install command to generate a lockfile
2. Remove stale lockfiles from other package managers
3. For yarn or bun: ensure the root `package.json` has a `packageManager` field
   (e.g., `"packageManager": "yarn@4.0.0"`)

## GitNotAvailableError

**Symptom:** "Git is not available"

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
  Effect.succeed([]),
);
```

## LockfileReadError

**Symptom:** "Failed to read lockfile at /path/to/lockfile"

**Causes:**

- Lockfile does not exist (never ran install)
- File permissions prevent reading

**Solutions:**

1. Run your package manager's install command
2. Check file permissions on the lockfile

## LockfileParseError

**Symptom:** "Failed to parse pnpm/npm/yarn/bun lockfile"

**Causes:**

- Corrupted lockfile
- Lockfile format version not supported
- Manual edits introduced syntax errors

**Solutions:**

1. Delete the lockfile and reinstall: `rm pnpm-lock.yaml && pnpm install`
2. Check for merge conflict markers in the lockfile
3. Ensure your package manager version matches the lockfile format version

## CyclicDependencyError

**Symptom:** "Cyclic dependency detected: a -> b -> c -> a"

**Causes:**

- Two or more workspace packages depend on each other in a cycle

**Solutions:**

1. Review the cycle path in the error message
2. Break the cycle by:
   - Moving shared code into a separate package
   - Using dynamic imports for optional dependencies
   - Restructuring to use dependency inversion

## Platform Layer Missing

**Symptom:** Type error about missing `FileSystem`, `Path`, or
`CommandExecutor` in the Effect context

**Causes:**

- Forgot to provide `NodeContext.layer` or `BunContext.layer`
- Using `ChangeDetector` with `WorkspacesLive` instead of `WorkspacesFullLive`

**Solutions:**

1. Add the platform layer:

```typescript
program.pipe(
  Effect.provide(WorkspacesLive),
  Effect.provide(NodeContext.layer), // This provides FileSystem + Path
);
```

1. For change detection, use `WorkspacesFullLive` which requires
   `CommandExecutor` (also provided by `NodeContext.layer`):

```typescript
program.pipe(
  Effect.provide(WorkspacesFullLive),
  Effect.provide(NodeContext.layer),
);
```
