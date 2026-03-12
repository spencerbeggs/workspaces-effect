/**
 * Tests for PackageResolverLive layer.
 */

import { Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../schemas/core.js";
import { PackageResolver } from "../services/PackageResolver.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { PackageResolverLive } from "./PackageResolverLive.js";

/** Create test packages. */
const makePackage = (name: string, pkgPath: string): WorkspacePackage =>
	new WorkspacePackage({
		name,
		version: "1.0.0",
		path: pkgPath,
		relativePath: pkgPath.replace("/projects/monorepo/", ""),
	});

const pkgA = makePackage("@scope/pkg-a", "/projects/monorepo/packages/pkg-a");
const pkgB = makePackage("@scope/pkg-b", "/projects/monorepo/packages/pkg-b");
const appWeb = makePackage("web", "/projects/monorepo/apps/web");

/** Mock WorkspaceDiscovery that returns known packages. */
const mockDiscovery = (packages: ReadonlyArray<WorkspacePackage>) =>
	Layer.succeed(WorkspaceDiscovery, {
		listPackages: () => Effect.succeed(packages),
		getPackage: (name: string) => {
			const found = packages.find((p) => p.name === name);
			return found ? Effect.succeed(found) : Effect.die(`Package not found: ${name}`);
		},
	});

/** Build test layer with mock discovery. */
const testLayer = (packages: ReadonlyArray<WorkspacePackage>) =>
	PackageResolverLive.pipe(Layer.provide(Layer.mergeAll(mockDiscovery(packages), Path.layer)));

describe("PackageResolverLive", () => {
	describe("resolveFile", () => {
		it("resolves a file inside a package", async () => {
			const layer = testLayer([pkgA, pkgB, appWeb]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFile("/projects/monorepo/packages/pkg-a/src/index.ts");
				}).pipe(Effect.provide(layer)),
			);

			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.name).toBe("@scope/pkg-a");
			}
		});

		it("resolves a deeply nested file", async () => {
			const layer = testLayer([pkgA, pkgB]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFile("/projects/monorepo/packages/pkg-b/src/lib/utils/helper.ts");
				}).pipe(Effect.provide(layer)),
			);

			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.name).toBe("@scope/pkg-b");
			}
		});

		it("returns None for file outside all packages", async () => {
			const layer = testLayer([pkgA, pkgB]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFile("/projects/monorepo/README.md");
				}).pipe(Effect.provide(layer)),
			);

			expect(Option.isNone(result)).toBe(true);
		});

		it("returns None for completely unrelated path", async () => {
			const layer = testLayer([pkgA]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFile("/other/project/file.ts");
				}).pipe(Effect.provide(layer)),
			);

			expect(Option.isNone(result)).toBe(true);
		});

		it("does not match partial directory names", async () => {
			// "pkg-a" should not match "pkg-ab/file.ts"
			const layer = testLayer([pkgA]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFile("/projects/monorepo/packages/pkg-ab/src/index.ts");
				}).pipe(Effect.provide(layer)),
			);

			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("resolveFiles", () => {
		it("maps multiple files to their owning packages", async () => {
			const layer = testLayer([pkgA, pkgB, appWeb]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFiles([
						"/projects/monorepo/packages/pkg-a/src/index.ts",
						"/projects/monorepo/packages/pkg-b/README.md",
						"/projects/monorepo/apps/web/src/App.tsx",
						"/projects/monorepo/tsconfig.json",
					]);
				}).pipe(Effect.provide(layer)),
			);

			expect(result.size).toBe(3); // tsconfig is root-level, not in any package
			expect(result.get("/projects/monorepo/packages/pkg-a/src/index.ts")?.name).toBe("@scope/pkg-a");
			expect(result.get("/projects/monorepo/packages/pkg-b/README.md")?.name).toBe("@scope/pkg-b");
			expect(result.get("/projects/monorepo/apps/web/src/App.tsx")?.name).toBe("web");
			expect(result.has("/projects/monorepo/tsconfig.json")).toBe(false);
		});

		it("returns empty map for empty input", async () => {
			const layer = testLayer([pkgA]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.resolveFiles([]);
				}).pipe(Effect.provide(layer)),
			);

			expect(result.size).toBe(0);
		});
	});

	describe("packagePaths", () => {
		it("returns all indexed paths sorted by length descending", async () => {
			const layer = testLayer([pkgA, pkgB, appWeb]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.packagePaths();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(3);
			// Verify sorted by path length descending (longest first)
			for (let i = 1; i < result.length; i++) {
				expect(result[i - 1].path.length).toBeGreaterThanOrEqual(result[i].path.length);
			}
		});

		it("returns empty array when no packages", async () => {
			const layer = testLayer([]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const resolver = yield* PackageResolver;
					return yield* resolver.packagePaths();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(0);
		});
	});
});
