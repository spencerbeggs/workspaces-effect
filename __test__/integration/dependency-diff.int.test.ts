/**
 * Integration tests for WorkspacePackage.dependencyDiff() across all PMs.
 *
 * Discovers packages from v1 and v2 fixture directories using real FileSystem
 * reads (NodeFileSystem.layer). Only WorkspaceRoot is mocked to point at
 * the fixture path. Diffs are snapshot-tested.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { WorkspacePackage } from "../../src/schemas/core.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { fixture } from "../utils/fixtures.js";
import { makeDiscoveryLayer } from "../utils/layers.js";

// ── Helper to discover packages from a fixture ───────────────────────

const discoverPackages = (pm: string, version: string): Promise<ReadonlyArray<WorkspacePackage>> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			return yield* discovery.listPackages();
		}).pipe(Effect.provide(makeDiscoveryLayer(fixture(pm, version)))),
	);

const findPackage = (packages: ReadonlyArray<WorkspacePackage>, name: string): WorkspacePackage => {
	const pkg = packages.find((p) => p.name === name);
	if (!pkg)
		throw new Error(`Package "${name}" not found in fixture. Available: ${packages.map((p) => p.name).join(", ")}`);
	return pkg;
};

// ── pnpm ─────────────────────────────────────────────────────────────

describe("DependencyDiff integration: pnpm", () => {
	it("core package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([
			discoverPackages("pnpm", "v1"),
			discoverPackages("pnpm", "v2"),
		]);

		const v1Core = findPackage(v1Packages, "@test-monorepo/core");
		const v2Core = findPackage(v2Packages, "@test-monorepo/core");

		const diff = v2Core.dependencyDiff(v1Core);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.added).length).toBeGreaterThan(0);
	});

	it("utils package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([
			discoverPackages("pnpm", "v1"),
			discoverPackages("pnpm", "v2"),
		]);

		const v1Utils = findPackage(v1Packages, "@test-monorepo/utils");
		const v2Utils = findPackage(v2Packages, "@test-monorepo/utils");

		const diff = v2Utils.dependencyDiff(v1Utils);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.removed).length).toBeGreaterThan(0);
	});
});

// ── bun ──────────────────────────────────────────────────────────────

describe("DependencyDiff integration: bun", () => {
	it("core package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([discoverPackages("bun", "v1"), discoverPackages("bun", "v2")]);

		const v1Core = findPackage(v1Packages, "@test-monorepo/core");
		const v2Core = findPackage(v2Packages, "@test-monorepo/core");

		const diff = v2Core.dependencyDiff(v1Core);

		expect(diff).toMatchSnapshot();
		expect(
			Object.keys(diff.added).length + Object.keys(diff.removed).length + Object.keys(diff.changed).length,
		).toBeGreaterThan(0);
	});

	it("utils package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([discoverPackages("bun", "v1"), discoverPackages("bun", "v2")]);

		const v1Utils = findPackage(v1Packages, "@test-monorepo/utils");
		const v2Utils = findPackage(v2Packages, "@test-monorepo/utils");

		const diff = v2Utils.dependencyDiff(v1Utils);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.removed).length).toBeGreaterThan(0);
	});
});

// ── npm ──────────────────────────────────────────────────────────────

describe("DependencyDiff integration: npm", () => {
	it("core package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([discoverPackages("npm", "v1"), discoverPackages("npm", "v2")]);

		const v1Core = findPackage(v1Packages, "@test-monorepo/core");
		const v2Core = findPackage(v2Packages, "@test-monorepo/core");

		const diff = v2Core.dependencyDiff(v1Core);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.added).length).toBeGreaterThan(0);
		expect(Object.keys(diff.changed).length).toBeGreaterThan(0);
	});

	it("utils package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([discoverPackages("npm", "v1"), discoverPackages("npm", "v2")]);

		const v1Utils = findPackage(v1Packages, "@test-monorepo/utils");
		const v2Utils = findPackage(v2Packages, "@test-monorepo/utils");

		const diff = v2Utils.dependencyDiff(v1Utils);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.removed).length).toBeGreaterThan(0);
	});
});

// ── yarn ─────────────────────────────────────────────────────────────

describe("DependencyDiff integration: yarn", () => {
	it("core package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([
			discoverPackages("yarn", "v1"),
			discoverPackages("yarn", "v2"),
		]);

		const v1Core = findPackage(v1Packages, "@test-monorepo/core");
		const v2Core = findPackage(v2Packages, "@test-monorepo/core");

		const diff = v2Core.dependencyDiff(v1Core);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.added).length).toBeGreaterThan(0);
		expect(Object.keys(diff.changed).length).toBeGreaterThan(0);
	});

	it("utils package diff v1→v2 matches snapshot", async () => {
		const [v1Packages, v2Packages] = await Promise.all([
			discoverPackages("yarn", "v1"),
			discoverPackages("yarn", "v2"),
		]);

		const v1Utils = findPackage(v1Packages, "@test-monorepo/utils");
		const v2Utils = findPackage(v2Packages, "@test-monorepo/utils");

		const diff = v2Utils.dependencyDiff(v1Utils);

		expect(diff).toMatchSnapshot();
		expect(Object.keys(diff.removed).length).toBeGreaterThan(0);
	});
});
