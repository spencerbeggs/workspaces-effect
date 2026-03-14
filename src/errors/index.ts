/**
 * Typed error definitions for workspace operations.
 *
 * All errors use `Data.TaggedError` with exported Base constants
 * for api-extractor DTS bundling compatibility.
 *
 * @packageDocumentation
 */

import { Data } from "effect";

// ── Discovery Errors ─────────────────────────────────────────────────

/**
 * Base constant for {@link WorkspaceRootNotFoundError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const WorkspaceRootNotFoundErrorBase = Data.TaggedError("WorkspaceRootNotFoundError");

/**
 * Emitted when no workspace root can be found from the search path.
 *
 * @remarks
 * Raised by {@link WorkspaceRoot} when directory traversal from the search path
 * to the filesystem root finds no workspace markers (pnpm-workspace.yaml or
 * package.json with workspaces field).
 *
 * Fields:
 * - `searchPath` — the absolute path from which upward traversal started.
 * - `reason` — human-readable explanation of why no root was found.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { WorkspaceRootNotFoundError } from "workspaces-effect";
 * import { WorkspaceRoot, WorkspaceRootLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   return yield* root.find("/some/path");
 * }).pipe(
 *   Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
 *     Effect.succeed(`Fallback: ${e.searchPath}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceRootNotFoundError extends WorkspaceRootNotFoundErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace root not found from "${this.searchPath}": ${this.reason}`;
	}
}

/**
 * Base constant for {@link PackageManagerDetectionError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageManagerDetectionErrorBase = Data.TaggedError("PackageManagerDetectionError");

/**
 * Emitted when the package manager type cannot be determined.
 *
 * @remarks
 * Raised by {@link PackageManagerDetector} when heuristics (lockfile presence,
 * `packageManager` field in root package.json) fail to identify a single
 * package manager for the workspace.
 *
 * Fields:
 * - `searchPath` — the workspace root path that was inspected.
 * - `reason` — human-readable explanation of the detection failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageManagerDetectionError } from "workspaces-effect";
 * import { PackageManagerDetector, PackageManagerDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* PackageManagerDetector;
 *   return yield* detector.detect("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("PackageManagerDetectionError", (e) =>
 *     Effect.succeed(`Could not detect PM at ${e.searchPath}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageManagerDetectionError extends PackageManagerDetectionErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot detect package manager at "${this.searchPath}": ${this.reason}`;
	}
}

/**
 * Base constant for {@link WorkspaceDiscoveryError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const WorkspaceDiscoveryErrorBase = Data.TaggedError("WorkspaceDiscoveryError");

/**
 * Emitted when workspace package discovery fails.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} when glob expansion of workspace
 * patterns or subsequent package.json reads fail. This can occur if patterns
 * in pnpm-workspace.yaml or the root package.json `workspaces` field resolve
 * to invalid or inaccessible directories.
 *
 * Fields:
 * - `root` — the workspace root path where discovery was attempted.
 * - `reason` — human-readable explanation of what went wrong.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { WorkspaceDiscoveryError } from "workspaces-effect";
 * import { WorkspaceDiscovery, WorkspaceDiscoveryLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   return yield* discovery.discover("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("WorkspaceDiscoveryError", (e) =>
 *     Effect.succeed(`Discovery failed at ${e.root}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceDiscoveryError extends WorkspaceDiscoveryErrorBase<{
	readonly root: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace discovery failed at "${this.root}": ${this.reason}`;
	}
}

// ── Package Errors ───────────────────────────────────────────────────

/**
 * Base constant for {@link PackageJsonParseError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageJsonParseErrorBase = Data.TaggedError("PackageJsonParseError");

/**
 * Emitted when a package.json file cannot be parsed or validated.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} when a package.json file is found but
 * contains invalid JSON or does not conform to {@link PackageJsonSchema}. The
 * `cause` field preserves the underlying parse or schema validation error.
 *
 * Fields:
 * - `filePath` — absolute path to the package.json that failed to parse.
 * - `cause` — the underlying error (JSON syntax error or Schema decode failure).
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageJsonParseError } from "workspaces-effect";
 * import { WorkspaceDiscovery, WorkspaceDiscoveryLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   return yield* discovery.discover("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("PackageJsonParseError", (e) =>
 *     Effect.logError(`Bad package.json at ${e.filePath}`).pipe(
 *       Effect.map(() => [])
 *     )
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageJsonParseError extends PackageJsonParseErrorBase<{
	readonly filePath: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse package.json at "${this.filePath}": ${String(this.cause)}`;
	}
}

/**
 * Base constant for {@link PackageNotFoundError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageNotFoundErrorBase = Data.TaggedError("PackageNotFoundError");

/**
 * Emitted when a named package is not found in the workspace.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} or {@link DependencyGraph} when a
 * lookup by package name yields no match. The `available` field lists all
 * known package names to aid debugging typos or missing packages.
 *
 * Fields:
 * - `name` — the package name that was requested but not found.
 * - `available` — all package names currently known in the workspace.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageNotFoundError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.dependenciesOf("@my-org/missing-pkg");
 * }).pipe(
 *   Effect.catchTag("PackageNotFoundError", (e) =>
 *     Effect.logWarning(`"${e.name}" not found. Available: ${e.available.join(", ")}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageNotFoundError extends PackageNotFoundErrorBase<{
	readonly name: string;
	readonly available: ReadonlyArray<string>;
}> {
	get message(): string {
		const count = this.available.length;
		return `Package "${this.name}" not found (${count} package${count === 1 ? "" : "s"} available)`;
	}
}

// ── Graph Errors ────────────────────────────────────────────────────

/**
 * Base constant for {@link CyclicDependencyError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const CyclicDependencyErrorBase = Data.TaggedError("CyclicDependencyError");

/**
 * Emitted when a cycle is detected in the dependency graph.
 *
 * @remarks
 * Raised by {@link DependencyGraph} during topological sorting or cycle
 * detection. The `cycle` array contains all package names that could not
 * be topologically sorted — i.e., packages that are part of or blocked
 * by a cyclic dependency.
 *
 * Fields:
 * - `cycle` — set of package names involved in or blocked by the cycle.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { CyclicDependencyError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.topologicalSort();
 * }).pipe(
 *   Effect.catchTag("CyclicDependencyError", (e) =>
 *     Effect.logError(`Cycle found: ${e.cycle.join(" -> ")}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class CyclicDependencyError extends CyclicDependencyErrorBase<{
	readonly cycle: ReadonlyArray<string>;
}> {
	get message(): string {
		return `Cyclic dependency detected: ${this.cycle.join(" -> ")}`;
	}
}

/**
 * Base constant for {@link DependencyResolutionError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const DependencyResolutionErrorBase = Data.TaggedError("DependencyResolutionError");

/**
 * Emitted when a dependency cannot be resolved within the workspace.
 *
 * @remarks
 * Raised by {@link DependencyGraph} when a workspace package declares a
 * dependency on another workspace package whose version constraint cannot be
 * satisfied or whose name does not match any known workspace package.
 *
 * Fields:
 * - `packageName` — the package that declares the unresolvable dependency.
 * - `dependency` — the dependency name that could not be resolved.
 * - `reason` — human-readable explanation of the resolution failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { DependencyResolutionError } from "workspaces-effect";
 * import { DependencyGraph, DependencyGraphLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   return yield* graph.resolve();
 * }).pipe(
 *   Effect.catchTag("DependencyResolutionError", (e) =>
 *     Effect.logError(`${e.packageName} -> ${e.dependency}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class DependencyResolutionError extends DependencyResolutionErrorBase<{
	readonly packageName: string;
	readonly dependency: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot resolve "${this.dependency}" from "${this.packageName}": ${this.reason}`;
	}
}

// ── Change Detection Errors ─────────────────────────────────────────

/**
 * Base constant for {@link GitNotAvailableError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const GitNotAvailableErrorBase = Data.TaggedError("GitNotAvailableError");

/**
 * Emitted when git is not installed or the directory is not a git repository.
 *
 * @remarks
 * Raised by {@link ChangeDetector} as a precondition check before any git
 * operations. This indicates that change detection is unavailable entirely,
 * as opposed to {@link ChangeDetectionError} which indicates a specific
 * git operation failed.
 *
 * Fields:
 * - `reason` — human-readable explanation (e.g., "git not found in PATH"
 *   or "not a git repository").
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { GitNotAvailableError } from "workspaces-effect";
 * import { ChangeDetector, ChangeDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   return yield* detector.changedPackages("main");
 * }).pipe(
 *   Effect.catchTag("GitNotAvailableError", (e) =>
 *     Effect.logWarning(`Git unavailable: ${e.reason}`).pipe(
 *       Effect.map(() => [])
 *     )
 *   )
 * );
 * ```
 *
 * @public
 */
export class GitNotAvailableError extends GitNotAvailableErrorBase<{
	readonly reason: string;
}> {
	get message(): string {
		return `Git is not available: ${this.reason}`;
	}
}

/**
 * Base constant for {@link ChangeDetectionError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const ChangeDetectionErrorBase = Data.TaggedError("ChangeDetectionError");

/**
 * Emitted when a git operation fails during change detection.
 *
 * @remarks
 * Raised by {@link ChangeDetector} when a specific git command (diff, log,
 * merge-base, etc.) fails after git availability has already been confirmed.
 * The `operation` field identifies which command failed.
 *
 * Fields:
 * - `operation` — the git operation that failed (e.g., "diff", "merge-base").
 * - `reason` — human-readable explanation of the failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { ChangeDetectionError } from "workspaces-effect";
 * import { ChangeDetector, ChangeDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   return yield* detector.changedPackages("main");
 * }).pipe(
 *   Effect.catchTag("ChangeDetectionError", (e) =>
 *     Effect.logError(`Git ${e.operation} failed: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class ChangeDetectionError extends ChangeDetectionErrorBase<{
	readonly operation: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Change detection failed during "${this.operation}": ${this.reason}`;
	}
}

// ── Lockfile Errors ─────────────────────────────────────────────────

/**
 * Base constant for {@link LockfileReadError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const LockfileReadErrorBase = Data.TaggedError("LockfileReadError");

/**
 * Emitted when a lockfile cannot be read from disk.
 *
 * @remarks
 * Raised by {@link LockfileReader} when the expected lockfile for the detected
 * package manager (e.g., `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
 * `bun.lock`) does not exist or cannot be read due to filesystem permissions.
 *
 * Fields:
 * - `lockfilePath` — absolute path to the lockfile that could not be read.
 * - `reason` — human-readable explanation (e.g., "file not found", "permission denied").
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileReadError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.read("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileReadError", (e) =>
 *     Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileReadError extends LockfileReadErrorBase<{
	readonly lockfilePath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Failed to read lockfile at "${this.lockfilePath}": ${this.reason}`;
	}
}

/**
 * Base constant for {@link LockfileParseError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const LockfileParseErrorBase = Data.TaggedError("LockfileParseError");

/**
 * Emitted when a lockfile exists but cannot be parsed.
 *
 * @remarks
 * Raised by {@link LockfileReader} when the lockfile is successfully read from
 * disk but its contents cannot be parsed into the expected format. Each package
 * manager has a different lockfile format (YAML for pnpm, JSON for npm/bun,
 * custom format for yarn Berry).
 *
 * Fields:
 * - `lockfilePath` — absolute path to the lockfile that failed to parse.
 * - `format` — the package manager format that was attempted (`"pnpm"`, `"npm"`, `"yarn"`, or `"bun"`).
 * - `cause` — the underlying parse error.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileParseError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.read("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileParseError", (e) =>
 *     Effect.logError(`Cannot parse ${e.format} lockfile at ${e.lockfilePath}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileParseError extends LockfileParseErrorBase<{
	readonly lockfilePath: string;
	readonly format: "pnpm" | "npm" | "yarn" | "bun";
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse ${this.format} lockfile at "${this.lockfilePath}"`;
	}
}

/**
 * Base constant for {@link LockfileIntegrityError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const LockfileIntegrityErrorBase = Data.TaggedError("LockfileIntegrityError");

/**
 * Emitted when integrity checking cannot complete.
 *
 * @remarks
 * Raised by {@link LockfileReader} during integrity validation when the
 * comparison between the lockfile's resolved packages and the workspace's
 * declared dependencies encounters an unrecoverable error. Note that
 * integrity *mismatches* (missing workspaces, unsatisfied constraints) are
 * reported via {@link LockfileIntegrity} — this error indicates the check
 * itself could not run.
 *
 * Fields:
 * - `reason` — human-readable explanation of why the integrity check failed.
 * - `cause` — the underlying error that prevented the check.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileIntegrityError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.checkIntegrity("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileIntegrityError", (e) =>
 *     Effect.logError(`Integrity check failed: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileIntegrityError extends LockfileIntegrityErrorBase<{
	readonly reason: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Integrity check failed: ${this.reason}`;
	}
}
