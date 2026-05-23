/**
 * WorkspaceDiscovery service — lists workspace packages.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageNotFoundError } from "../errors/PackageNotFoundError.js";
import type { WorkspaceDiscoveryError } from "../errors/WorkspaceDiscoveryError.js";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Service for discovering workspace packages in a monorepo.
 *
 * Reads workspace patterns from the PM-specific config (e.g., `pnpm-workspace.yaml`,
 * `package.json` `workspaces` field), resolves glob patterns against the filesystem,
 * and reads each matched `package.json` to produce {@link WorkspacePackage} records.
 *
 * @remarks
 * WorkspaceDiscovery is the last service in the Discovery group and the primary
 * data source for downstream services. DependencyGraph, TopologicalSorter,
 * PackageResolver, and ChangeDetector all depend on the package list it produces.
 *
 * The live layer (`WorkspaceDiscoveryLive`) depends on `WorkspaceRoot` and
 * `PackageManagerDetector`. It requires `FileSystem` and `Path` from
 * `@effect/platform`. Use `WorkspacesLive` or `WorkspacesFullLive` to get all
 * wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/WorkspaceDiscovery`. Dependencies (WorkspaceRoot,
 * PackageManagerDetector) are resolved at layer construction time so that service
 * methods have `R = never`.
 *
 * @example Listing all workspace packages
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   const packages = yield* discovery.listPackages();
 *   for (const pkg of packages) {
 *     console.log(`${pkg.name} @ ${pkg.path}`);
 *   }
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export class WorkspaceDiscovery extends Context.Tag("@spencerbeggs/workspaces-effect/WorkspaceDiscovery")<
	WorkspaceDiscovery,
	{
		/**
		 * List all workspace packages.
		 *
		 * Resolves workspace glob patterns and reads each matched `package.json`.
		 *
		 * @param cwd - Optional starting directory. When provided, the workspace
		 *   root is resolved fresh from `cwd` for this call (results cached per
		 *   resolved root). When omitted, uses the root that was eagerly resolved
		 *   from `process.cwd()` at layer construction time.
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link WorkspacePackage} records, or fails with
		 *   {@link WorkspaceDiscoveryError} if workspace patterns cannot be resolved.
		 */
		readonly listPackages: (cwd?: string) => Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>;

		/**
		 * Get a specific workspace package by name.
		 *
		 * @param name - The package name as declared in its `package.json` `name` field.
		 * @param cwd - Optional starting directory. See {@link listPackages} for behavior.
		 * @returns An Effect that succeeds with the matching {@link WorkspacePackage},
		 *   or fails with {@link PackageNotFoundError} if no workspace package has that
		 *   name, or {@link WorkspaceDiscoveryError} if discovery itself fails.
		 */
		readonly getPackage: (
			name: string,
			cwd?: string,
		) => Effect.Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>;

		/**
		 * Get a map of workspace-relative directory paths to packages.
		 *
		 * Useful for mapping lockfile importer keys to their workspace packages.
		 * Built from `listPackages()` output and inherits its caching.
		 *
		 * @param cwd - Optional starting directory. See {@link listPackages} for behavior.
		 * @returns An Effect that succeeds with a ReadonlyMap keyed by relativePath.
		 */
		readonly importerMap: (
			cwd?: string,
		) => Effect.Effect<ReadonlyMap<string, WorkspacePackage>, WorkspaceDiscoveryError>;

		/**
		 * Discard cached discovery results so the next {@link listPackages}
		 * (and {@link getPackage} / {@link importerMap}, which build on it)
		 * re-reads every `package.json` from disk.
		 *
		 * @remarks
		 * `listPackages` memoizes its result per resolved workspace root for the
		 * lifetime of the layer. That cache is correct for a static tree, but a
		 * process that mutates `package.json` mid-run — for example running
		 * `changeset version` to bump versions and then reading the new versions
		 * back — would otherwise observe the pre-mutation snapshot. Call
		 * `refresh` after such a mutation to force a re-scan.
		 *
		 * The resolved workspace root itself is not discarded (the root does not
		 * move when package contents change), so the next call pays only the
		 * package re-scan, not the root walk. `refresh` clears the cache for
		 * every resolved root.
		 *
		 * @returns An Effect that clears the cache and succeeds with `void`.
		 */
		readonly refresh: () => Effect.Effect<void>;
	}
>() {}
