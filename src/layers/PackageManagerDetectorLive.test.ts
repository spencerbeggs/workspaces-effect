import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { PackageManagerDetectionError } from "../errors/PackageManagerDetectionError.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { PackageManagerDetectorLive } from "./PackageManagerDetectorLive.js";

/**
 * Create a mock FileSystem layer for testing PM detection.
 */
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

const testLayer = (files: Record<string, string | true>) =>
	PackageManagerDetectorLive.pipe(
		Layer.provide(Layer.mergeAll(mockFs(files), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none))),
	);

describe("PackageManagerDetectorLive", () => {
	it("detects pnpm from pnpm-workspace.yaml", async () => {
		const layer = testLayer({
			"/root/pnpm-workspace.yaml": true,
			"/root/package.json": JSON.stringify({
				packageManager: "pnpm@10.32.1+sha512-abc",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("pnpm");
		expect(result.version).toBe("10.32.1");
	});

	it("detects pnpm without version when packageManager field is absent", async () => {
		const layer = testLayer({
			"/root/pnpm-workspace.yaml": true,
			"/root/package.json": JSON.stringify({ name: "my-monorepo" }),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("pnpm");
		expect(result.version).toBeUndefined();
	});

	it("detects bun from bun.lock + packageManager field", async () => {
		const layer = testLayer({
			"/root/bun.lock": true,
			"/root/package.json": JSON.stringify({
				packageManager: "bun@1.2.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("bun");
		expect(result.version).toBe("1.2.0");
	});

	it("detects bun from bun.lockb + packageManager field", async () => {
		const layer = testLayer({
			"/root/bun.lockb": true,
			"/root/package.json": JSON.stringify({
				packageManager: "bun@1.1.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("bun");
		expect(result.version).toBe("1.1.0");
	});

	it("does NOT detect bun if lockfile exists but packageManager is not bun", async () => {
		const layer = testLayer({
			"/root/bun.lock": true,
			"/root/package.json": JSON.stringify({
				workspaces: ["packages/*"],
				packageManager: "npm@10.0.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		// Falls through to npm since workspaces field exists
		expect(result.type).toBe("npm");
	});

	it("detects yarn from yarn.lock + packageManager field", async () => {
		const layer = testLayer({
			"/root/yarn.lock": true,
			"/root/package.json": JSON.stringify({
				packageManager: "yarn@4.1.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("yarn");
		expect(result.version).toBe("4.1.0");
	});

	it("does NOT detect yarn if lockfile exists but packageManager is not yarn", async () => {
		const layer = testLayer({
			"/root/yarn.lock": true,
			"/root/package.json": JSON.stringify({
				workspaces: ["packages/*"],
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		// Falls through to npm since workspaces field exists
		expect(result.type).toBe("npm");
	});

	it("detects npm as fallback with workspaces field", async () => {
		const layer = testLayer({
			"/root/package.json": JSON.stringify({
				workspaces: ["packages/*"],
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("npm");
		expect(result.version).toBeUndefined();
	});

	it("detects npm with version from packageManager field", async () => {
		const layer = testLayer({
			"/root/package.json": JSON.stringify({
				workspaces: ["packages/*"],
				packageManager: "npm@10.2.3",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("npm");
		expect(result.version).toBe("10.2.3");
	});

	it("fails when no PM indicators are found", async () => {
		const layer = testLayer({
			"/root/package.json": JSON.stringify({
				name: "just-a-package",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root").pipe(Effect.flip);
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBeInstanceOf(PackageManagerDetectionError);
		expect(result._tag).toBe("PackageManagerDetectionError");
		expect(result.message).toContain("Cannot detect package manager");
	});

	it("fails when no package.json exists at all", async () => {
		const layer = testLayer({});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector
					.detect("/root")
					.pipe(
						Effect.catchTag("PackageManagerDetectionError", (e) =>
							Effect.succeed({ caught: true, searchPath: e.searchPath }),
						),
					);
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toEqual({
			caught: true,
			searchPath: "/root",
		});
	});

	it("pnpm takes priority over all others", async () => {
		const layer = testLayer({
			"/root/pnpm-workspace.yaml": true,
			"/root/bun.lock": true,
			"/root/yarn.lock": true,
			"/root/package.json": JSON.stringify({
				workspaces: ["packages/*"],
				packageManager: "bun@1.2.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/root");
			}).pipe(Effect.provide(layer)),
		);

		expect(result.type).toBe("pnpm");
	});
});
