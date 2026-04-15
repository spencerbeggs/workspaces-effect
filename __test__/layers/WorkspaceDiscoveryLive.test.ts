/**
 * Tests for WorkspaceDiscoveryLive layer.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscoveryError } from "../../src/errors/WorkspaceDiscoveryError.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

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
	WorkspaceDiscoveryLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockRoot(rootPath),
				mockFs(files, dirs),
				Path.layer,
				Logger.replace(Logger.defaultLogger, Logger.none),
			),
		),
	);

describe("WorkspaceDiscoveryLive", () => {
	describe("listPackages", () => {
		it("discovers packages from pnpm-workspace.yaml", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result).toHaveLength(3);
			expect(result[0].name).toBe("my-monorepo");
			expect(result[0].relativePath).toBe(".");
			expect(result[1].name).toBe("@scope/pkg-a");
			expect(result[1].version).toBe("1.0.0");
			expect(result[1].relativePath).toBe("packages/pkg-a");
			expect(result[2].name).toBe("@scope/pkg-b");
			expect(result[2].private).toBe(true);
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

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("my-monorepo");
			expect(result[1].name).toBe("pkg-a");
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

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("my-monorepo");
			expect(result[1].name).toBe("web-app");
		});

		it("handles multiple workspace patterns", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'\n  - 'apps/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result).toHaveLength(3);
			const names = result.map((p) => p.name);
			expect(names).toContain("my-monorepo");
			expect(names).toContain("lib");
			expect(names).toContain("web");
		});

		it("skips directories without package.json", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("my-monorepo");
			expect(result[1].name).toBe("real-pkg");
		});

		it("includes dependencies in discovered packages", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result[1].dependencies).toEqual({ "pkg-b": "workspace:*" });
			expect(result[1].devDependencies).toEqual({ vitest: "^3.0.0" });
		});

		it("returns standalone package when no workspace patterns found", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(root, {
				[`${root}/package.json`]: JSON.stringify({ name: "not-a-monorepo" }),
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("not-a-monorepo");
			expect(result[0].isRootWorkspace).toBe(true);
		});

		it("includes root workspace package as first entry", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
						dependencies: { typescript: "^5.0.0" },
					}),
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "@scope/pkg-a",
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

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("my-monorepo");
			expect(result[0].relativePath).toBe(".");
			expect(result[0].path).toBe(root);
			expect(result[0].isRootWorkspace).toBe(true);
			expect(result[0].dependencies).toEqual({ typescript: "^5.0.0" });
			expect(result[1].name).toBe("@scope/pkg-a");
			expect(result[1].isRootWorkspace).toBe(false);
		});
	});

	describe("importerMap", () => {
		it("returns map keyed by relativePath", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
					}),
					[`${root}/packages/core/package.json`]: JSON.stringify({
						name: "@scope/core",
						version: "1.0.0",
					}),
					[`${root}/packages/utils/package.json`]: JSON.stringify({
						name: "@scope/utils",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["core", "utils"],
				},
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.importerMap();
				}).pipe(Effect.provide(layer)),
			);

			expect(result.size).toBe(3);
			expect(result.get(".")?.name).toBe("my-monorepo");
			expect(result.get("packages/core")?.name).toBe("@scope/core");
			expect(result.get("packages/utils")?.name).toBe("@scope/utils");
		});
	});

	describe("getPackage", () => {
		it("finds a package by name", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
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
				available: ["my-monorepo", "pkg-a"],
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
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result).toHaveLength(2);
		});

		it("handles double-quoted patterns", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"',
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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

			expect(result).toHaveLength(2);
		});
	});

	describe("root-as-package dedup", () => {
		it('does not duplicate root when patterns include "."', async () => {
			const root = "/projects/root-pkg";
			const layer = testLayer(root, {
				[`${root}/pnpm-workspace.yaml`]: "packages:\n  - '.'",
				[`${root}/package.json`]: JSON.stringify({
					name: "my-root-pkg",
					version: "1.0.0",
				}),
			});
			const packages = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);
			expect(packages).toHaveLength(1);
			expect(packages[0].name).toBe("my-root-pkg");
			expect(packages[0].isRootWorkspace).toBe(true);
		});

		it("does not duplicate root when patterns resolve to root directory", async () => {
			const root = "/projects/mixed";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - '.'\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-mono",
						version: "0.0.0",
						private: true,
					}),
					[`${root}/packages/pkg-a/package.json`]: JSON.stringify({
						name: "@scope/pkg-a",
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["pkg-a"],
				},
			);
			const packages = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);
			// Root + pkg-a = 2 (root NOT duplicated)
			expect(packages).toHaveLength(2);
			const rootPkgs = packages.filter((p) => p.isRootWorkspace);
			expect(rootPkgs).toHaveLength(1);
		});
	});

	describe("standalone fallback", () => {
		it("returns root as single workspace when no workspace config exists", async () => {
			const root = "/projects/standalone";
			const layer = testLayer(root, {
				[`${root}/package.json`]: JSON.stringify({
					name: "my-standalone-pkg",
					version: "1.0.0",
				}),
			});
			const packages = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);
			expect(packages).toHaveLength(1);
			expect(packages[0].name).toBe("my-standalone-pkg");
			expect(packages[0].isRootWorkspace).toBe(true);
		});

		it("returns root as single workspace for private standalone package", async () => {
			const root = "/projects/standalone-private";
			const layer = testLayer(root, {
				[`${root}/package.json`]: JSON.stringify({
					name: "my-app",
					version: "1.0.0",
					private: true,
				}),
			});
			const packages = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);
			expect(packages).toHaveLength(1);
			expect(packages[0].private).toBe(true);
		});
	});

	describe("error paths", () => {
		it("fails when workspace package.json has no name field", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
					[`${root}/packages/bad/package.json`]: JSON.stringify({
						version: "1.0.0",
					}),
				},
				{
					[`${root}/packages`]: ["bad"],
				},
			);
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toBeInstanceOf(WorkspaceDiscoveryError);
			expect(result.message).toContain("no name field");
		});

		it("fails when workspace package.json has no version field", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
					[`${root}/packages/no-version/package.json`]: JSON.stringify({
						name: "@scope/no-version",
					}),
				},
				{
					[`${root}/packages`]: ["no-version"],
				},
			);
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toBeInstanceOf(WorkspaceDiscoveryError);
			expect(result.message).toContain("no version field");
		});

		it("fails when workspace package.json contains invalid JSON", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
					[`${root}/packages/bad-json/package.json`]: "{ invalid json !!!",
				},
				{
					[`${root}/packages`]: ["bad-json"],
				},
			);
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toBeInstanceOf(WorkspaceDiscoveryError);
			expect(result.message).toContain("invalid JSON");
		});

		it("fails when glob base directory does not exist", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(root, {
				[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'nonexistent/*'",
				[`${root}/package.json`]: JSON.stringify({
					name: "my-monorepo",
					version: "0.0.0",
					private: true,
				}),
			});
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toBeInstanceOf(WorkspaceDiscoveryError);
			expect(result.message).toContain("non-existent directory");
		});
	});

	describe("pnpm-workspace.yaml parsing edge cases", () => {
		it("handles comments in packages list", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  # comment\n  - 'packages/*'\n  # another comment",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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
			expect(result).toHaveLength(2);
		});

		it("handles empty packages section", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(root, {
				[`${root}/pnpm-workspace.yaml`]: "packages:\nsomeOtherKey: value",
				[`${root}/package.json`]: JSON.stringify({
					name: "my-standalone",
					version: "1.0.0",
				}),
			});
			// Empty packages section falls through to standalone fallback
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					return yield* discovery.listPackages();
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("my-standalone");
		});

		it("handles double-star pattern (packages/**)", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/**'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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
			expect(result).toHaveLength(2);
			expect(result[1].name).toBe("pkg");
		});

		it("pnpm-workspace.yaml takes priority over package.json workspaces", async () => {
			const root = "/projects/monorepo";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: "packages:\n  - 'packages/*'",
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						workspaces: ["apps/*"],
					}),
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
			// Only "packages/*" from pnpm-workspace.yaml, NOT "apps/*" from package.json
			const names = result.map((p) => p.name);
			expect(names).toContain("lib");
			expect(names).not.toContain("web");
		});

		it("stops parsing at next top-level YAML key", async () => {
			const root = "/projects/monorepo";
			const yaml = "packages:\n  - 'packages/*'\ncatalogs:\n  default:\n    effect: ^3.0.0";
			const layer = testLayer(
				root,
				{
					[`${root}/pnpm-workspace.yaml`]: yaml,
					[`${root}/package.json`]: JSON.stringify({
						name: "my-monorepo",
						version: "0.0.0",
						private: true,
					}),
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
			expect(result).toHaveLength(2);
		});
	});
});
