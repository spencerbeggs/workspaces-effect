import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { CatalogSet } from "../../src/schemas/CatalogSet.js";
import { PackageStateSnapshot, WorkspaceStateSnapshot } from "../../src/schemas/WorkspaceStateSnapshot.js";

const snap = new WorkspaceStateSnapshot({
	packages: [
		new PackageStateSnapshot({ name: "@acme/a", version: "1.2.3", relativePath: "packages/a", dependencies: {} }),
		new PackageStateSnapshot({
			name: "@acme/b",
			version: "2.0.0",
			relativePath: "packages/b",
			dependencies: { "@acme/a": "workspace:*", effect: "catalog:silk", react: "^19.0.0" },
		}),
	],
	catalogs: CatalogSet.fromCatalogs({ silk: { effect: "^3.21.0" } }),
});

describe("WorkspaceStateSnapshot", () => {
	it("resolves workspace: against its own package versions", () => {
		expect(Option.getOrNull(snap.resolve("@acme/a", "workspace:*"))).toBe("1.2.3");
		expect(Option.getOrNull(snap.resolve("@acme/a", "workspace:^"))).toBe("^1.2.3");
	});
	it("resolves catalog: against its own catalogs", () => {
		expect(Option.getOrNull(snap.resolve("effect", "catalog:silk"))).toBe("^3.21.0");
	});
	it("returns none for plain specifiers and unknown targets", () => {
		expect(Option.isNone(snap.resolve("react", "^19.0.0"))).toBe(true);
		expect(Option.isNone(snap.resolve("@acme/ghost", "workspace:*"))).toBe(true);
		expect(Option.isNone(snap.resolve("ghost", "catalog:missing"))).toBe(true);
	});
	it("package() finds by name", () => {
		expect(Option.getOrNull(snap.package("@acme/b"))?.version).toBe("2.0.0");
		expect(Option.isNone(snap.package("nope"))).toBe(true);
	});
});
