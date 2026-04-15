import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { discoveryFixture } from "../utils/fixtures.js";
import { makeDiscoveryLayer } from "../utils/layers.js";

const runDiscovery = (fixturePath: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			return yield* discovery.listPackages();
		}).pipe(Effect.provide(makeDiscoveryLayer(fixturePath))),
	);

describe("Workspace resolution integration", () => {
	describe("standalone", () => {
		it("returns root as single workspace when no workspace config", async () => {
			const packages = await runDiscovery(discoveryFixture("standalone"));
			expect(packages).toHaveLength(1);
			expect(packages[0].name).toBe("standalone-pkg");
			expect(packages[0].isRootWorkspace).toBe(true);
			expect(packages[0].version).toBe("1.0.0");
		});

		it("preserves publishConfig on standalone package", async () => {
			const packages = await runDiscovery(discoveryFixture("standalone"));
			expect(packages[0].publishConfig?.access).toBe("public");
			expect(packages[0].publishConfig?.directory).toBe("dist/npm");
			expect(packages[0].publishConfig?.tag).toBe("latest");
		});

		it("returns private standalone package", async () => {
			const packages = await runDiscovery(discoveryFixture("standalone-private"));
			expect(packages).toHaveLength(1);
			expect(packages[0].private).toBe(true);
			expect(packages[0].publishConfig).toBeUndefined();
		});
	});

	describe("pnpm", () => {
		it("basic: discovers root + workspace packages", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "basic"));
			const names = packages.map((p) => p.name).sort();
			expect(names).toContain("pnpm-basic-monorepo");
			expect(names).toContain("@scope/lib-public");
			expect(names).toContain("@scope/lib-private");
			expect(names).toContain("@scope/lib-linked");
		});

		it("basic: root is first and marked as root workspace", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "basic"));
			expect(packages[0].isRootWorkspace).toBe(true);
			expect(packages[0].name).toBe("pnpm-basic-monorepo");
		});

		it("basic: preserves publishConfig.tag on workspace", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "basic"));
			const linked = packages.find((p) => p.name === "@scope/lib-linked");
			expect(linked?.publishConfig?.tag).toBe("beta");
			expect(linked?.publishConfig?.linkDirectory).toBe(true);
		});

		it("basic: private package has private flag", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "basic"));
			const priv = packages.find((p) => p.name === "@scope/lib-private");
			expect(priv?.private).toBe(true);
		});

		it("root-as-package: returns single workspace (no duplication)", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "root-as-package"));
			expect(packages).toHaveLength(1);
			expect(packages[0].name).toBe("root-only-pkg");
			expect(packages[0].isRootWorkspace).toBe(true);
		});

		it("root-plus-packages: root not duplicated", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "root-plus-packages"));
			expect(packages).toHaveLength(2);
			const roots = packages.filter((p) => p.isRootWorkspace);
			expect(roots).toHaveLength(1);
			expect(packages.map((p) => p.name).sort()).toEqual(["@scope/rpp-lib-a", "root-plus-packages-monorepo"].sort());
		});

		it("multi-root: discovers packages from both workspace roots", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "multi-root"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/mr-lib-a");
			expect(names).toContain("@scope/mr-web");
		});

		it("explicit-paths: only discovers listed packages", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "explicit-paths"));
			const nonRootNames = packages
				.filter((p) => !p.isRootWorkspace)
				.map((p) => p.name)
				.sort();
			expect(nonRootNames).toEqual(["@scope/ep-bar", "@scope/ep-foo"]);
			expect(nonRootNames).not.toContain("@scope/ep-baz");
		});

		it("negation: excludes negated packages", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "negation"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/neg-included");
			expect(names).not.toContain("@scope/neg-excluded");
		});

		it("double-star: discovers packages with ** pattern", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "double-star"));
			const names = packages
				.filter((p) => !p.isRootWorkspace)
				.map((p) => p.name)
				.sort();
			expect(names).toEqual(["@scope/ds-lib-a", "@scope/ds-lib-b"]);
		});

		it("with-catalogs: discovers packages and ignores catalogs section", async () => {
			const packages = await runDiscovery(discoveryFixture("pnpm", "with-catalogs"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/cat-lib-a");
			expect(packages).toHaveLength(2);
		});
	});

	describe("npm", () => {
		it("basic: discovers workspaces from package.json workspaces array", async () => {
			const packages = await runDiscovery(discoveryFixture("npm", "basic"));
			expect(packages.length).toBeGreaterThan(1);
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/npm-lib-a");
		});

		it("object-form: discovers workspaces from { packages: [...] } form", async () => {
			const packages = await runDiscovery(discoveryFixture("npm", "object-form"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/npm-obj-lib-a");
		});
	});

	describe("yarn", () => {
		it("basic: discovers workspaces from package.json", async () => {
			const packages = await runDiscovery(discoveryFixture("yarn", "basic"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/yarn-lib-a");
		});

		it("multi-pattern: discovers from multiple workspace roots", async () => {
			const packages = await runDiscovery(discoveryFixture("yarn", "multi-pattern"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/yarn-mp-lib-a");
			expect(names).toContain("@scope/yarn-mp-web");
		});
	});

	describe("bun", () => {
		it("basic: discovers workspaces from package.json", async () => {
			const packages = await runDiscovery(discoveryFixture("bun", "basic"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/bun-lib-a");
		});

		it("multi-pattern: discovers from multiple workspace roots", async () => {
			const packages = await runDiscovery(discoveryFixture("bun", "multi-pattern"));
			const names = packages.map((p) => p.name);
			expect(names).toContain("@scope/bun-mp-lib-a");
			expect(names).toContain("@scope/bun-mp-web");
		});
	});
});
