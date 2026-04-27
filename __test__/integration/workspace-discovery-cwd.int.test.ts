/**
 * Integration tests for the optional `cwd` parameter on WorkspaceDiscovery
 * methods. Verifies that an explicit cwd resolves a fresh root, results are
 * cached per resolved root, and the no-arg path uses the eagerly-resolved
 * default root.
 */

import { Path } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";
import { discoveryFixture } from "../utils/fixtures.js";

const platformLayer = Layer.mergeAll(
	NodeFileSystem.layer,
	Path.layer,
	Logger.replace(Logger.defaultLogger, Logger.none),
);

// Mock WorkspaceRoot.find that returns its argument unchanged. Lets each
// caller pass a fixture path directly as the "cwd"; the layer treats the
// returned value as the resolved workspace root.
const passthroughRoot = (defaultRoot: string) =>
	Layer.succeed(WorkspaceRoot, {
		find: (cwd: string) => Effect.succeed(cwd === "__default__" ? defaultRoot : cwd),
	});

const makeLayer = (defaultRoot: string) =>
	WorkspaceDiscoveryLive.pipe(Layer.provide(Layer.mergeAll(passthroughRoot(defaultRoot), platformLayer)));

const PNPM = discoveryFixture("pnpm/basic");
const NPM = discoveryFixture("npm/basic");

describe("WorkspaceDiscovery cwd parameter", () => {
	it("listPackages(cwd) resolves a fresh root for that call", async () => {
		// Construction-time default points at PNPM; the explicit cwd points at NPM.
		// Result should reflect NPM's packages, not PNPM's.
		const namesNpm = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const pkgs = yield* discovery.listPackages(NPM);
				return pkgs.map((p) => p.name).sort();
			}).pipe(Effect.provide(makeLayer(PNPM))),
		);

		expect(namesNpm).toContain("npm-basic-monorepo");
		expect(namesNpm).toContain("@scope/npm-lib-a");
		expect(namesNpm).not.toContain("pnpm-basic-monorepo");
	});

	it("listPackages() with no arg uses the eagerly-resolved default root", async () => {
		// Use a mock that returns PNPM only when called with the construction-time
		// process.cwd() sentinel. The layer eagerly calls find(process.cwd()) at
		// construction; once stored, no-arg calls reuse that value.
		const layer = WorkspaceDiscoveryLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(WorkspaceRoot, {
						find: () => Effect.succeed(PNPM),
					}),
					platformLayer,
				),
			),
		);

		const names = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const pkgs = yield* discovery.listPackages();
				return pkgs.map((p) => p.name).sort();
			}).pipe(Effect.provide(layer)),
		);

		expect(names).toContain("pnpm-basic-monorepo");
		expect(names).toContain("@scope/lib-public");
	});

	it("caches results per resolved root", async () => {
		// Two calls with the same cwd should return the same instance (memoised).
		// Two calls with different cwds should return different instances.
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const a1 = yield* discovery.listPackages(PNPM);
				const a2 = yield* discovery.listPackages(PNPM);
				const b1 = yield* discovery.listPackages(NPM);
				return { a1, a2, b1 };
			}).pipe(Effect.provide(makeLayer(PNPM))),
		);

		expect(result.a1).toBe(result.a2);
		expect(result.a1).not.toBe(result.b1);
	});

	it("importerMap(cwd) reflects the cwd-resolved root", async () => {
		const keys = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const map = yield* discovery.importerMap(NPM);
				return [...map.keys()].sort();
			}).pipe(Effect.provide(makeLayer(PNPM))),
		);

		expect(keys).toContain(".");
		expect(keys).toContain("packages/lib-a");
	});

	it("getPackage(name, cwd) finds packages under the cwd-resolved root", async () => {
		const pkg = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				return yield* discovery.getPackage("@scope/npm-lib-a", NPM);
			}).pipe(Effect.provide(makeLayer(PNPM))),
		);

		expect(pkg.name).toBe("@scope/npm-lib-a");
		expect(pkg.path).toBe(`${NPM}/packages/lib-a`);
	});

	it("getPackage rejects when package is not under the cwd-resolved root", async () => {
		// @scope/lib-public lives under PNPM; querying with NPM cwd should miss.
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				return yield* discovery
					.getPackage("@scope/lib-public", NPM)
					.pipe(Effect.catchTag("PackageNotFoundError", (e) => Effect.succeed({ tag: e._tag, name: e.name })));
			}).pipe(Effect.provide(makeLayer(PNPM))),
		);

		expect(result).toEqual({ tag: "PackageNotFoundError", name: "@scope/lib-public" });
	});
});
