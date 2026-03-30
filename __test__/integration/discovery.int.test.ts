/**
 * Integration tests for composed workspace layers.
 *
 * Tests that individual layers compose correctly and can be used
 * together in a single Effect program.
 */

import { Path } from "@effect/platform";
import { Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { PackageManagerDetectorLive } from "../../src/layers/PackageManagerDetectorLive.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "../../src/layers/WorkspaceRootLive.js";
import { PackageManagerDetector } from "../../src/services/PackageManagerDetector.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";
import { mockFs } from "../utils/mock-fs.js";

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
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
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
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
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
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
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
			Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
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
			Layer.provide(Layer.mergeAll(mockFs({}), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
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

describe("Workspace layers composition", () => {
	it("provides WorkspaceRoot and PackageManagerDetector together", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'",
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				packageManager: "pnpm@10.32.1",
			}),
		};

		// Use a mock WorkspaceRoot since DiscoveryLive now eagerly resolves
		// the workspace root at layer construction time via process.cwd().
		const mockRoot = Layer.succeed(WorkspaceRoot, {
			find: () => Effect.succeed("/projects/monorepo"),
		});

		const layer = Layer.mergeAll(
			mockRoot,
			PackageManagerDetectorLive,
			WorkspaceDiscoveryLive.pipe(Layer.provide(mockRoot)),
		).pipe(Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))));

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

	it("provides WorkspaceDiscovery with all dependencies wired", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'",
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				packageManager: "pnpm@10.32.1",
			}),
			"/projects/monorepo/packages/pkg-a/package.json": JSON.stringify({
				name: "pkg-a",
				version: "1.0.0",
			}),
		};
		const dirs: Record<string, string[]> = {
			"/projects/monorepo/packages": ["pkg-a"],
		};

		// WorkspaceDiscoveryLive internally calls rootService.find(process.cwd()),
		// so we provide a mock WorkspaceRoot that returns a known path.
		const mockRoot = Layer.succeed(WorkspaceRoot, {
			find: () => Effect.succeed("/projects/monorepo"),
		});

		const layer = Layer.mergeAll(
			mockRoot,
			PackageManagerDetectorLive,
			WorkspaceDiscoveryLive.pipe(Layer.provide(mockRoot)),
		).pipe(
			Layer.provide(Layer.mergeAll(mockFs(files, dirs), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				return packages;
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("my-monorepo");
		expect(result[0].relativePath).toBe(".");
		expect(result[1].name).toBe("pkg-a");
	});
});
