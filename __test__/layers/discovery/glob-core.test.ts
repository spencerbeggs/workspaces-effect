import { describe, expect, it } from "vitest";
import { compileWorkspaceGlobs } from "../../../src/layers/discovery/glob-core.js";

describe("compileWorkspaceGlobs", () => {
	it("classifies literals and wildcards", () => {
		const compiled = compileWorkspaceGlobs(["tools/cli", "packages/*", "apps/web-?"]);
		expect(compiled.literals).toEqual(["tools/cli"]);
		expect(compiled.wildcards).toHaveLength(2);
	});

	it("normalizes a trailing /** to /* (one-level limitation, issue 62)", () => {
		const [wildcard] = compileWorkspaceGlobs(["packages/**"]).wildcards;
		expect(wildcard.matches("packages/a")).toBe(true);
		expect(wildcard.matches("packages/a/b")).toBe(false);
	});

	it("computes the enumeration prefix from the last slash", () => {
		expect(compileWorkspaceGlobs(["packages/*"]).wildcards[0].prefix).toBe("packages/");
		expect(compileWorkspaceGlobs(["pkg-*"]).wildcards[0].prefix).toBe("");
	});

	it("matches ? as exactly one non-slash character", () => {
		const [wildcard] = compileWorkspaceGlobs(["apps/web-?"]).wildcards;
		expect(wildcard.matches("apps/web-1")).toBe(true);
		expect(wildcard.matches("apps/web-12")).toBe(false);
	});

	it("escapes regex metacharacters in patterns", () => {
		const [wildcard] = compileWorkspaceGlobs(["libs/a.b+c/*"]).wildcards;
		expect(wildcard.matches("libs/a.b+c/x")).toBe(true);
		expect(wildcard.matches("libs/aXbYc/x")).toBe(false);
	});

	it("collects literal negations into isExcluded", () => {
		const compiled = compileWorkspaceGlobs(["packages/*", "!packages/internal"]);
		expect(compiled.isExcluded("packages/internal")).toBe(true);
		expect(compiled.isExcluded("packages/a")).toBe(false);
	});

	it("collects wildcard negations into isExcluded", () => {
		const compiled = compileWorkspaceGlobs(["packages/*", "!packages/test-*"]);
		expect(compiled.isExcluded("packages/test-utils")).toBe(true);
		expect(compiled.isExcluded("packages/a")).toBe(false);
	});

	it("keeps the original pattern text on wildcards for error messages", () => {
		expect(compileWorkspaceGlobs(["packages/**"]).wildcards[0].source).toBe("packages/**");
	});

	it("deduplicates repeated literals", () => {
		expect(compileWorkspaceGlobs(["tools/cli", "tools/cli"]).literals).toEqual(["tools/cli"]);
	});
});
