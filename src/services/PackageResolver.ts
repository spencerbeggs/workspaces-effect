/**
 * PackageResolver service — maps file paths to their owning workspace packages.
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";

/**
 * Service for resolving file paths to workspace packages.
 *
 * Uses prefix matching on absolute paths to determine which workspace
 * package owns a given file. Built from WorkspaceDiscovery output at
 * layer construction time for fast lookups.
 */
export class PackageResolver extends Context.Tag("@spencerbeggs/workspaces-effect/PackageResolver")<
	PackageResolver,
	{
		/** Find which package owns a file path. Returns Option.none if outside all packages. */
		readonly resolveFile: (filePath: string) => Effect.Effect<Option.Option<WorkspacePackage>>;

		/** Batch resolve: map multiple file paths to their owning packages (deduped by package). */
		readonly resolveFiles: (filePaths: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, WorkspacePackage>>;

		/** Get all indexed package paths (sorted by path length, longest first). */
		readonly packagePaths: () => Effect.Effect<
			ReadonlyArray<{ readonly path: string; readonly package: WorkspacePackage }>
		>;
	}
>() {}
