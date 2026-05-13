import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspacePackage } from "../src/schemas/core.js";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "../src/sync.js";

const FIXTURES = resolve(import.meta.dirname, "integration/fixtures/discovery");

describe("findWorkspaceRootSync", () => {
	it("finds pnpm workspace root from nested directory", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "pnpm/basic/packages/lib-public"));
		expect(root).toBe(resolve(FIXTURES, "pnpm/basic"));
	});

	it("finds npm workspace root from nested directory", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "npm/basic/packages/lib-a"));
		expect(root).toBe(resolve(FIXTURES, "npm/basic"));
	});

	it("finds yarn workspace root from nested directory", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "yarn/basic/packages/lib-a"));
		expect(root).toBe(resolve(FIXTURES, "yarn/basic"));
	});

	it("finds bun workspace root from nested directory", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "bun/basic/packages/lib-a"));
		expect(root).toBe(resolve(FIXTURES, "bun/basic"));
	});

	it("finds root when cwd is the root itself", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "pnpm/basic"));
		expect(root).toBe(resolve(FIXTURES, "pnpm/basic"));
	});

	it("walks past standalone package to find enclosing workspace root", () => {
		const root = findWorkspaceRootSync(resolve(FIXTURES, "standalone"));
		expect(root).not.toBeNull();
		expect(root).not.toBe(resolve(FIXTURES, "standalone"));
	});

	it("defaults to process.cwd() when no argument provided", () => {
		const root = findWorkspaceRootSync();
		expect(root).not.toBeNull();
		expect(typeof root).toBe("string");
	});

	it("returns null when no workspace root exists above path", () => {
		// Walk up from /tmp which has no workspace config above it
		const root = findWorkspaceRootSync("/tmp");
		expect(root).toBeNull();
	});

	it("throws for nonexistent directory", () => {
		expect(() => findWorkspaceRootSync("/nonexistent/path/that/does/not/exist")).toThrow();
	});
});

describe("findWorkspaceRootSync — git project boundary", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "ws-effect-sync-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns git root for single-package repo without workspace markers", () => {
		mkdirSync(join(tmp, ".git"));
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
		const sub = join(tmp, "src");
		mkdirSync(sub);

		expect(findWorkspaceRootSync(sub)).toBe(tmp);
	});

	it("returns git root when invoked at the root itself", () => {
		mkdirSync(join(tmp, ".git"));
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));

		expect(findWorkspaceRootSync(tmp)).toBe(tmp);
	});

	it("recognizes .git as a file (submodule / worktree pointer)", () => {
		writeFileSync(join(tmp, ".git"), "gitdir: /some/other/path\n");
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));

		expect(findWorkspaceRootSync(tmp)).toBe(tmp);
	});

	it("throws when the git boundary has no package.json", () => {
		mkdirSync(join(tmp, ".git"));
		const sub = join(tmp, "src");
		mkdirSync(sub);

		expect(() => findWorkspaceRootSync(sub)).toThrow(/no package\.json/);
	});

	it("prefers an inner workspace marker over an outer .git boundary", () => {
		// Outer git project with its own package.json
		mkdirSync(join(tmp, ".git"));
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "outer", version: "1.0.0" }));

		// Nested pnpm workspace, no .git of its own
		const inner = join(tmp, "nested");
		mkdirSync(inner);
		writeFileSync(join(inner, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
		writeFileSync(join(inner, "package.json"), JSON.stringify({ name: "inner", version: "1.0.0" }));

		expect(findWorkspaceRootSync(inner)).toBe(inner);
	});

	it("stops at an inner .git (submodule) rather than escaping to the outer project", () => {
		// Outer project with workspace marker
		writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "outer", version: "1.0.0" }));

		// Inner submodule-style git project
		const inner = join(tmp, "vendor", "sub");
		mkdirSync(inner, { recursive: true });
		mkdirSync(join(inner, ".git"));
		writeFileSync(join(inner, "package.json"), JSON.stringify({ name: "sub", version: "1.0.0" }));

		expect(findWorkspaceRootSync(inner)).toBe(inner);
	});
});

describe("getWorkspacePackagesSync", () => {
	it("includes root as first entry", () => {
		const root = resolve(FIXTURES, "pnpm/basic");
		const packages = getWorkspacePackagesSync(root);
		expect(packages[0].name).toBe("pnpm-basic-monorepo");
		expect(packages[0].path).toBe(root);
	});

	it("returns root + workspace packages from pnpm workspace", () => {
		const root = resolve(FIXTURES, "pnpm/basic");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("pnpm-basic-monorepo");
		expect(names).toContain("@scope/lib-public");
		expect(names).toContain("@scope/lib-private");
		expect(names).toContain("@scope/lib-linked");
	});

	it("returns root + workspace packages from npm workspace", () => {
		const root = resolve(FIXTURES, "npm/basic");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("npm-basic-monorepo");
		expect(names).toContain("@scope/npm-lib-a");
	});

	it("returns root + workspace packages from yarn workspace", () => {
		const root = resolve(FIXTURES, "yarn/basic");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("yarn-basic-monorepo");
		expect(names).toContain("@scope/yarn-lib-a");
	});

	it("returns root + workspace packages from bun workspace", () => {
		const root = resolve(FIXTURES, "bun/basic");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("bun-basic-monorepo");
		expect(names).toContain("@scope/bun-lib-a");
	});

	it("includes path for each package", () => {
		const root = resolve(FIXTURES, "pnpm/basic");
		const packages = getWorkspacePackagesSync(root);
		const pub = packages.find((p) => p.name === "@scope/lib-public");
		expect(pub).toBeDefined();
		expect(pub?.path).toBe(resolve(root, "packages/lib-public"));
	});

	it("returns root as single entry for standalone package", () => {
		const root = resolve(FIXTURES, "standalone");
		const packages = getWorkspacePackagesSync(root);
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("standalone-pkg");
		expect(packages[0].path).toBe(root);
	});

	it("handles multiple workspace roots", () => {
		const root = resolve(FIXTURES, "pnpm/multi-root");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("multi-root-monorepo");
		expect(names).toContain("@scope/mr-lib-a");
		expect(names).toContain("@scope/mr-web");
	});

	it("handles negation patterns", () => {
		const root = resolve(FIXTURES, "pnpm/negation");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("@scope/neg-included");
		expect(names).not.toContain("@scope/neg-excluded");
	});

	it("handles explicit paths", () => {
		const root = resolve(FIXTURES, "pnpm/explicit-paths");
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((p) => p.name);
		expect(names).toContain("@scope/ep-foo");
		expect(names).toContain("@scope/ep-bar");
		expect(names).not.toContain("@scope/ep-baz");
	});

	it('deduplicates root when patterns include "."', () => {
		const root = resolve(FIXTURES, "pnpm/root-as-package");
		const packages = getWorkspacePackagesSync(root);
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("root-only-pkg");
	});

	it("throws for nonexistent directory", () => {
		expect(() => getWorkspacePackagesSync("/nonexistent/path")).toThrow();
	});

	describe("WorkspacePackage shape", () => {
		const root = resolve(FIXTURES, "pnpm/basic");

		it("returns WorkspacePackage instances", () => {
			const packages = getWorkspacePackagesSync(root);
			for (const pkg of packages) {
				expect(pkg).toBeInstanceOf(WorkspacePackage);
			}
		});

		it("populates version, packageJsonPath, and relativePath", () => {
			const packages = getWorkspacePackagesSync(root);
			const pub = packages.find((p) => p.name === "@scope/lib-public");
			expect(pub).toBeDefined();
			expect(pub?.version).toBeTypeOf("string");
			expect(pub?.version.length).toBeGreaterThan(0);
			expect(pub?.packageJsonPath).toBe(resolve(root, "packages/lib-public/package.json"));
			expect(pub?.relativePath).toBe("packages/lib-public");
		});

		it("root package has relativePath '.' and isRootWorkspace true", () => {
			const packages = getWorkspacePackagesSync(root);
			expect(packages[0].relativePath).toBe(".");
			expect(packages[0].isRootWorkspace).toBe(true);
		});

		it("decodes publishConfig when present", () => {
			const packages = getWorkspacePackagesSync(root);
			const pub = packages.find((p) => p.name === "@scope/lib-public");
			expect(pub?.publishConfig?.access).toBe("public");
		});

		it("populates dependency maps with empty defaults", () => {
			const packages = getWorkspacePackagesSync(root);
			for (const pkg of packages) {
				expect(pkg.dependencies).toEqual(expect.any(Object));
				expect(pkg.devDependencies).toEqual(expect.any(Object));
				expect(pkg.peerDependencies).toEqual(expect.any(Object));
				expect(pkg.optionalDependencies).toEqual(expect.any(Object));
			}
		});

		it("standalone package returns a single WorkspacePackage with isRootWorkspace true", () => {
			const standalone = getWorkspacePackagesSync(resolve(FIXTURES, "standalone"));
			expect(standalone).toHaveLength(1);
			expect(standalone[0]).toBeInstanceOf(WorkspacePackage);
			expect(standalone[0].name).toBe("standalone-pkg");
			expect(standalone[0].isRootWorkspace).toBe(true);
			expect(standalone[0].publishConfig?.access).toBe("public");
		});
	});
});
