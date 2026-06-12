/**
 * Shared layer builders for integration tests.
 */

import { Path } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Logger } from "effect";
import { LockfileReaderLive } from "../../src/layers/LockfileReaderLive.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import type { PackageManagerType } from "../../src/schemas/core.js";
import { PackageManagerDetector } from "../../src/services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

export const platformLayer = Layer.mergeAll(
	NodeFileSystem.layer,
	Path.layer,
	Logger.replace(Logger.defaultLogger, Logger.none),
);

export const makeLockfileLayer = (pm: PackageManagerType, fixturePath: string) =>
	LockfileReaderLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(fixturePath) }),
				Layer.succeed(PackageManagerDetector, {
					detect: () => Effect.succeed({ type: pm, version: undefined, runtime: pm === "bun" ? "bun" : "node" }),
				}),
				platformLayer,
			),
		),
	);

export const makeDiscoveryLayer = (fixturePath: string) =>
	WorkspaceDiscoveryLive.pipe(
		Layer.provide(
			Layer.mergeAll(Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(fixturePath) }), platformLayer),
		),
	);
