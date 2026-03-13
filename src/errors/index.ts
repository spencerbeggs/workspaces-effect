/**
 * Typed error definitions for workspace operations.
 *
 * All errors use `Data.TaggedError` with exported Base constants
 * for api-extractor DTS bundling compatibility.
 */

import { Data } from "effect";

// ── Discovery Errors ─────────────────────────────────────────────────

/** @internal */
export const WorkspaceRootNotFoundErrorBase = Data.TaggedError("WorkspaceRootNotFoundError");

/** Emitted when no workspace root can be found from the search path. */
export class WorkspaceRootNotFoundError extends WorkspaceRootNotFoundErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace root not found from "${this.searchPath}": ${this.reason}`;
	}
}

/** @internal */
export const PackageManagerDetectionErrorBase = Data.TaggedError("PackageManagerDetectionError");

/** Emitted when the package manager type cannot be determined. */
export class PackageManagerDetectionError extends PackageManagerDetectionErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot detect package manager at "${this.searchPath}": ${this.reason}`;
	}
}

/** @internal */
export const WorkspaceDiscoveryErrorBase = Data.TaggedError("WorkspaceDiscoveryError");

/** Emitted when workspace package discovery fails. */
export class WorkspaceDiscoveryError extends WorkspaceDiscoveryErrorBase<{
	readonly root: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Workspace discovery failed at "${this.root}": ${this.reason}`;
	}
}

// ── Package Errors ───────────────────────────────────────────────────

/** @internal */
export const PackageJsonParseErrorBase = Data.TaggedError("PackageJsonParseError");

/** Emitted when a package.json file cannot be parsed or validated. */
export class PackageJsonParseError extends PackageJsonParseErrorBase<{
	readonly filePath: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse package.json at "${this.filePath}": ${String(this.cause)}`;
	}
}

/** @internal */
export const PackageNotFoundErrorBase = Data.TaggedError("PackageNotFoundError");

/** Emitted when a named package is not found in the workspace. */
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

/** @internal */
export const CyclicDependencyErrorBase = Data.TaggedError("CyclicDependencyError");

/** Emitted when a cycle is detected in the dependency graph. */
export class CyclicDependencyError extends CyclicDependencyErrorBase<{
	readonly cycle: ReadonlyArray<string>;
}> {
	get message(): string {
		return `Cyclic dependency detected: ${this.cycle.join(" -> ")}`;
	}
}

/** @internal */
export const DependencyResolutionErrorBase = Data.TaggedError("DependencyResolutionError");

/** Emitted when a dependency cannot be resolved within the workspace. */
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

/** @internal */
export const GitNotAvailableErrorBase = Data.TaggedError("GitNotAvailableError");

/** Emitted when git is not installed or the directory is not a git repository. */
export class GitNotAvailableError extends GitNotAvailableErrorBase<{
	readonly reason: string;
}> {
	get message(): string {
		return `Git is not available: ${this.reason}`;
	}
}

/** @internal */
export const ChangeDetectionErrorBase = Data.TaggedError("ChangeDetectionError");

/** Emitted when a git operation fails during change detection. */
export class ChangeDetectionError extends ChangeDetectionErrorBase<{
	readonly operation: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Change detection failed during "${this.operation}": ${this.reason}`;
	}
}

// ── Lockfile Errors ─────────────────────────────────────────────────

/** @internal */
export const LockfileReadErrorBase = Data.TaggedError("LockfileReadError");

/** Emitted when a lockfile cannot be read from disk. */
export class LockfileReadError extends LockfileReadErrorBase<{
	readonly lockfilePath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Failed to read lockfile at "${this.lockfilePath}": ${this.reason}`;
	}
}

/** @internal */
export const LockfileParseErrorBase = Data.TaggedError("LockfileParseError");

/** Emitted when a lockfile exists but cannot be parsed. */
export class LockfileParseError extends LockfileParseErrorBase<{
	readonly lockfilePath: string;
	readonly format: "pnpm" | "npm" | "yarn" | "bun";
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse ${this.format} lockfile at "${this.lockfilePath}"`;
	}
}

/** @internal */
export const LockfileIntegrityErrorBase = Data.TaggedError("LockfileIntegrityError");

/** Emitted when integrity checking cannot complete. */
export class LockfileIntegrityError extends LockfileIntegrityErrorBase<{
	readonly reason: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Integrity check failed: ${this.reason}`;
	}
}
