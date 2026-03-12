/**
 * Composite layer that provides all Phase 3 change detection services.
 *
 * Combines PackageResolverLive and ChangeDetectorLive into a single
 * layer. Threads WorkspaceDiscovery and DependencyGraph as shared deps.
 */

import { Layer } from "effect";
import { ChangeDetectorLive } from "./ChangeDetectorLive.js";
import { PackageResolverLive } from "./PackageResolverLive.js";

/**
 * Composite layer providing PackageResolver and ChangeDetector.
 *
 * Requires:
 * - WorkspaceDiscovery (for package list)
 * - DependencyGraph (for affected computation)
 * - CommandExecutor (for git — provide via NodeContext.layer)
 * - Path (for path operations)
 *
 * Usage:
 * ```typescript
 * import { NodeContext } from "@effect/platform-node";
 *
 * const fullLayer = ChangeDetectionLive.pipe(
 *   Layer.provide(DependencyGraphLive),
 *   Layer.provide(DiscoveryLive),
 *   Layer.provide(NodeContext.layer),
 * );
 * ```
 */
export const ChangeDetectionLive = Layer.mergeAll(
	PackageResolverLive,
	ChangeDetectorLive.pipe(Layer.provide(PackageResolverLive)),
);
