import type { Exit } from "effect";
import { Cause, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CatalogAssemblyError } from "../../../src/errors/CatalogAssemblyError.js";
import {
	catalogSetFromPackageJson,
	parsePackageJsonWorkspaces,
} from "../../../src/layers/catalog/package-json-workspaces.js";

const BUN_PKG = JSON.stringify({
	name: "root",
	workspaces: {
		packages: ["packages/*"],
		catalog: { react: "^19.0.0" },
		catalogs: { silk: { effect: "^3.21.4", typescript: "^7.0.2" } },
	},
});

/**
 * Asserts an Exit failed with a typed {@link CatalogAssemblyError} — not
 * merely a `Failure` Exit. A defect (an unhandled throw) also produces a
 * `Failure`, so a bare `exit._tag === "Failure"` check would pass even if the
 * code raised an untyped defect instead of the typed error the contract
 * promises. When `reasonSubstring` is given, also asserts the error's
 * `reason` contains it.
 */
const expectCatalogAssemblyError = (exit: Exit.Exit<unknown, unknown>, reasonSubstring?: string): void => {
	expect(exit._tag).toBe("Failure");
	if (exit._tag !== "Failure") return;
	const failure = Cause.failureOption(exit.cause);
	expect(failure._tag).toBe("Some");
	if (failure._tag !== "Some") return;
	expect(failure.value).toBeInstanceOf(CatalogAssemblyError);
	if (reasonSubstring !== undefined) {
		expect((failure.value as CatalogAssemblyError).reason).toContain(reasonSubstring);
	}
};

describe("parsePackageJsonWorkspaces", () => {
	it("reads packages, catalog and catalogs from the object form", async () => {
		const result = await Effect.runPromise(parsePackageJsonWorkspaces(BUN_PKG));

		expect(result.packages).toEqual(["packages/*"]);
		expect(result.catalog).toEqual({ react: "^19.0.0" });
		expect(result.catalogs).toEqual({ silk: { effect: "^3.21.4", typescript: "^7.0.2" } });
	});

	it("reads the array form as packages with no catalogs", async () => {
		const result = await Effect.runPromise(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: ["packages/*", "apps/*"] })),
		);

		expect(result.packages).toEqual(["packages/*", "apps/*"]);
		expect(result.catalog).toBeUndefined();
		expect(result.catalogs).toBeUndefined();
	});

	it("returns empty data when there is no workspaces field", async () => {
		const result = await Effect.runPromise(parsePackageJsonWorkspaces(JSON.stringify({ name: "solo" })));

		expect(result.packages).toBeUndefined();
		expect(result.catalog).toBeUndefined();
	});

	it("treats an explicit null workspaces field as absent", async () => {
		const result = await Effect.runPromise(
			parsePackageJsonWorkspaces(JSON.stringify({ name: "app", version: "1.0.0", workspaces: null })),
		);

		expect(result).toEqual({});
	});

	it("fails with CatalogAssemblyError on invalid JSON", async () => {
		const result = await Effect.runPromiseExit(parsePackageJsonWorkspaces("{{{ not json"));

		expectCatalogAssemblyError(result, "invalid json");
	});

	it.each([
		["a number", { workspaces: 42 }],
		["a string", { workspaces: "packages/*" }],
		["a boolean", { workspaces: true }],
	])("fails with CatalogAssemblyError when workspaces is %s", async (_label, manifest) => {
		const result = await Effect.runPromiseExit(parsePackageJsonWorkspaces(JSON.stringify(manifest)));

		expectCatalogAssemblyError(result, "malformed workspaces field");
	});

	it("fails with CatalogAssemblyError when workspaces is an array with non-string entries", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: ["packages/*", 42] })),
		);

		expectCatalogAssemblyError(result, "malformed workspaces field");
	});

	it("fails with CatalogAssemblyError when workspaces.packages is not an array", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { packages: "packages/*" } })),
		);

		expectCatalogAssemblyError(result, "malformed workspaces field");
	});

	it("fails with CatalogAssemblyError when workspaces.catalog is not a record", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { catalog: "not-an-object" } })),
		);

		expectCatalogAssemblyError(result, "malformed workspaces field");
	});

	it("fails with CatalogAssemblyError when workspaces.catalogs is not a record of records", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { catalogs: { silk: "not-an-object" } } })),
		);

		expectCatalogAssemblyError(result, "malformed workspaces field");
	});
});

describe("catalogSetFromPackageJson", () => {
	it("maps workspaces.catalog to the default catalog and catalogs by name", async () => {
		const set = await Effect.runPromise(catalogSetFromPackageJson(BUN_PKG));

		expect(set.entries.default).toEqual({ react: "^19.0.0" });
		expect(set.entries.silk).toEqual({ effect: "^3.21.4", typescript: "^7.0.2" });
	});

	it("is empty when there are no catalogs", async () => {
		const set = await Effect.runPromise(catalogSetFromPackageJson(JSON.stringify({ workspaces: ["."] })));

		expect(set.entries).toEqual({});
	});

	it("maps workspaces.catalog alone to the default catalog", async () => {
		const set = await Effect.runPromise(
			catalogSetFromPackageJson(JSON.stringify({ workspaces: { catalog: { react: "^19.0.0" } } })),
		);

		expect(set.entries.default).toEqual({ react: "^19.0.0" });
	});

	it("maps workspaces.catalogs.default alone to the default catalog", async () => {
		const set = await Effect.runPromise(
			catalogSetFromPackageJson(
				JSON.stringify({ workspaces: { catalogs: { default: { react: "^19.0.0" }, silk: { effect: "^3.21.4" } } } }),
			),
		);

		expect(set.entries.default).toEqual({ react: "^19.0.0" });
		expect(set.entries.silk).toEqual({ effect: "^3.21.4" });
	});

	it("fails with CatalogAssemblyError when the default catalog is declared both ways", async () => {
		const result = await Effect.runPromiseExit(
			catalogSetFromPackageJson(
				JSON.stringify({
					workspaces: {
						catalog: { react: "^19.0.0" },
						catalogs: { default: { react: "^18.0.0" } },
					},
				}),
			),
		);

		expectCatalogAssemblyError(result, "defined twice");
		if (result._tag === "Failure") {
			const failure = Cause.failureOption(result.cause);
			if (failure._tag === "Some") {
				expect((failure.value as CatalogAssemblyError).reason).toContain("workspaces.catalog");
				expect((failure.value as CatalogAssemblyError).reason).toContain("workspaces.catalogs.default");
			}
		}
	});
});
