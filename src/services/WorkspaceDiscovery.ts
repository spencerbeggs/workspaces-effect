/**
 * WorkspaceDiscovery service — lists workspace packages.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageNotFoundError, WorkspaceDiscoveryError } from "../errors/index.js";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Service for discovering workspace packages in a monorepo.
 *
 * Reads workspace patterns from the PM-specific config, resolves
 * glob patterns, and reads package.json for each workspace package.
 */
export class WorkspaceDiscovery extends Context.Tag("@spencerbeggs/workspaces-effect/WorkspaceDiscovery")<
	WorkspaceDiscovery,
	{
		/** List all workspace packages. */
		readonly listPackages: () => Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError>;

		/** Get a specific workspace package by name. */
		readonly getPackage: (
			name: string,
		) => Effect.Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>;
	}
>() {}
