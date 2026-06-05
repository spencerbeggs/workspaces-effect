import { describe, expect, it } from "vitest";
import { inlineCatalogs, mergeCatalogs } from "../../../src/layers/catalog/assemble.js";

describe("mergeCatalogs", () => {
	it("unions named catalogs; later source wins per dependency", () => {
		const merged = mergeCatalogs({ ui: { react: "^17", a: "^1" } }, { ui: { react: "^18" } });
		expect(merged.ui).toEqual({ react: "^18", a: "^1" });
	});

	it("preserves the default catalog under the 'default' key", () => {
		const merged = mergeCatalogs({ default: { x: "^1" } }, { default: { y: "^2" } });
		expect(merged.default).toEqual({ x: "^1", y: "^2" });
	});
});

describe("inlineCatalogs", () => {
	it("projects manifest catalog/catalogs into a Catalogs map via @pnpm/catalogs.config", () => {
		const c = inlineCatalogs({ catalog: { "left-pad": "^1" }, catalogs: { ui: { react: "^18" } } });
		expect(c.default).toEqual({ "left-pad": "^1" });
		expect(c.ui).toEqual({ react: "^18" });
	});

	it("returns {} when neither catalog nor catalogs is present", () => {
		expect(inlineCatalogs({})).toEqual({});
	});
});
