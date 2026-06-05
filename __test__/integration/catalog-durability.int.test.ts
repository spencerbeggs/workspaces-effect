import { existsSync } from "node:fs";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { PackageNotFoundError } from "../../src/errors/PackageNotFoundError.js";
import { CatalogResolverLive } from "../../src/layers/CatalogResolverLive.js";
import { CatalogResolver } from "../../src/services/CatalogResolver.js";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

const ROOT = join(import.meta.dirname, "fixtures/catalog/injected");

const deps = Layer.mergeAll(
	Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(ROOT) } as never),
	Layer.succeed(LockfileReader, {
		readLockfile: () =>
			Effect.succeed({
				packageManager: "pnpm",
				lockfileVersion: "9.0",
				packages: [],
				workspaceDependencies: [],
				pmSpecific: { _tag: "pnpm", catalogs: {} },
			}),
	} as never),
	Layer.succeed(WorkspaceDiscovery, {
		getPackage: (name: string) =>
			Effect.fail(
				new PackageNotFoundError({
					name,
					available: [],
				}),
			),
	} as never),
);

describe("catalog durability (config-dependency hook replay, no state file)", () => {
	it("assembles injected catalogs from sync + async hooks; skips the throwing one; state file absent", async () => {
		expect(existsSync(join(ROOT, "node_modules/.pnpm-workspace-state-v1.json"))).toBe(false);
		const catalogs = await Effect.runPromise(
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return yield* cr.catalogs();
			}).pipe(
				Effect.provide(CatalogResolverLive.pipe(Layer.provide(deps))),
				Effect.provide(deps),
				Effect.provide(NodeContext.layer),
			) as Effect.Effect<Record<string, Record<string, string>>, never, never>,
		);
		expect(catalogs.aCat).toEqual({ "is-odd": "^1.0.0" }); // sync hook
		expect(catalogs.peers).toEqual({ effect: ">=3" }); // async hook
		// throwing plugin (@scope/pnpm-plugin-bad) was skipped, not fatal
	});
});
