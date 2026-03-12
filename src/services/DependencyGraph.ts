/**
 * DependencyGraph service — builds a directed graph of inter-workspace dependencies.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageNotFoundError } from "../errors/index.js";

/**
 * Service for querying the inter-workspace dependency graph.
 *
 * The graph contains only edges between workspace packages.
 * External npm dependencies are excluded.
 */
export class DependencyGraph extends Context.Tag("@spencerbeggs/workspaces-effect/DependencyGraph")<
	DependencyGraph,
	{
		/** Get direct dependencies of a package (packages it depends on). */
		readonly dependenciesOf: (name: string) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

		/** Get direct dependents of a package (packages that depend on it). */
		readonly dependentsOf: (name: string) => Effect.Effect<ReadonlyArray<string>, PackageNotFoundError>;

		/** Get all package names in the graph. */
		readonly packages: () => Effect.Effect<ReadonlyArray<string>>;

		/** Check if the graph contains any cycles. */
		readonly hasCycle: () => Effect.Effect<boolean>;

		/** Get the full adjacency map (package name to its dependency names). */
		readonly adjacencyMap: () => Effect.Effect<ReadonlyMap<string, ReadonlySet<string>>>;
	}
>() {}
