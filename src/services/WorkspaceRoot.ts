/**
 * WorkspaceRoot service — finds the monorepo root directory.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspaceRootNotFoundError } from "../errors/index.js";

/**
 * Service for finding the workspace root directory.
 *
 * Walks up from a given directory looking for workspace markers
 * (pnpm-workspace.yaml, package.json with workspaces field).
 */
export class WorkspaceRoot extends Context.Tag("@spencerbeggs/workspaces-effect/WorkspaceRoot")<
	WorkspaceRoot,
	{
		/** Find the workspace root starting from the given directory. */
		readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError>;
	}
>() {}
