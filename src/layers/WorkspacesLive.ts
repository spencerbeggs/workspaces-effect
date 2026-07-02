/**
 * Top-level composite layers that wire all services together.
 *
 * - {@link WorkspacesLive}: all services except git-dependent ones
 *   (`ChangeDetector`, `PackageResolver`). Requires `FileSystem` + `Path`.
 * - {@link WorkspacesFullLive}: all services including git-dependent ones.
 *   Additionally requires `CommandExecutor`.
 *
 * Individual `*Live` layers remain available for fine-grained composition.
 *
 * @packageDocumentation
 */

import { Layer } from "effect";
import { CatalogResolverLive } from "./CatalogResolverLive.js";
import { ChangeDetectorLive } from "./ChangeDetectorLive.js";
import { DependencyGraphLive } from "./DependencyGraphLive.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { PackageResolverLive } from "./PackageResolverLive.js";
import { PointInTimeWorkspaceLive } from "./PointInTimeWorkspaceLive.js";
import { PublishabilityDetectorLive } from "./PublishabilityDetectorLive.js";
import { TopologicalSorterLive } from "./TopologicalSorterLive.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/**
 * Composite layer providing all services except git-dependent ones.
 *
 * Provides: `WorkspaceRoot`, `PackageManagerDetector`, `WorkspaceDiscovery`,
 * `DependencyGraph`, `TopologicalSorter`, `LockfileReader`, `PublishabilityDetector`,
 * `CatalogResolver`.
 *
 * @remarks
 * Requires `FileSystem` and `Path` from `@effect/platform`. Provide these
 * via `NodeContext.layer` (Node.js) or `BunContext.layer` (Bun).
 *
 * @privateRemarks
 * Wires individual `*Live` layers together using `Layer.mergeAll` with
 * `Layer.provide` to thread dependencies. `PublishabilityDetectorLive` is
 * a pure layer with no dependencies.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesLive } from "workspaces-effect";
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
	CatalogResolverLive.pipe(
		Layer.provide(WorkspaceRootLive),
		Layer.provide(LockfileReaderLive.pipe(Layer.provide(WorkspaceRootLive), Layer.provide(PackageManagerDetectorLive))),
		Layer.provide(WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive))),
	),
);

/**
 * Composite layer providing all services including git-dependent ones.
 *
 * Extends {@link WorkspacesLive} with `PackageResolver`, `ChangeDetector`,
 * and `PointInTimeWorkspace`.
 *
 * @remarks
 * Requires `FileSystem`, `Path`, and `CommandExecutor` from `@effect/platform`.
 * Provide these via `NodeContext.layer` (Node.js) or `BunContext.layer` (Bun).
 *
 * @privateRemarks
 * Composes `WorkspacesLive` with `PackageResolverLive` and `ChangeDetectorLive`,
 * wiring the graph and resolver dependencies via `Layer.provide`.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspacesFullLive } from "workspaces-effect";
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export const WorkspacesFullLive = Layer.mergeAll(
	WorkspacesLive,
	PackageResolverLive.pipe(Layer.provide(WorkspacesLive)),
	ChangeDetectorLive.pipe(Layer.provide(PackageResolverLive), Layer.provide(WorkspacesLive)),
	PointInTimeWorkspaceLive.pipe(Layer.provide(WorkspacesLive)),
);
