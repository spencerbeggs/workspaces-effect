import { describe, expect, it } from "vitest";
import { extractWorkspaceDeps, isWorkspaceSpecifier } from "../../src/layers/parsers/shared.js";

describe("isWorkspaceSpecifier", () => {
	it("detects workspace: prefix", () => {
		expect(isWorkspaceSpecifier("workspace:*")).toBe(true);
		expect(isWorkspaceSpecifier("workspace:^1.0.0")).toBe(true);
		expect(isWorkspaceSpecifier("workspace:~2.0.0")).toBe(true);
	});

	it("detects link: prefix", () => {
		expect(isWorkspaceSpecifier("link:../foo")).toBe(true);
		expect(isWorkspaceSpecifier("link:packages/bar")).toBe(true);
	});

	it("detects file: prefix", () => {
		expect(isWorkspaceSpecifier("file:../foo")).toBe(true);
		expect(isWorkspaceSpecifier("file:packages/bar")).toBe(true);
	});

	it("rejects regular version specifiers", () => {
		expect(isWorkspaceSpecifier("^1.0.0")).toBe(false);
		expect(isWorkspaceSpecifier("~2.0.0")).toBe(false);
		expect(isWorkspaceSpecifier("1.0.0")).toBe(false);
		expect(isWorkspaceSpecifier(">=1.0.0")).toBe(false);
		expect(isWorkspaceSpecifier("*")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isWorkspaceSpecifier("")).toBe(false);
	});

	it("rejects specifiers containing but not starting with keywords", () => {
		expect(isWorkspaceSpecifier("not-workspace:foo")).toBe(false);
		expect(isWorkspaceSpecifier("npm:workspace:*")).toBe(false);
	});
});

describe("extractWorkspaceDeps", () => {
	it("extracts dependencies that match workspace names", () => {
		const workspaces = new Map([["pkg-a", { dependencies: { "pkg-b": "workspace:*", lodash: "^4.0.0" } }]]);
		const workspaceNames = new Set(["pkg-a", "pkg-b"]);
		const deps = extractWorkspaceDeps(workspaces, workspaceNames);
		expect(deps).toHaveLength(1);
		expect(deps[0].from).toBe("pkg-a");
		expect(deps[0].to).toBe("pkg-b");
		expect(deps[0].depType).toBe("dependencies");
		expect(deps[0].constraint).toBe("workspace:*");
	});

	it("extracts from all dependency types", () => {
		const workspaces = new Map([
			[
				"pkg-a",
				{
					dependencies: { "pkg-b": "^1.0.0" },
					devDependencies: { "pkg-c": "^2.0.0" },
					peerDependencies: { "pkg-d": "^3.0.0" },
					optionalDependencies: { "pkg-e": "^4.0.0" },
				},
			],
		]);
		const workspaceNames = new Set(["pkg-b", "pkg-c", "pkg-d", "pkg-e"]);
		const deps = extractWorkspaceDeps(workspaces, workspaceNames);
		expect(deps).toHaveLength(4);
		const depTypes = deps.map((d) => d.depType).sort();
		expect(depTypes).toEqual(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]);
	});

	it("ignores dependencies not in workspaceNames", () => {
		const workspaces = new Map([["pkg-a", { dependencies: { lodash: "^4.0.0", express: "^4.0.0" } }]]);
		const workspaceNames = new Set(["pkg-a"]);
		const deps = extractWorkspaceDeps(workspaces, workspaceNames);
		expect(deps).toHaveLength(0);
	});

	it("handles empty workspace map", () => {
		const deps = extractWorkspaceDeps(new Map(), new Set(["pkg-a"]));
		expect(deps).toHaveLength(0);
	});

	it("handles empty workspaceNames set", () => {
		const workspaces = new Map([["pkg-a", { dependencies: { "pkg-b": "^1.0.0" } }]]);
		const deps = extractWorkspaceDeps(workspaces, new Set());
		expect(deps).toHaveLength(0);
	});

	it("handles entries with no dependency maps", () => {
		const workspaces = new Map([["pkg-a", {}]]);
		const workspaceNames = new Set(["pkg-a", "pkg-b"]);
		const deps = extractWorkspaceDeps(workspaces, workspaceNames);
		expect(deps).toHaveLength(0);
	});

	it("handles multiple workspaces with cross-references", () => {
		const workspaces = new Map([
			["pkg-a", { dependencies: { "pkg-b": "workspace:*" } }],
			["pkg-b", { dependencies: { "pkg-a": "workspace:*" } }],
		]);
		const workspaceNames = new Set(["pkg-a", "pkg-b"]);
		const deps = extractWorkspaceDeps(workspaces, workspaceNames);
		expect(deps).toHaveLength(2);
		expect(deps.find((d) => d.from === "pkg-a" && d.to === "pkg-b")).toBeDefined();
		expect(deps.find((d) => d.from === "pkg-b" && d.to === "pkg-a")).toBeDefined();
	});
});
