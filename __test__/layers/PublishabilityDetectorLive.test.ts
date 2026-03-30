/**
 * Tests for PublishabilityDetectorLive layer.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PublishabilityDetectorLive } from "../../src/layers/PublishabilityDetectorLive.js";
import { WorkspacePackage } from "../../src/schemas/core.js";
import { PublishTarget } from "../../src/schemas/publish.js";
import { PublishabilityDetector } from "../../src/services/PublishabilityDetector.js";

/** Helper to create a WorkspacePackage with optional publishConfig. */
const pkg = (
	name: string,
	opts: {
		private?: boolean;
		publishConfig?: {
			access?: "public" | "restricted";
			registry?: string;
			directory?: string;
		};
	} = {},
): WorkspacePackage =>
	new WorkspacePackage({
		name,
		version: "1.0.0",
		path: `/workspace/packages/${name}`,
		relativePath: `packages/${name}`,
		private: opts.private ?? false,
		dependencies: {},
		devDependencies: {},
		publishConfig: opts.publishConfig,
	});

const ROOT = "/workspace";

const detect = (p: WorkspacePackage) =>
	Effect.gen(function* () {
		const detector = yield* PublishabilityDetector;
		return yield* detector.detect(p, ROOT);
	}).pipe(Effect.provide(PublishabilityDetectorLive));

describe("PublishabilityDetectorLive", () => {
	it("returns empty array for private package without publishConfig", async () => {
		const result = await Effect.runPromise(detect(pkg("private-pkg", { private: true })));
		expect(result).toEqual([]);
	});

	it("returns target when private but publishConfig.access is set", async () => {
		const result = await Effect.runPromise(
			detect(pkg("private-but-published", { private: true, publishConfig: { access: "public" } })),
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toBeInstanceOf(PublishTarget);
		expect(result[0].name).toBe("private-but-published");
		expect(result[0].access).toBe("public");
		expect(result[0].registry).toBe("https://registry.npmjs.org/");
		expect(result[0].directory).toBe(".");
		expect(result[0].provenance).toBe(false);
	});

	it("returns target with defaults for non-private package without publishConfig", async () => {
		const result = await Effect.runPromise(detect(pkg("public-pkg")));
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("public-pkg");
		expect(result[0].registry).toBe("https://registry.npmjs.org/");
		expect(result[0].directory).toBe(".");
		expect(result[0].access).toBe("public");
	});

	it("returns target with full publishConfig values", async () => {
		const result = await Effect.runPromise(
			detect(
				pkg("scoped-pkg", {
					publishConfig: {
						access: "restricted",
						registry: "https://npm.pkg.github.com/",
						directory: "dist/npm",
					},
				}),
			),
		);
		expect(result).toHaveLength(1);
		expect(result[0].access).toBe("restricted");
		expect(result[0].registry).toBe("https://npm.pkg.github.com/");
		expect(result[0].directory).toBe("dist/npm");
	});

	it("returns target with defaults for undefined private field", async () => {
		const result = await Effect.runPromise(detect(pkg("no-private-field")));
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("no-private-field");
	});

	it("returns target with custom registry only", async () => {
		const result = await Effect.runPromise(
			detect(pkg("custom-registry", { publishConfig: { registry: "https://custom.registry.dev/" } })),
		);
		expect(result).toHaveLength(1);
		expect(result[0].registry).toBe("https://custom.registry.dev/");
		expect(result[0].access).toBe("public");
		expect(result[0].directory).toBe(".");
	});

	it("returns target with custom directory only", async () => {
		const result = await Effect.runPromise(detect(pkg("custom-dir", { publishConfig: { directory: "dist/npm" } })));
		expect(result).toHaveLength(1);
		expect(result[0].directory).toBe("dist/npm");
		expect(result[0].registry).toBe("https://registry.npmjs.org/");
	});

	it("returns empty array for private package with publishConfig but no access", async () => {
		const result = await Effect.runPromise(
			detect(pkg("private-no-access", { private: true, publishConfig: { registry: "https://custom/" } })),
		);
		expect(result).toEqual([]);
	});
});
