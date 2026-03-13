/**
 * Tests for TopologicalSorterLive layer.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { PackageNotFoundError, WorkspacePackage } from "../index.js";
import { TopologicalSorter } from "../services/TopologicalSorter.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { DependencyGraphLive } from "./DependencyGraphLive.js";
import { TopologicalSorterLive } from "./TopologicalSorterLive.js";

/** Helper to create a WorkspacePackage. */
const pkg = (name: string, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): WorkspacePackage =>
	new WorkspacePackage({
		name,
		version: "1.0.0",
		path: `/workspace/packages/${name}`,
		relativePath: `packages/${name}`,
		dependencies: deps,
		devDependencies: devDeps,
	});

/** Build test layer from package list. */
const testLayer = (packages: WorkspacePackage[]) => {
	const mockDiscovery = Layer.succeed(WorkspaceDiscovery, {
		listPackages: () => Effect.succeed(packages),
		getPackage: (name: string) => {
			const found = packages.find((p) => p.name === name);
			return found
				? Effect.succeed(found)
				: Effect.fail(new PackageNotFoundError({ name, available: packages.map((p) => p.name) }));
		},
	});

	return TopologicalSorterLive.pipe(Layer.provide(DependencyGraphLive), Layer.provide(mockDiscovery));
};

describe("TopologicalSorterLive", () => {
	describe("sort", () => {
		it("sorts linear chain (dependencies first)", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "*" }), pkg("pkg-b", { "pkg-c": "*" }), pkg("pkg-c")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}).pipe(Effect.provide(layer)),
			);

			// pkg-c has no deps, then pkg-b, then pkg-a
			expect(result).toEqual(["pkg-c", "pkg-b", "pkg-a"]);
		});

		it("sorts diamond dependency", async () => {
			const layer = testLayer([
				pkg("app", { "lib-a": "*", "lib-b": "*" }),
				pkg("lib-a", { core: "*" }),
				pkg("lib-b", { core: "*" }),
				pkg("core"),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}).pipe(Effect.provide(layer)),
			);

			// core first, then lib-a and lib-b (alphabetical), then app
			const coreIdx = result.indexOf("core");
			const libAIdx = result.indexOf("lib-a");
			const libBIdx = result.indexOf("lib-b");
			const appIdx = result.indexOf("app");

			expect(coreIdx).toBeLessThan(libAIdx);
			expect(coreIdx).toBeLessThan(libBIdx);
			expect(libAIdx).toBeLessThan(appIdx);
			expect(libBIdx).toBeLessThan(appIdx);
		});

		it("sorts isolated packages (all at level 0)", async () => {
			const layer = testLayer([pkg("pkg-a"), pkg("pkg-b"), pkg("pkg-c")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}).pipe(Effect.provide(layer)),
			);

			// All at level 0, sorted alphabetically
			expect(result).toEqual(["pkg-a", "pkg-b", "pkg-c"]);
		});

		it("fails with CyclicDependencyError for cycles", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "*" }), pkg("pkg-b", { "pkg-a": "*" })]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result._tag).toBe("CyclicDependencyError");
			expect(result.cycle).toContain("pkg-a");
			expect(result.cycle).toContain("pkg-b");
			expect(result.message).toContain("Cyclic dependency detected");
		});

		it("fails for indirect cycle (A -> B -> C -> A)", async () => {
			const layer = testLayer([
				pkg("pkg-a", { "pkg-b": "*" }),
				pkg("pkg-b", { "pkg-c": "*" }),
				pkg("pkg-c", { "pkg-a": "*" }),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort().pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result._tag).toBe("CyclicDependencyError");
		});

		it("handles single package", async () => {
			const layer = testLayer([pkg("solo")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["solo"]);
		});
	});

	describe("levels", () => {
		it("groups packages by parallel execution level", async () => {
			const layer = testLayer([
				pkg("app", { "lib-a": "*", "lib-b": "*" }),
				pkg("lib-a", { core: "*" }),
				pkg("lib-b", { core: "*" }),
				pkg("core"),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual(["core"]);
			expect(result[1]).toEqual(["lib-a", "lib-b"]);
			expect(result[2]).toEqual(["app"]);
		});

		it("puts all isolated packages at level 0", async () => {
			const layer = testLayer([pkg("pkg-a"), pkg("pkg-b"), pkg("pkg-c")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(["pkg-a", "pkg-b", "pkg-c"]);
		});
	});

	describe("sortSubset", () => {
		it("sorts only the requested packages and their transitive deps", async () => {
			const layer = testLayer([pkg("app", { "lib-a": "*" }), pkg("lib-a", { core: "*" }), pkg("lib-b"), pkg("core")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sortSubset(["app"]);
				}).pipe(Effect.provide(layer)),
			);

			// Should include app, lib-a, core but NOT lib-b
			expect(result).toContain("app");
			expect(result).toContain("lib-a");
			expect(result).toContain("core");
			expect(result).not.toContain("lib-b");
			// core before lib-a before app
			expect(result.indexOf("core")).toBeLessThan(result.indexOf("lib-a"));
			expect(result.indexOf("lib-a")).toBeLessThan(result.indexOf("app"));
		});

		it("fails for unknown package name", async () => {
			const layer = testLayer([pkg("pkg-a")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sortSubset(["nonexistent"]).pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result._tag).toBe("PackageNotFoundError");
		});
	});
});
