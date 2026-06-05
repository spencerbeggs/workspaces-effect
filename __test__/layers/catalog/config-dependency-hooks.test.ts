import { describe, expect, it } from "vitest";
import {
	isPluginName,
	orderedPluginNames,
	runUpdateConfigHooks,
} from "../../../src/layers/catalog/config-dependency-hooks.js";

describe("isPluginName", () => {
	it("accepts pnpm plugin name shapes", () => {
		expect(isPluginName("pnpm-plugin-foo")).toBe(true);
		expect(isPluginName("@scope/pnpm-plugin-foo")).toBe(true);
		expect(isPluginName("@pnpm/plugin-foo")).toBe(true);
	});
	it("rejects non-plugin names", () => {
		expect(isPluginName("@scope/not-a-plugin")).toBe(false);
		expect(isPluginName("lodash")).toBe(false);
	});
});

describe("orderedPluginNames", () => {
	it("filters to plugin names in lexicographic order", () => {
		expect(orderedPluginNames({ "@b/pnpm-plugin-z": "1", "@a/pnpm-plugin-y": "1", lodash: "1" })).toEqual([
			"@a/pnpm-plugin-y",
			"@b/pnpm-plugin-z",
		]);
	});
});

describe("runUpdateConfigHooks", () => {
	it("threads config through sync + async hooks and returns merged catalogs", async () => {
		const hooks = [
			(c: { catalogs: Record<string, unknown> }) => ({ ...c, catalogs: { ...c.catalogs, a: { x: "^1" } } }),
			async (c: { catalogs: Record<string, unknown> }) => ({ ...c, catalogs: { ...c.catalogs, b: { y: "^2" } } }),
		];
		const out = await runUpdateConfigHooks(hooks, { default: { seed: "^0" } });
		expect(out).toEqual({ default: { seed: "^0" }, a: { x: "^1" }, b: { y: "^2" } });
	});

	it("skips a throwing hook and keeps prior config", async () => {
		const hooks = [
			(c: { catalogs: Record<string, unknown> }) => ({ ...c, catalogs: { ...c.catalogs, a: { x: "^1" } } }),
			() => {
				throw new Error("boom");
			},
			(c: { catalogs: Record<string, unknown> }) => ({ ...c, catalogs: { ...c.catalogs, c: { z: "^3" } } }),
		];
		const out = await runUpdateConfigHooks(hooks, {});
		expect(out).toEqual({ a: { x: "^1" }, c: { z: "^3" } });
	});

	it("skips a hook returning undefined/non-object", async () => {
		const hooks = [() => undefined as unknown as { catalogs: Record<string, unknown> }];
		const out = await runUpdateConfigHooks(hooks, { default: { x: "^1" } });
		expect(out).toEqual({ default: { x: "^1" } });
	});
});
