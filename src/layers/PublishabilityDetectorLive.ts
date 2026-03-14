/**
 * Default live implementation of the {@link PublishabilityDetector} service.
 *
 * Implements standard npm publishing semantics:
 * - `private: true` + no `publishConfig.access` -- not publishable
 * - `publishConfig.access` set -- publishable (overrides `private`)
 * - not `private` -- publishable with defaults
 *
 * @packageDocumentation
 * @internal
 */

import { Effect, Layer } from "effect";
import { PublishTarget } from "../schemas/publish.js";
import { PublishabilityDetector } from "../services/PublishabilityDetector.js";

/**
 * Live layer for the {@link PublishabilityDetector} service.
 *
 * Determines whether a workspace package is publishable to npm based
 * on its `private` flag and `publishConfig` settings.
 *
 * @remarks
 * This layer is pure -- it has no dependencies on `FileSystem`, `Path`, or
 * any other platform services. It uses `Layer.succeed` rather than
 * `Layer.effect`. Custom layers can override by providing their own
 * `Layer` for `PublishabilityDetector`.
 *
 * @privateRemarks
 * Builds a single {@link PublishTarget} from `publishConfig` fields,
 * defaulting to the public npm registry when no registry is specified.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { PublishabilityDetector, PublishabilityDetectorLive } from "workspaces-effect";
 * import { WorkspacePackage } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* PublishabilityDetector;
 *   const targets = yield* detector.detect(somePackage, "/path/to/root");
 *   return targets;
 * });
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(PublishabilityDetectorLive))
 * );
 * ```
 *
 * @public
 */
export const PublishabilityDetectorLive = Layer.succeed(PublishabilityDetector, {
	detect: (pkg, _root) =>
		Effect.gen(function* () {
			const publishConfig = pkg.publishConfig;

			// Private with no publishConfig.access → not publishable
			if (pkg.private && !publishConfig?.access) {
				yield* Effect.logDebug("Publishability resolved").pipe(
					Effect.annotateLogs({
						"workspace.package": pkg.name,
						"workspace.publishable": false,
						"workspace.targets.count": 0,
					}),
				);
				return [] as ReadonlyArray<PublishTarget>;
			}

			// Publishable — build single target from publishConfig
			const target = new PublishTarget({
				name: pkg.name,
				registry: publishConfig?.registry ?? "https://registry.npmjs.org/",
				directory: publishConfig?.directory ?? ".",
				access: publishConfig?.access ?? "public",
				provenance: false,
			});

			const targets = [target] as ReadonlyArray<PublishTarget>;

			yield* Effect.logDebug("Publishability resolved").pipe(
				Effect.annotateLogs({
					"workspace.package": pkg.name,
					"workspace.publishable": true,
					"workspace.targets.count": targets.length,
				}),
			);

			return targets;
		}).pipe(
			Effect.withSpan("PublishabilityDetector.detect", {
				attributes: { "workspace.package": pkg.name },
			}),
		),
});
