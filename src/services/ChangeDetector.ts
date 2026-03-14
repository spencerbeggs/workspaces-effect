/**
 * ChangeDetector service — git-based change detection for workspace packages.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context, Schema } from "effect";
import type { ChangeDetectionError } from "../errors/ChangeDetectionError.js";
import type { CyclicDependencyError } from "../errors/CyclicDependencyError.js";
import type { GitNotAvailableError } from "../errors/GitNotAvailableError.js";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Options for change detection operations.
 *
 * Configures the git ref range and whether to include uncommitted changes.
 * All fields have sensible defaults and can be omitted.
 *
 * @remarks
 * This is an Effect `Schema.Class`, so instances can be created with
 * `new ChangeDetectionOptions({ ... })` or decoded from unknown data via
 * `Schema.decodeUnknown(ChangeDetectionOptions)`. Default values are applied
 * for omitted fields.
 *
 * @example Creating options
 * ```typescript
 * import { ChangeDetectionOptions } from "workspaces-effect";
 *
 * // Use defaults: base="HEAD~1", head="HEAD", includeUncommitted=false
 * const defaults = new ChangeDetectionOptions({});
 *
 * // Compare against a specific branch
 * const vsBranch = new ChangeDetectionOptions({ base: "origin/main" });
 *
 * // Include working tree changes
 * const withUncommitted = new ChangeDetectionOptions({
 *   base: "HEAD~3",
 *   includeUncommitted: true,
 * });
 * ```
 *
 * @public
 */
export class ChangeDetectionOptions extends Schema.Class<ChangeDetectionOptions>("ChangeDetectionOptions")({
	/**
	 * Base ref to compare against (commit SHA, branch, tag).
	 *
	 * @defaultValue `"HEAD~1"`
	 */
	base: Schema.optionalWith(Schema.String, { default: () => "HEAD~1" }),

	/**
	 * Head ref to compare to.
	 *
	 * @defaultValue `"HEAD"`
	 */
	head: Schema.optionalWith(Schema.String, { default: () => "HEAD" }),

	/**
	 * If true, include uncommitted working tree changes in addition to
	 * committed changes between `base` and `head`.
	 *
	 * @defaultValue `false`
	 */
	includeUncommitted: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

/**
 * Service for detecting changes in workspace packages using git.
 *
 * Provides progressive disclosure: raw changed files, changed packages, and
 * affected packages (including transitive dependents). All git operations use
 * the `Command` service from `@effect/platform` for runtime independence.
 *
 * @remarks
 * ChangeDetector is the second service in the Change Detection group. It
 * composes PackageResolver (to map files to packages), DependencyGraph (for
 * transitive impact), and git commands (for diff output). This makes it the
 * most dependency-heavy service in the library.
 *
 * The three methods offer increasing levels of analysis:
 * - `changedFiles` — raw git diff output (file paths only)
 * - `changedPackages` — files resolved to their owning workspace packages
 * - `affectedPackages` — changed packages plus all transitive dependents
 *
 * The live layer (`ChangeDetectorLive`) depends on `PackageResolver`,
 * `DependencyGraph`, `TopologicalSorter`, and `WorkspaceRoot`. It requires
 * `FileSystem`, `Path`, and `CommandExecutor` from `@effect/platform`. Use
 * `WorkspacesFullLive` to get all wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/ChangeDetector`. The CommandExecutor
 * dependency is resolved at layer construction time so that service methods
 * have `R = never`.
 *
 * @example Detecting affected packages in a CI pipeline
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { ChangeDetector, ChangeDetectionOptions, WorkspacesFullLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   const options = new ChangeDetectionOptions({ base: "origin/main" });
 *
 *   const affected = yield* detector.affectedPackages(options);
 *   console.log("Packages to rebuild:", affected.map((p) => p.name));
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export class ChangeDetector extends Context.Tag("@spencerbeggs/workspaces-effect/ChangeDetector")<
	ChangeDetector,
	{
		/**
		 * Get file paths changed between base and head refs.
		 *
		 * Runs `git diff --name-only` between the configured refs. When
		 * `includeUncommitted` is true, also includes `git diff --name-only` for
		 * the working tree.
		 *
		 * @param options - The {@link ChangeDetectionOptions} specifying the ref range.
		 * @returns An Effect that succeeds with a readonly array of changed file paths
		 *   (relative to the workspace root), or fails with
		 *   {@link GitNotAvailableError} if git is not installed, or
		 *   {@link ChangeDetectionError} if the git command fails.
		 */
		readonly changedFiles: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<ReadonlyArray<string>, GitNotAvailableError | ChangeDetectionError>;

		/**
		 * Get packages that contain changed files.
		 *
		 * Combines `changedFiles` with PackageResolver to determine which workspace
		 * packages own the changed files. Files outside workspace packages are ignored.
		 *
		 * @param options - The {@link ChangeDetectionOptions} specifying the ref range.
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link WorkspacePackage} records representing directly changed packages, or
		 *   fails with {@link GitNotAvailableError} or {@link ChangeDetectionError}.
		 */
		readonly changedPackages: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<ReadonlyArray<WorkspacePackage>, GitNotAvailableError | ChangeDetectionError>;

		/**
		 * Get changed packages plus all packages that transitively depend on them.
		 *
		 * Extends `changedPackages` by walking the reverse dependency graph to find
		 * all packages that could be affected by the changes.
		 *
		 * @param options - The {@link ChangeDetectionOptions} specifying the ref range.
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link WorkspacePackage} records representing all affected packages, or
		 *   fails with {@link GitNotAvailableError}, {@link ChangeDetectionError}, or
		 *   {@link CyclicDependencyError}.
		 */
		readonly affectedPackages: (
			options: ChangeDetectionOptions,
		) => Effect.Effect<
			ReadonlyArray<WorkspacePackage>,
			GitNotAvailableError | ChangeDetectionError | CyclicDependencyError
		>;
	}
>() {}
