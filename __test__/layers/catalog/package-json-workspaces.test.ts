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

		expect(result._tag).toBe("Failure");
	});

	it.each([
		["a number", { workspaces: 42 }],
		["a string", { workspaces: "packages/*" }],
		["a boolean", { workspaces: true }],
	])("fails with CatalogAssemblyError when workspaces is %s", async (_label, manifest) => {
		const result = await Effect.runPromiseExit(parsePackageJsonWorkspaces(JSON.stringify(manifest)));

		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			const failure = Cause.failureOption(result.cause);
			expect(failure._tag).toBe("Some");
			if (failure._tag === "Some") {
				expect(failure.value).toBeInstanceOf(CatalogAssemblyError);
				expect(failure.value.reason).toContain("malformed workspaces field");
			}
		}
	});

	it("fails with CatalogAssemblyError when workspaces is an array with non-string entries", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: ["packages/*", 42] })),
		);

		expect(result._tag).toBe("Failure");
	});

	it("fails with CatalogAssemblyError when workspaces.packages is not an array", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { packages: "packages/*" } })),
		);

		expect(result._tag).toBe("Failure");
	});

	it("fails with CatalogAssemblyError when workspaces.catalog is not a record", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { catalog: "not-an-object" } })),
		);

		expect(result._tag).toBe("Failure");
	});

	it("fails with CatalogAssemblyError when workspaces.catalogs is not a record of records", async () => {
		const result = await Effect.runPromiseExit(
			parsePackageJsonWorkspaces(JSON.stringify({ workspaces: { catalogs: { silk: "not-an-object" } } })),
		);

		expect(result._tag).toBe("Failure");
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
});
