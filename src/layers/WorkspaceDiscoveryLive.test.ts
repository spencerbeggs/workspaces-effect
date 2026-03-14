/**
 * Tests for WorkspaceDiscoveryLive layer.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscoveryError } from "../errors/WorkspaceDiscoveryError.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { WorkspaceDiscoveryLive } from "./WorkspaceDiscoveryLive.js";

/**
 * Create a mock filesystem layer.
 * `files` maps absolute paths to content (string) or directory entries (string[]).
 */
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

/**
 * Create a mock WorkspaceRoot that always returns a fixed root path.
 */
const mockRoot = (rootPath: string) =>
	Layer.succeed(WorkspaceRoot, {
		find: () => Effect.succeed(rootPath),
	});

/** Build the discovery layer with mocked dependencies. */
const testLayer = (rootPath: string, files: Record<string, string | true>, dirs: Record<string, string[]> = {}) =>
	WorkspaceDiscoveryLive.pipe(Layer.provide(Layer.mergeAll(mockRoot(rootPath), mockFs(files, dirs), Path.layer)));

describe("WorkspaceDiscoveryLive", () => {
	describe("listPackages", () => {
		it("discovers packages from pnpm-workspace.yaml", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "@scope/pkg-a",
						version: "1.0.0",
					}),
					[`${root}/packages/pkg-b/package.json`]: JSON.stringify({
						name: "@scope/pkg-b",
						version: "2.0.0",
						private: true,
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a", "pkg-b"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("@scope/pkg-a");
			expect(result[0].version).toBe("1.0.0");
			expect(result[0].relativePath).toBe("packages/pkg-a");
			expect(result[1].name).toBe("@scope/pkg-b");
			expect(result[1].private).toBe(true);
		});

		it("discovers packages from package.json workspaces array", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						workspaces: ["packages/*"],
					}),
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "pkg-a",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("pkg-a");
		});

		it("discovers packages from package.json workspaces object", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						workspaces: { packages: ["apps/*"] },
					}),
					[`${root}/apps/web/package.json`]: JSON.stringify({
						name: "web-app",
						version: "0.1.0",
					}),
				},
				{
					[`${root}/apps`]: ["web"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("web-app");
		});

		it("handles multiple workspace patterns", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'\n  - 'apps/*'",
					[`${root}/packages/lib/package.json`]: JSON.stringify({
						name: "lib",
						version: "1.0.0",
					}),
					[`${root}/apps/web/package.json`]: JSON.stringify({
						name: "web",
						version: "0.1.0",
					}),
				},
				{
					[`${root}/packages`]: ["lib"],
					[`${root}/apps`]: ["web"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(2);
			const names = result.map((p) => p.name);
			expect(names).toContain("lib");
			expect(names).toContain("web");
		});

		it("skips directories without package.json", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/packages/real-pkg/package.json`]: JSON.stringify({
						name: "real-pkg",
						version: "1.0.0",
					}),
					// no-pkg directory has no package.json
				},
				{
					[`${root}/packages`]: ["real-pkg", "no-pkg"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("real-pkg");
		});

		it("includes dependencies in discovered packages", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "pkg-a",
						version: "1.0.0",
						dependencies: { "pkg-b": "workspace:*" },
						devDependencies: { vitest: "^3.0.0" },
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result[0].dependencies).toEqual({ "pkg-b": "workspace:*" });
			expect(result[0].devDependencies).toEqual({ vitest: "^3.0.0" });
		});

		it("fails when no workspace patterns found", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(root, {
				[`${root}/package.json`]: JSON.stringify({ name: "not-a-monorepo" }),
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toBeInstanceOf(WorkspaceDiscoveryError);
			expect(result._tag).toBe("WorkspaceDiscoveryError");
			expect(result.message).toContain("Workspace discovery failed");
		});
	});

	describe("getPackage", () => {
		it("finds a package by name", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "pkg-a",
						version: "1.0.0",
					}),
					[`${root}/packages/pkg-b/package.json`]: JSON.stringify({
						name: "pkg-b",
						version: "2.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a", "pkg-b"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.getPackage("pkg-b");
				}).pipe(Effect.provide(layer)),
			);

			expect(result.name).toBe("pkg-b");
			expect(result.version).toBe("2.0.0");
		});

		it("fails with PackageNotFoundError for unknown package", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "pkg-a",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.getPackage("nonexistent").pipe(
						Effect.catchTag("PackageNotFoundError", (e) =>
							Effect.succeed({
								caught: true,
								name: e.name,
								available: e.available,
							}),
						),
					);
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual({
				caught: true,
				name: "nonexistent",
				available: ["pkg-a"],
			});
		});
	});

	describe("pnpm-workspace.yaml parsing", () => {
		it("handles unquoted patterns", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - packages/*",
					[`${root}/packages/pkg/package.json`]: JSON.stringify({
						name: "pkg",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
		});

		it("handles double-quoted patterns", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"',
					[`${root}/packages/pkg/package.json`]: JSON.stringify({
						name: "pkg",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
		});
	});
});
