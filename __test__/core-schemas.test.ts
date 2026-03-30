import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../src/schemas/core.js";

const rootPkg = new WorkspacePackage({
	name: "my-monorepo",
	version: "1.0.0",
	path: "/workspace",
	relativePath: ".",
});

const scopedPkg = new WorkspacePackage({
	name: "@scope/utils",
	version: "2.0.0",
	path: "/workspace/packages/utils",
	relativePath: "packages/utils",
	private: false,
	dependencies: { effect: "^3.0.0" },
	devDependencies: { vitest: "^3.0.0" },
	peerDependencies: { react: "^18.0.0" },
	optionalDependencies: { fsevents: "^2.3.0" },
});

const unscopedPkg = new WorkspacePackage({
	name: "my-lib",
	version: "1.0.0",
	path: "/workspace/packages/my-lib",
	relativePath: "packages/my-lib",
	private: true,
});

describe("WorkspacePackage getters", () => {
	it("isRootWorkspace returns true for root", () => {
		expect(rootPkg.isRootWorkspace).toBe(true);
		expect(scopedPkg.isRootWorkspace).toBe(false);
	});

	it("packageJsonPath appends package.json", () => {
		expect(rootPkg.packageJsonPath).toBe("/workspace/package.json");
		expect(scopedPkg.packageJsonPath).toBe("/workspace/packages/utils/package.json");
	});

	it("isPublic is inverse of private", () => {
		expect(scopedPkg.isPublic).toBe(true);
		expect(unscopedPkg.isPublic).toBe(false);
	});

	it("scope extracts @scope from scoped name", () => {
		expect(scopedPkg.scope).toEqual(Option.some("@scope"));
		expect(unscopedPkg.scope).toEqual(Option.none());
	});

	it("unscopedName strips scope prefix", () => {
		expect(scopedPkg.unscopedName).toBe("utils");
		expect(unscopedPkg.unscopedName).toBe("my-lib");
	});

	it("allDependencies merges all 4 dep types", () => {
		expect(scopedPkg.allDependencies).toEqual({
			effect: "^3.0.0",
			vitest: "^3.0.0",
			react: "^18.0.0",
			fsevents: "^2.3.0",
		});
	});
});

describe("WorkspacePackage instance methods", () => {
	it("hasDependency checks dependencies only", () => {
		expect(scopedPkg.hasDependency("effect")).toBe(true);
		expect(scopedPkg.hasDependency("vitest")).toBe(false);
	});

	it("hasDevDependency checks devDependencies only", () => {
		expect(scopedPkg.hasDevDependency("vitest")).toBe(true);
		expect(scopedPkg.hasDevDependency("effect")).toBe(false);
	});

	it("hasPeerDependency checks peerDependencies only", () => {
		expect(scopedPkg.hasPeerDependency("react")).toBe(true);
		expect(scopedPkg.hasPeerDependency("effect")).toBe(false);
	});

	it("hasOptionalDependency checks optionalDependencies only", () => {
		expect(scopedPkg.hasOptionalDependency("fsevents")).toBe(true);
		expect(scopedPkg.hasOptionalDependency("effect")).toBe(false);
	});

	it("hasAnyDependencyOn checks all 4 dep types", () => {
		expect(scopedPkg.hasAnyDependencyOn("effect")).toBe(true);
		expect(scopedPkg.hasAnyDependencyOn("vitest")).toBe(true);
		expect(scopedPkg.hasAnyDependencyOn("react")).toBe(true);
		expect(scopedPkg.hasAnyDependencyOn("fsevents")).toBe(true);
		expect(scopedPkg.hasAnyDependencyOn("nonexistent")).toBe(false);
	});

	it("dependencyVersion returns version from any dep type", () => {
		expect(scopedPkg.dependencyVersion("effect")).toEqual(Option.some("^3.0.0"));
		expect(scopedPkg.dependencyVersion("react")).toEqual(Option.some("^18.0.0"));
		expect(scopedPkg.dependencyVersion("nonexistent")).toEqual(Option.none());
	});

	it("matchesDependency matches glob patterns against dep names", () => {
		expect(scopedPkg.matchesDependency("effect")).toBe(true);
		expect(scopedPkg.matchesDependency("*test*")).toBe(true);
		expect(scopedPkg.matchesDependency("@scope/*")).toBe(false);
	});
});

describe("WorkspacePackage.dependencyDiff", () => {
	it("detects added dependencies", () => {
		const before = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "1.0.0" },
		});
		const after = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "1.0.0", b: "2.0.0" },
		});
		const diff = after.dependencyDiff(before);
		expect(diff.added).toEqual({ b: "2.0.0" });
		expect(diff.removed).toEqual({});
		expect(diff.changed).toEqual({});
	});

	it("detects removed dependencies", () => {
		const before = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "1.0.0", b: "2.0.0" },
		});
		const after = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "1.0.0" },
		});
		const diff = after.dependencyDiff(before);
		expect(diff.added).toEqual({});
		expect(diff.removed).toEqual({ b: "2.0.0" });
		expect(diff.changed).toEqual({});
	});

	it("detects changed versions", () => {
		const before = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "1.0.0" },
		});
		const after = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			dependencies: { a: "2.0.0" },
		});
		const diff = after.dependencyDiff(before);
		expect(diff.added).toEqual({});
		expect(diff.removed).toEqual({});
		expect(diff.changed).toEqual({ a: { from: "1.0.0", to: "2.0.0" } });
	});

	it("compares across all dep types", () => {
		const before = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			peerDependencies: { react: "^17.0.0" },
		});
		const after = new WorkspacePackage({
			name: "pkg",
			version: "1.0.0",
			path: "/workspace/pkg",
			relativePath: "pkg",
			peerDependencies: { react: "^18.0.0" },
		});
		const diff = after.dependencyDiff(before);
		expect(diff.changed).toEqual({ react: { from: "^17.0.0", to: "^18.0.0" } });
	});
});
