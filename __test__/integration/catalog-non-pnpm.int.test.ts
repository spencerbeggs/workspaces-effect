import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("non-pnpm workspace graceful path", () => {
	it("returns empty catalogs and still resolves workspace: references", async () => {
		const dir = mkdtempSync(join(tmpdir(), "npm-"));
		const deps = Layer.mergeAll(
			Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(dir) } as never),
			Layer.succeed(LockfileReader, {
				readLockfile: () =>
					Effect.succeed({
						packageManager: "npm",
						lockfileVersion: undefined,
						packages: [],
						workspaceDependencies: [],
						pmSpecific: undefined,
					}),
			} as never),
			Layer.succeed(WorkspaceDiscovery, {
				getPackage: (name: string) =>
					name === "@x/lib"
						? Effect.succeed({ name, version: "9.9.9", path: "/fake", relativePath: "fake" })
						: Effect.fail(
								new PackageNotFoundError({
									name,
									available: ["@x/lib"],
								}),
							),
			} as never),
		);
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return yield* cr.resolve({ name: "@x/p", version: "1.0.0", dependencies: { "@x/lib": "workspace:^" } });
			}).pipe(
				Effect.provide(CatalogResolverLive.pipe(Layer.provide(deps))),
				Effect.provide(deps),
				Effect.provide(NodeContext.layer),
			) as unknown as Effect.Effect<{ dependencies?: Record<string, string> }, never, never>,
		);
		expect(out.dependencies).toEqual({ "@x/lib": "^9.9.9" });
		rmSync(dir, { recursive: true, force: true });
	});
});
