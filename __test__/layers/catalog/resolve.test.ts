import { describe, expect, it } from "vitest";
import { CatalogResolutionError } from "../../../src/errors/CatalogResolutionError.js";
import { resolveManifest, resolveWorkspaceProtocol } from "../../../src/layers/catalog/resolve.js";

describe("resolveWorkspaceProtocol", () => {
	it("maps workspace: protocol forms against a version", () => {
		expect(resolveWorkspaceProtocol("workspace:*", "1.2.3")).toBe("1.2.3");
		expect(resolveWorkspaceProtocol("workspace:~", "1.2.3")).toBe("~1.2.3");
		expect(resolveWorkspaceProtocol("workspace:^", "1.2.3")).toBe("^1.2.3");
		expect(resolveWorkspaceProtocol("workspace:^1.0.0", "1.2.3")).toBe("^1.0.0");
		expect(resolveWorkspaceProtocol("workspace:1.5.0", "1.2.3")).toBe("1.5.0");
	});
});

describe("resolveManifest", () => {
	const catalogs = { default: { "left-pad": "^1.3.0" }, silkPeers: { effect: ">=3" } };
	const versions = { "@x/lib": "2.0.0" };

	it("resolves catalog: and workspace: across all dep fields", () => {
		const out = resolveManifest(catalogs, versions, {
			name: "@x/p",
			version: "1.0.0",
			dependencies: { "left-pad": "catalog:", "@x/lib": "workspace:^" },
			peerDependencies: { effect: "catalog:silkPeers" },
		});
		expect(out.dependencies).toEqual({ "left-pad": "^1.3.0", "@x/lib": "^2.0.0" });
		expect(out.peerDependencies).toEqual({ effect: ">=3" });
	});

	it("throws CatalogResolutionError for an unknown catalog", () => {
		expect(() =>
			resolveManifest(catalogs, versions, { name: "@x/p", version: "1.0.0", dependencies: { z: "catalog:nope" } }),
		).toThrow(CatalogResolutionError);
	});

	it("throws CatalogResolutionError for an unresolvable workspace ref", () => {
		expect(() =>
			resolveManifest(catalogs, versions, { name: "@x/p", version: "1.0.0", dependencies: { unknown: "workspace:*" } }),
		).toThrow(CatalogResolutionError);
	});

	it("leaves plain specifiers untouched and asserts none survive", () => {
		const out = resolveManifest(catalogs, versions, {
			name: "@x/p",
			version: "1.0.0",
			dependencies: { typescript: "^5.0.0" },
		});
		expect(out.dependencies).toEqual({ typescript: "^5.0.0" });
	});
});
