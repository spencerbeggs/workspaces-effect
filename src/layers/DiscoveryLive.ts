/**
 * Composite layer that provides all Phase 1 discovery services.
 *
 * Combines WorkspaceRootLive, PackageManagerDetectorLive, and
 * WorkspaceDiscoveryLive into a single layer that only requires
 * platform dependencies (FileSystem, Path).
 */

import type { FileSystem, Path } from "@effect/platform";
import { Layer } from "effect";
import type { WorkspaceDiscoveryError } from "../errors/index.js";
import type { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import type { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import type { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/**
 * Composite layer providing all discovery services.
 *
 * Usage with Node.js:
 * ```typescript
 * import { NodeContext } from "effect/platform-node";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   const detector = yield* PackageManagerDetector;
 *   const discovery = yield* WorkspaceDiscovery;
 *   // ...
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(DiscoveryLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 */
export const DiscoveryLive: Layer.Layer<
	WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	FileSystem.FileSystem | Path.Path
> = Layer.mergeAll(
	WorkspaceRootLive,
	PackageManagerDetectorLive,
	WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive)),
);
