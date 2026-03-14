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
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link WorkspacePackage} records, or fails with
		 *   {@link WorkspaceDiscoveryError} if workspace patterns cannot be resolved.
		 */
		readonly listPackages: () => Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>;

		/**
		 * Get a specific workspace package by name.
		 *
		 * @param name - The package name as declared in its `package.json` `name` field.
		 * @returns An Effect that succeeds with the matching {@link WorkspacePackage},
		 *   or fails with {@link PackageNotFoundError} if no workspace package has that
		 *   name, or {@link WorkspaceDiscoveryError} if discovery itself fails.
		 */
		readonly getPackage: (
			name: string,
		) => Effect.Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>;
	}
>() {}
