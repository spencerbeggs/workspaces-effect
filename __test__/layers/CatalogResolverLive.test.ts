import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { PackageNotFoundError } from "../../src/errors/PackageNotFoundError.js";
import { CatalogResolverLive } from "../../src/layers/CatalogResolverLive.js";
import { CatalogResolver } from "../../src/services/CatalogResolver.js";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

// Adaptation: WorkspaceDiscovery.getPackage returns Effect<WorkspacePackage, PackageNotFoundError | WorkspaceDiscoveryError>
// NOT Effect<Option<WorkspacePackage>>. So the mock returns Effect.succeed(pkg) or Effect.fail(PackageNotFoundError).

const makeDeps = (root: string) =>
	Layer.mergeAll(
		Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(root) } as never),
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
				name === "@x/lib"
					? Effect.succeed({ name, version: "2.0.0", path: "/fake", relativePath: "fake" })
					: Effect.fail(
							new PackageNotFoundError({
								name,
								available: ["@x/lib"],
							}),
						),
		} as never),
	);

const run = <A, E>(root: string, e: Effect.Effect<A, E, CatalogResolver>) =>
	Effect.runPromise(
		e.pipe(
			Effect.provide(CatalogResolverLive.pipe(Layer.provide(makeDeps(root)))),
			Effect.provide(makeDeps(root)),
			Effect.provide(NodeContext.layer),
		) as Effect.Effect<A, E, never>,
	);

describe("CatalogResolverLive", () => {
	it("assembles inline catalogs and resolves catalog: + workspace:", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crl-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), ["catalog:", "  left-pad: ^1.3.0"].join("\n"));
		const out = await run(
			dir,
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return yield* cr.resolve({
					name: "@x/p",
					version: "1.0.0",
					dependencies: { "left-pad": "catalog:", "@x/lib": "workspace:*" },
				});
			}),
		);
		expect(out.dependencies).toEqual({ "left-pad": "^1.3.0", "@x/lib": "2.0.0" });
		rmSync(dir, { recursive: true, force: true });
	});

	it("resolveSpecifier resolves catalog:, workspace:, and passes through plain specs", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crl-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), ["catalog:", "  left-pad: ^1.3.0"].join("\n"));
		const [cat, ws, plain] = await run(
			dir,
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return [
					yield* cr.resolveSpecifier("left-pad", "catalog:"),
					yield* cr.resolveSpecifier("@x/lib", "workspace:^"),
					yield* cr.resolveSpecifier("typescript", "^5.0.0"),
				] as const;
			}),
		);
		expect(cat).toEqual(Option.some("^1.3.0"));
		expect(ws).toEqual(Option.some("^2.0.0"));
		expect(plain).toEqual(Option.none());
		rmSync(dir, { recursive: true, force: true });
	});

	it("surfaces CatalogResolutionError as a typed, catchable failure for an unknown catalog", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crl-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), ["catalog:", "  left-pad: ^1.3.0"].join("\n"));
		const tag = await run(
			dir,
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return yield* cr.resolve({ name: "@x/p", version: "1.0.0", dependencies: { z: "catalog:nope" } }).pipe(
					Effect.map(() => "no-error" as const),
					Effect.catchTag("CatalogResolutionError", (e) => Effect.succeed(e._tag)),
				);
			}),
		);
		expect(tag).toBe("CatalogResolutionError");
		rmSync(dir, { recursive: true, force: true });
	});

	it("resolveSpecifier fails with CatalogResolutionError for an unresolvable workspace ref (consistent with resolve)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crl-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), ["catalog:", "  left-pad: ^1.3.0"].join("\n"));
		const tag = await run(
			dir,
			Effect.gen(function* () {
				const cr = yield* CatalogResolver;
				return yield* cr.resolveSpecifier("not-in-workspace", "workspace:*").pipe(
					Effect.map(() => "no-error" as const),
					Effect.catchTag("CatalogResolutionError", (e) => Effect.succeed(e._tag)),
				);
			}),
		);
		expect(tag).toBe("CatalogResolutionError");
		rmSync(dir, { recursive: true, force: true });
	});
});
