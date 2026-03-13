/**
 * Top-level composite layers that wire all services together.
 *
 * - WorkspacesLive: all services except git-dependent ones (ChangeDetector,
 *   PackageResolver). Requires FileSystem + Path.
 * - WorkspacesFullLive: all services including git-dependent ones.
 *   Additionally requires CommandExecutor.
 *
 * Individual *Live layers remain available for fine-grained composition.
 */

import { Layer } from "effect";
import { ChangeDetectorLive } from "./ChangeDetectorLive.js";
import { DependencyGraphLive } from "./DependencyGraphLive.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { PackageResolverLive } from "./PackageResolverLive.js";
import { PublishabilityDetectorLive } from "./PublishabilityDetectorLive.js";
import { TopologicalSorterLive } from "./TopologicalSorterLive.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/**
 * Composite layer providing all services except git-dependent ones.
 *
 * Provides: WorkspaceRoot, PackageManagerDetector, WorkspaceDiscovery,
 * DependencyGraph, TopologicalSorter, LockfileReader, PublishabilityDetector.
 *
 * Requires: FileSystem + Path (provide via NodeContext.layer or BunContext.layer).
 *
 * @example
 * ```typescript
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesLive } from "@spencerbeggs/workspaces-effect";
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 */
export const WorkspacesLive = Layer.mergeAll(
	WorkspaceRootLive,
	PackageManagerDetectorLive,
	WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive)),
	DependencyGraphLive.pipe(Layer.provide(WorkspaceDiscoveryLive), Layer.provide(WorkspaceRootLive)),
	TopologicalSorterLive.pipe(
		Layer.provide(DependencyGraphLive),
		Layer.provide(WorkspaceDiscoveryLive),
		Layer.provide(WorkspaceRootLive),
	),
	LockfileReaderLive.pipe(Layer.provide(WorkspaceRootLive), Layer.provide(PackageManagerDetectorLive)),
	PublishabilityDetectorLive, // pure layer, no dependencies
);

/**
 * Composite layer providing all services including git-dependent ones.
 *
 * Extends WorkspacesLive with PackageResolver and ChangeDetector.
 *
 * Requires: FileSystem + Path + CommandExecutor (provide via NodeContext.layer
 * or BunContext.layer).
 *
 * @example
 * ```typescript
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesFullLive } from "@spencerbeggs/workspaces-effect";
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 */
export const WorkspacesFullLive = Layer.mergeAll(
	WorkspacesLive,
	PackageResolverLive.pipe(Layer.provide(WorkspacesLive)),
	ChangeDetectorLive.pipe(Layer.provide(PackageResolverLive), Layer.provide(WorkspacesLive)),
);
