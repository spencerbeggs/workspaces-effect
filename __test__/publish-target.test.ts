import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PublishTarget } from "../src/schemas/publish.js";

describe("PublishTarget", () => {
	it("constructs with all required fields", () => {
		const target = new PublishTarget({
			name: "@my-org/utils",
			registry: "https://registry.npmjs.org",
			directory: "dist/npm",
			access: "public",
		});
		expect(target.name).toBe("@my-org/utils");
		expect(target.registry).toBe("https://registry.npmjs.org");
		expect(target.directory).toBe("dist/npm");
		expect(target.access).toBe("public");
		expect(target.provenance).toBe(false);
	});

	it("defaults provenance to false", () => {
		const target = new PublishTarget({
			name: "my-pkg",
			registry: "https://registry.npmjs.org",
			directory: "",
			access: "restricted",
		});
		expect(target.provenance).toBe(false);
	});

	it("accepts explicit provenance true", () => {
		const target = new PublishTarget({
			name: "my-pkg",
			registry: "https://registry.npmjs.org",
			directory: "",
			access: "public",
			provenance: true,
		});
		expect(target.provenance).toBe(true);
	});

	it("accepts empty directory string", () => {
		const target = new PublishTarget({
			name: "my-pkg",
			registry: "https://registry.npmjs.org",
			directory: "",
			access: "public",
		});
		expect(target.directory).toBe("");
	});

	it("accepts restricted access", () => {
		const target = new PublishTarget({
			name: "@private/pkg",
			registry: "https://npm.pkg.github.com",
			directory: "dist",
			access: "restricted",
		});
		expect(target.access).toBe("restricted");
	});

	it("decodes from unknown input", () => {
		const target = Schema.decodeUnknownSync(PublishTarget)({
			name: "my-pkg",
			registry: "https://registry.npmjs.org",
			directory: "dist",
			access: "public",
		});
		expect(target.name).toBe("my-pkg");
		expect(target.provenance).toBe(false);
	});

	it("rejects empty name", () => {
		expect(
			() =>
				new PublishTarget({
					name: "" as any,
					registry: "https://registry.npmjs.org",
					directory: "",
					access: "public",
				}),
		).toThrow();
	});

	it("rejects empty registry", () => {
		expect(
			() =>
				new PublishTarget({
					name: "my-pkg",
					registry: "" as any,
					directory: "",
					access: "public",
				}),
		).toThrow();
	});

	it("rejects invalid access value", () => {
		expect(() =>
			Schema.decodeUnknownSync(PublishTarget)({
				name: "my-pkg",
				registry: "https://registry.npmjs.org",
				directory: "",
				access: "internal",
			}),
		).toThrow();
	});

	it("rejects missing required fields", () => {
		expect(() => Schema.decodeUnknownSync(PublishTarget)({})).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PublishTarget)({
				name: "my-pkg",
			}),
		).toThrow();
	});
});
