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
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { DiscoveryLive } from "./DiscoveryLive.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/** Create a mock filesystem for integration testing. */
const mockFs = (files: Record<string, string | true>, dirs: Record<string, string[]> = {}) =>
	FileSystem.layerNoop({
		exists: (path) => Effect.succeed(path in files || path in dirs),
		readFileString: (path) => {
			const content = files[path];
			if (content === undefined) {
				return Effect.die(new Error(`ENOENT: ${path}`));
			}
			return Effect.succeed(typeof content === "string" ? content : "");
		},
		readDirectory: (path) => {
			const entries = dirs[path];
			if (entries === undefined) {
				return Effect.die(new Error(`ENOENT dir: ${path}`));
			}
			return Effect.succeed(entries);
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

describe("DiscoveryLive composite layer", () => {
	it("provides WorkspaceRoot and PackageManagerDetector together", async () => {
		const files: Record<string, string | true> = {
			"/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'",
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				packageManager: "pnpm@10.32.1",
			}),
		};

		const layer = DiscoveryLive.pipe(Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)));

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
		).pipe(Layer.provide(Layer.mergeAll(mockFs(files, dirs), Path.layer)));

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				return packages;
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("pkg-a");
	});
});
