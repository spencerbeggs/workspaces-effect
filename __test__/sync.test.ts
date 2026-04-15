import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
});
