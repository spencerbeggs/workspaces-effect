import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceRootNotFoundError } from "../errors/WorkspaceRootNotFoundError.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { WorkspaceRootLive } from "./WorkspaceRootLive.js";

/**
 * Create a mock FileSystem layer for testing workspace root detection.
 * `files` is a map of absolute paths to file contents (or true for existence-only).
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
	WorkspaceRootLive.pipe(Layer.provide(Layer.mergeAll(mockFs(files), Path.layer)));

describe("WorkspaceRootLive", () => {
	it("finds root with pnpm-workspace.yaml", async () => {
		const layer = testLayer({
			"/projects/monorepo/pnpm-workspace.yaml": true,
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/projects/monorepo/packages/pkg-a");
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBe("/projects/monorepo");
	});

	it("finds root with package.json workspaces field", async () => {
		const layer = testLayer({
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				workspaces: ["packages/*"],
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/projects/monorepo/packages/pkg-a");
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBe("/projects/monorepo");
	});

	it("finds root when starting from the root itself", async () => {
		const layer = testLayer({
			"/projects/monorepo/pnpm-workspace.yaml": true,
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/projects/monorepo");
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBe("/projects/monorepo");
	});

	it("prefers pnpm-workspace.yaml over package.json workspaces", async () => {
		const layer = testLayer({
			"/projects/monorepo/pnpm-workspace.yaml": true,
			"/projects/monorepo/package.json": JSON.stringify({
				name: "my-monorepo",
				workspaces: ["packages/*"],
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/projects/monorepo/deep/nested/dir");
			}).pipe(Effect.provide(layer)),
		);

		// Should find via pnpm-workspace.yaml at the monorepo root
		expect(result).toBe("/projects/monorepo");
	});

	it("fails when no workspace markers exist", async () => {
		const layer = testLayer({});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root
					.find("/some/random/path")
					.pipe(
						Effect.catchTag("WorkspaceRootNotFoundError", (e) =>
							Effect.succeed({ caught: true, searchPath: e.searchPath }),
						),
					);
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toEqual({
			caught: true,
			searchPath: "/some/random/path",
		});
	});

	it("error has correct _tag for catchTag", async () => {
		const layer = testLayer({});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/test").pipe(Effect.flip);
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBeInstanceOf(WorkspaceRootNotFoundError);
		expect(result._tag).toBe("WorkspaceRootNotFoundError");
	});

	it("ignores package.json without workspaces field", async () => {
		const layer = testLayer({
			"/projects/monorepo/package.json": JSON.stringify({
				name: "just-a-package",
				version: "1.0.0",
			}),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root
					.find("/projects/monorepo")
					.pipe(Effect.catchTag("WorkspaceRootNotFoundError", () => Effect.succeed("not-found")));
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBe("not-found");
	});
});
