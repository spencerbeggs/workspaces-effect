/**
 * PublishabilityDetector service — determines which packages are
 * publishable and where they publish to.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";
import type { PublishTarget } from "../schemas/publish.js";

/**
 * Service for detecting whether a workspace package is publishable and
 * identifying its publish targets (npm, GitHub Packages, etc.).
 *
 * Inspects `package.json` fields such as `private`, `publishConfig`, and
 * `repository` to determine publishability and target registries.
 *
 * @remarks
 * PublishabilityDetector is part of the Configuration and Lockfiles service
 * group. It is a pure service with no dependencies on other services — it
 * operates solely on the {@link WorkspacePackage} data and the workspace root
 * path passed to it.
 *
 * A package is considered publishable when `private` is not `true` and it has a
 * `name` and `version`. The returned {@link PublishTarget} array describes where
 * the package would be published (e.g., npmjs.org, GitHub Packages) based on
 * `publishConfig.registry` and other signals.
 *
 * The live layer (`PublishabilityDetectorLive`) is a pure layer with no
 * dependencies — it can be provided standalone or via `WorkspacesLive` /
 * `WorkspacesFullLive`.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/PublishabilityDetector`. Since this service
 * has no dependencies, the layer is constructed with `Layer.succeed` rather than
 * `Layer.effect`.
 *
 * @example Checking publishability of all packages
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { PublishabilityDetector, WorkspaceDiscovery, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   const publishability = yield* PublishabilityDetector;
 *   const packages = yield* discovery.listPackages();
 *
 *   for (const pkg of packages) {
 *     const targets = yield* publishability.detect(pkg, "/path/to/monorepo");
 *     if (targets.length > 0) {
 *       console.log(`${pkg.name} publishes to:`, targets.map((t) => t.registry));
 *     } else {
 *       console.log(`${pkg.name} is not publishable`);
 *     }
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
export class PublishabilityDetector extends Context.Tag("@spencerbeggs/workspaces-effect/PublishabilityDetector")<
	PublishabilityDetector,
	{
		/**
		 * Detect publish targets for a workspace package.
		 *
		 * Analyzes the package's `package.json` fields to determine if and where
		 * it can be published.
		 *
		 * @param pkg - The {@link WorkspacePackage} to analyze.
		 * @param root - Absolute path to the workspace root directory.
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link PublishTarget} records. An empty array indicates the package is
		 *   not publishable. Never fails.
		 */
		readonly detect: (pkg: WorkspacePackage, root: string) => Effect.Effect<ReadonlyArray<PublishTarget>>;
	}
>() {}
