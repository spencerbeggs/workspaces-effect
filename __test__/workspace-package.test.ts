import { FileSystem } from "@effect/platform";
import { Effect, Option, pipe } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../src/schemas/core.js";
import {
	dependencyDiff,
	dependencyVersion,
	hasAnyDependencyOn,
	hasDependency,
	hasDevDependency,
	hasOptionalDependency,
	hasPeerDependency,
	matchesDependency,
	readPackageJson,
} from "../src/utils/workspace-package.js";

const pkg = new WorkspacePackage({
	name: "@scope/utils",
	version: "1.0.0",
	path: "/workspace/packages/utils",
	packageJsonPath: "/workspace/packages/utils/package.json",
	relativePath: "packages/utils",
	dependencies: { effect: "^3.0.0" },
	devDependencies: { vitest: "^3.0.0" },
	peerDependencies: { react: "^18.0.0" },
	optionalDependencies: { fsevents: "^2.3.0" },
});

describe("standalone dual functions", () => {
	describe("data-first calling style", () => {
		it("hasDependency", () => {
			expect(hasDependency(pkg, "effect")).toBe(true);
			expect(hasDependency(pkg, "vitest")).toBe(false);
		});

		it("hasDevDependency", () => {
			expect(hasDevDependency(pkg, "vitest")).toBe(true);
		});

		it("hasPeerDependency", () => {
			expect(hasPeerDependency(pkg, "react")).toBe(true);
		});

		it("hasOptionalDependency", () => {
			expect(hasOptionalDependency(pkg, "fsevents")).toBe(true);
		});

		it("hasAnyDependencyOn", () => {
			expect(hasAnyDependencyOn(pkg, "effect")).toBe(true);
			expect(hasAnyDependencyOn(pkg, "nonexistent")).toBe(false);
		});

		it("dependencyVersion", () => {
			expect(dependencyVersion(pkg, "effect")).toEqual(Option.some("^3.0.0"));
			expect(dependencyVersion(pkg, "nonexistent")).toEqual(Option.none());
		});

		it("matchesDependency", () => {
			expect(matchesDependency(pkg, "*test*")).toBe(true);
		});
	});

	describe("data-last (pipeable) calling style", () => {
		it("hasDependency", () => {
			expect(pipe(pkg, hasDependency("effect"))).toBe(true);
		});

		it("dependencyVersion", () => {
			expect(pipe(pkg, dependencyVersion("effect"))).toEqual(Option.some("^3.0.0"));
		});

		it("matchesDependency", () => {
			expect(pipe(pkg, matchesDependency("*test*"))).toBe(true);
		});
	});

	describe("dependencyDiff standalone", () => {
		it("data-first", () => {
			const before = new WorkspacePackage({
				name: "pkg",
				version: "1.0.0",
				path: "/workspace/pkg",
				packageJsonPath: "/workspace/pkg/package.json",
				relativePath: "pkg",
				dependencies: { a: "1.0.0" },
			});
			const after = new WorkspacePackage({
				name: "pkg",
				version: "1.0.0",
				path: "/workspace/pkg",
				packageJsonPath: "/workspace/pkg/package.json",
				relativePath: "pkg",
				dependencies: { a: "2.0.0", b: "1.0.0" },
			});
			const diff = dependencyDiff(after, before);
			expect(diff.added).toEqual({ b: "1.0.0" });
			expect(diff.changed).toEqual({ a: { from: "1.0.0", to: "2.0.0" } });
		});

		it("data-last (pipeable)", () => {
			const before = new WorkspacePackage({
				name: "pkg",
				version: "1.0.0",
				path: "/workspace/pkg",
				packageJsonPath: "/workspace/pkg/package.json",
				relativePath: "pkg",
				dependencies: { a: "1.0.0" },
			});
			const after = new WorkspacePackage({
				name: "pkg",
				version: "1.0.0",
				path: "/workspace/pkg",
				packageJsonPath: "/workspace/pkg/package.json",
				relativePath: "pkg",
				dependencies: { b: "1.0.0" },
			});
			const diff = pipe(after, dependencyDiff(before));
			expect(diff.added).toEqual({ b: "1.0.0" });
			expect(diff.removed).toEqual({ a: "1.0.0" });
		});
	});
});

describe("readPackageJson", () => {
	it("reads and parses a package.json from the filesystem", async () => {
		const testPkg = new WorkspacePackage({
			name: "test-pkg",
			version: "1.0.0",
			path: "/workspace/packages/test",
			packageJsonPath: "/workspace/packages/test/package.json",
			relativePath: "packages/test",
		});

		const mockFsLayer = FileSystem.layerNoop({
			readFileString: (path) => {
				if (path === "/workspace/packages/test/package.json") {
					return Effect.succeed(
						JSON.stringify({
							name: "test-pkg",
							version: "1.0.0",
							dependencies: { effect: "^3.0.0" },
						}),
					);
				}
				return Effect.die(new Error(`ENOENT: ${path}`));
			},
		});

		const result = await Effect.runPromise(readPackageJson(testPkg).pipe(Effect.provide(mockFsLayer)));

		expect(result.name).toBe("test-pkg");
		expect(result.dependencies).toEqual({ effect: "^3.0.0" });
	});
});
