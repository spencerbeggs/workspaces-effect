/**
 * ChangeDetector service — git-based change detection for workspace packages.
 */

import type { Effect } from "effect";
import { Context, Schema } from "effect";
import type { ChangeDetectionError, CyclicDependencyError, GitNotAvailableError } from "../errors/index.js";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Options for change detection operations.
 */
export class ChangeDetectionOptions extends Schema.Class<ChangeDetectionOptions>("ChangeDetectionOptions")({
	/** Base ref to compare against (commit SHA, branch, tag). Default: "HEAD~1". */
	base: Schema.optionalWith(Schema.String, { default: () => "HEAD~1" }),

	/** Head ref to compare to. Default: "HEAD". */
	head: Schema.optionalWith(Schema.String, { default: () => "HEAD" }),

	/** If true, include uncommitted working tree changes. */
	includeUncommitted: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

/**
 * Service for detecting changes in workspace packages using git.
 *
 * Provides progressive disclosure: raw changed files, changed packages,
 * and affected packages (including transitive dependents).
 *
 * Requires git to be available. All git operations use the Command
 * service from Effect platform for runtime independence.
 */
export class ChangeDetector extends Context.Tag("@spencerbeggs/workspaces-effect/ChangeDetector")<
	ChangeDetector,
	{
		/** Get file paths changed between base and head refs. */
		readonly changedFiles: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<ReadonlyArray<string>, GitNotAvailableError | ChangeDetectionError>;

		/** Get packages that contain changed files. */
		readonly changedPackages: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError>;

		/** Get changed packages plus all packages that transitively depend on them. */
		readonly affectedPackages: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<
			ReadonlyArray<WorkspacePackage>,
			GitNotAvailableError | ChangeDetectionError | CyclicDependencyError
		>;
	}
>() {}
