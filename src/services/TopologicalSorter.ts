/**
 * TopologicalSorter service — produces build ordering from the dependency graph.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { CyclicDependencyError, PackageNotFoundError } from "../errors/index.js";

/**
 * Service for topological sorting of workspace packages.
 *
 * Uses Kahn's algorithm (BFS-based) for deterministic ordering
 * and natural parallel level detection.
 */
export class TopologicalSorter extends Context.Tag("@spencerbeggs/workspaces-effect/TopologicalSorter")<
	TopologicalSorter,
	{
		/** Sort all packages in topological order (dependencies first). */
		readonly sort: () => Effect.Effect<ReadonlyArray<string>, CyclicDependencyError>;

		/** Sort a subset of packages including their transitive dependencies. */
		readonly sortSubset: (
			names: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError>;

		/** Get packages grouped by parallel execution level. */
		readonly levels: () => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError>;
	}
>() {}
