/**
 * Integration tests for WorkspaceDiscovery against real fixture workspaces.
 *
 * Uses actual FileSystem reads (NodeFileSystem.layer) against the generated
 * fixture directories. Only WorkspaceRoot is mocked to point at fixture paths.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { bunFixture, npmFixture, pnpmFixture, yarnFixture } from "../utils/fixtures.js";
import { makeDiscoveryLayer } from "../utils/layers.js";

const runWithLayer = <A>(fixturePath: string, program: Effect.Effect<A, any, WorkspaceDiscovery>) =>
	Effect.runPromise(program.pipe(Effect.provide(makeDiscoveryLayer(fixturePath))));

// ── pnpm ─────────────────────────────────────────────────────────────

describe("WorkspaceDiscovery integration: pnpm", () => {
	describe("v1", () => {
		const fixturePath = pnpmFixture("v1");

		it("listPackages() returns root + workspace packages (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("listPackages() root package has relativePath '.'", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					const root = packages.find((p) => p.isRootWorkspace);
					return root?.relativePath;
				}),
			);
			expect(result).toBe(".");
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("importerMap() contains root key '.'", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return map.has(".");
				}),
			);
			expect(result).toBe(true);
		});
	});

	describe("v2", () => {
		const fixturePath = pnpmFixture("v2");

		it("listPackages() includes new-pkg (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
			expect(result.some((n: string) => n.includes("new-pkg"))).toBe(true);
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── bun ──────────────────────────────────────────────────────────────

describe("WorkspaceDiscovery integration: bun", () => {
	describe("v1", () => {
		const fixturePath = bunFixture("v1");

		it("listPackages() returns root + workspace packages (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = bunFixture("v2");

		it("listPackages() includes new-pkg (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
			expect(result.some((n: string) => n.includes("new-pkg"))).toBe(true);
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── npm ──────────────────────────────────────────────────────────────

describe("WorkspaceDiscovery integration: npm", () => {
	describe("v1", () => {
		const fixturePath = npmFixture("v1");

		it("listPackages() returns root + workspace packages (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = npmFixture("v2");

		it("listPackages() includes new-pkg (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
			expect(result.some((n: string) => n.includes("new-pkg"))).toBe(true);
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── yarn ─────────────────────────────────────────────────────────────

describe("WorkspaceDiscovery integration: yarn", () => {
	describe("v1", () => {
		const fixturePath = yarnFixture("v1");

		it("listPackages() returns root + workspace packages (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = yarnFixture("v2");

		it("listPackages() includes new-pkg (sorted names snapshot)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return [...packages].map((p) => p.name).sort();
				}),
			);
			expect(result).toMatchSnapshot();
			expect(result.some((n: string) => n.includes("new-pkg"))).toBe(true);
		});

		it("listPackages() includes the root workspace", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const packages = yield* discovery.listPackages();
					return packages.some((p) => p.isRootWorkspace);
				}),
			);
			expect(result).toBe(true);
		});

		it("importerMap() keys snapshot (sorted)", async () => {
			const result = await runWithLayer(
				fixturePath,
				Effect.gen(function* () {
					const discovery = yield* WorkspaceDiscovery;
					const map = yield* discovery.importerMap();
					return [...map.keys()].sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});
