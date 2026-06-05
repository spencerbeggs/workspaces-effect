import { describe, expect, it } from "vitest";
import { CatalogAssemblyError } from "../../src/errors/CatalogAssemblyError.js";
import { CatalogResolutionError } from "../../src/errors/CatalogResolutionError.js";

describe("catalog errors", () => {
	it("CatalogAssemblyError is tagged and carries source + reason", () => {
		const e = new CatalogAssemblyError({ source: "manifest", reason: "malformed yaml" });
		expect(e._tag).toBe("CatalogAssemblyError");
		expect(e.source).toBe("manifest");
		expect(e.message).toContain("malformed yaml");
	});

	it("CatalogResolutionError carries field/dependency/specifier", () => {
		const e = new CatalogResolutionError({
			field: "peerDependencies",
			dependency: "effect",
			specifier: "catalog:silkPeers",
			reason: "catalog not found",
		});
		expect(e._tag).toBe("CatalogResolutionError");
		expect(e.message).toContain("catalog:silkPeers");
		expect(e.message).toContain("effect");
	});
});
