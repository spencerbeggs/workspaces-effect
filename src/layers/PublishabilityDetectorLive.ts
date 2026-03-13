/**
 * Default live implementation of PublishabilityDetector service.
 *
 * Implements standard npm publishing semantics:
 * - private + no publishConfig.access → not publishable
 * - publishConfig.access set → publishable (overrides private)
 * - not private → publishable with defaults
 *
 * This layer is pure — no FileSystem or other dependencies.
 * Custom layers can override by providing their own Layer for
 * PublishabilityDetector.
 */

import { Effect, Layer } from "effect";
import { PublishTarget } from "../schemas/publish.js";
import { PublishabilityDetector } from "../services/PublishabilityDetector.js";

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
