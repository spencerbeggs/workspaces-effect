/**
 * Integration tests for composed discovery layers.
 *
 * Tests that WorkspaceRootLive and PackageManagerDetectorLive compose
 * correctly and can be used together in a single Effect program.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/** Create a mock filesystem for integration testing. */
const mockFs = (files: Record<string, string | true>) =>
	FileSystem.layerNoop({
		exists: (path) => Effect.succeed(path in files),
		readFileString: (path) => {
			const content = files[path];
			if (content === undefined) {
				return Effect.die(new Error(`ENOENT: ${path}`));
			}
			return Effect.succeed(typeof content === "string" ? content : "");
		},
	});

describe("Discovery layers integration", () => {
	it("finds root then detects pnpm", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - packages/*",
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				packageManager: "pnpm@10.32.1",
			}),
		};

		const layer = Layer.mergeAll(WorkspaceRootLive, PackageManagerDetectorLive).pipe(
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				const rootPath = yield* root.find("/projects/monorepo/packages/pkg-a");

				const detector = yield* PackageManagerDetector;
				const pm = yield* detector.detect(rootPath);

				return { rootPath, pm };
			}).pipe(Effect.provide(layer)),
		);

		expect(result.rootPath).toBe("/projects/monorepo");
		expect(result.pm.type).toBe("pnpm");
		expect(result.pm.version).toBe("10.32.1");
	});

	it("finds root then detects bun", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/bun.lock": true,
			"/projects/monorepo/package.json": JSON.stringify({
				name: "bun-monorepo",
				workspaces: ["packages/*"],
				packageManager: "bun@1.2.0",
			}),
		};

		const layer = Layer.mergeAll(WorkspaceRootLive, PackageManagerDetectorLive).pipe(
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				const rootPath = yield* root.find("/projects/monorepo");

				const detector = yield* PackageManagerDetector;
				const pm = yield* detector.detect(rootPath);

				return { rootPath, pm };
			}).pipe(Effect.provide(layer)),
		);

		expect(result.rootPath).toBe("/projects/monorepo");
		expect(result.pm.type).toBe("bun");
		expect(result.pm.version).toBe("1.2.0");
	});

	it("finds root then detects yarn", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/yarn.lock": true,
			"/projects/monorepo/package.json": JSON.stringify({
				name: "yarn-monorepo",
				workspaces: ["packages/*"],
				packageManager: "yarn@4.1.0",
			}),
		};

		const layer = Layer.mergeAll(WorkspaceRootLive, PackageManagerDetectorLive).pipe(
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				const rootPath = yield* root.find("/projects/monorepo");

				const detector = yield* PackageManagerDetector;
				const pm = yield* detector.detect(rootPath);

				return { rootPath, pm };
			}).pipe(Effect.provide(layer)),
		);

		expect(result.rootPath).toBe("/projects/monorepo");
		expect(result.pm.type).toBe("yarn");
		expect(result.pm.version).toBe("4.1.0");
	});

	it("finds root then detects npm as fallback", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/package.json": JSON.stringify({
				name: "npm-monorepo",
				workspaces: ["packages/*"],
			}),
		};

		const layer = Layer.mergeAll(WorkspaceRootLive, PackageManagerDetectorLive).pipe(
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				const rootPath = yield* root.find("/projects/monorepo");

				const detector = yield* PackageManagerDetector;
				const pm = yield* detector.detect(rootPath);

				return { rootPath, pm };
			}).pipe(Effect.provide(layer)),
		);

		expect(result.rootPath).toBe("/projects/monorepo");
		expect(result.pm.type).toBe("npm");
	});

	it("handles error when root not found", async () => {
		const layer = Layer.mergeAll(WorkspaceRootLive, PackageManagerDetectorLive).pipe(
			Layer.provide(Layer.mergeAll(mockFs({}), Path.layer)),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root
					.find("/nonexistent")
					.pipe(Effect.catchTag("WorkspaceRootNotFoundError", (e) => Effect.succeed({ error: e._tag })));
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toEqual({ error: "WorkspaceRootNotFoundError" });
	});
});
