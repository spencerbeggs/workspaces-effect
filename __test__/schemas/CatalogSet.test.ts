import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { CatalogSet } from "../../src/schemas/CatalogSet.js";

describe("CatalogSet", () => {
	it("fromWorkspaceYaml extracts default and named catalogs", async () => {
		const yaml = `packages:\n  - packages/*\ncatalog:\n  react: ^19.0.0\ncatalogs:\n  silk:\n    effect: ^3.21.0\n`;
		const set = await Effect.runPromise(CatalogSet.fromWorkspaceYaml(yaml));
		expect(Option.getOrNull(set.resolveSpecifier("react", "catalog:"))).toBe("^19.0.0");
		expect(Option.getOrNull(set.resolveSpecifier("effect", "catalog:silk"))).toBe("^3.21.0");
	});

	it("fromLockfileCatalogs normalizes string and object entries", () => {
		const set = CatalogSet.fromLockfileCatalogs({
			silk: { effect: { specifier: "^3.21.0", version: "3.21.4" }, react: "^19.0.0" },
		});
		expect(Option.getOrNull(set.resolveSpecifier("effect", "catalog:silk"))).toBe("^3.21.0");
		expect(Option.getOrNull(set.resolveSpecifier("react", "catalog:silk"))).toBe("^19.0.0");
	});

	it("merge lets later sources win per dependency within a catalog", () => {
		const lockfile = CatalogSet.fromLockfileCatalogs({ silk: { effect: "^3.20.0", zod: "^4.0.0" } });
		const inline = CatalogSet.fromCatalogs({ silk: { effect: "^3.21.0" } });
		const merged = CatalogSet.merge(lockfile, inline);
		expect(Option.getOrNull(merged.resolveSpecifier("effect", "catalog:silk"))).toBe("^3.21.0");
		expect(Option.getOrNull(merged.resolveSpecifier("zod", "catalog:silk"))).toBe("^4.0.0");
	});

	it("resolveSpecifier returns none for non-catalog specifiers and unresolved entries", () => {
		const set = CatalogSet.fromCatalogs({ default: { react: "^19.0.0" } });
		expect(Option.isNone(set.resolveSpecifier("react", "^19.0.0"))).toBe(true);
		expect(Option.isNone(set.resolveSpecifier("react", "workspace:*"))).toBe(true);
		expect(Option.isNone(set.resolveSpecifier("ghost", "catalog:silk"))).toBe(true);
		expect(Option.isNone(CatalogSet.empty().resolveSpecifier("react", "catalog:"))).toBe(true);
	});
});
