/**
 * Tests for DependencyGraphLive layer.
 */

import { Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { PackageNotFoundError } from "../errors/PackageNotFoundError.js";
import { WorkspacePackage } from "../schemas/core.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { DependencyGraphLive } from "./DependencyGraphLive.js";

/** Create a mock WorkspaceDiscovery from package data. */
const mockDiscovery = (packages: WorkspacePackage[]) =>
	Layer.succeed(WorkspaceDiscovery, {
		listPackages: () => Effect.succeed(packages),
		getPackage: (name: string) => {
			const found = packages.find((p) => p.name === name);
			return found
				? Effect.succeed(found)
				: Effect.fail(new PackageNotFoundError({ name, available: packages.map((p) => p.name) }));
		},
		importerMap: () =>
			Effect.succeed(new Map(packages.map((p) => [p.relativePath, p])) as ReadonlyMap<string, WorkspacePackage>),
	});

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

const testLayer = (packages: WorkspacePackage[]) =>
	DependencyGraphLive.pipe(
		Layer.provide(Layer.merge(mockDiscovery(packages), Logger.replace(Logger.defaultLogger, Logger.none))),
	);

describe("DependencyGraphLive", () => {
	describe("dependenciesOf", () => {
		it("returns direct dependencies", async () => {
			const layer = testLayer([
				pkg("pkg-a", { "pkg-b": "workspace:*", "pkg-c": "workspace:*" }),
				pkg("pkg-b"),
				pkg("pkg-c"),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("pkg-a");
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["pkg-b", "pkg-c"]);
		});

		it("returns empty array for packages with no deps", async () => {
			const layer = testLayer([pkg("pkg-a"), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("pkg-a");
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual([]);
		});

		it("fails for unknown package", async () => {
			const layer = testLayer([pkg("pkg-a")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("nonexistent").pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result._tag).toBe("PackageNotFoundError");
		});

		it("excludes external npm dependencies", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "workspace:*", lodash: "^4.0.0" }), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("pkg-a");
				}).pipe(Effect.provide(layer)),
			);

			// lodash should NOT appear (external)
			expect(result).toEqual(["pkg-b"]);
		});

		it("includes devDependencies as edges", async () => {
			const layer = testLayer([pkg("pkg-a", {}, { "pkg-b": "workspace:*" }), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("pkg-a");
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["pkg-b"]);
		});

		it("ignores self-dependencies", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-a": "workspace:*" })]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("pkg-a");
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual([]);
		});
	});

	describe("dependentsOf", () => {
		it("returns packages that depend on the given package", async () => {
			const layer = testLayer([
				pkg("pkg-a", { "pkg-c": "workspace:*" }),
				pkg("pkg-b", { "pkg-c": "workspace:*" }),
				pkg("pkg-c"),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("pkg-c");
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["pkg-a", "pkg-b"]);
		});
	});

	describe("packages", () => {
		it("returns all package names sorted", async () => {
			const layer = testLayer([pkg("z-pkg"), pkg("a-pkg"), pkg("m-pkg")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.packages();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["a-pkg", "m-pkg", "z-pkg"]);
		});
	});

	describe("hasCycle", () => {
		it("returns false for acyclic graph", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "*" }), pkg("pkg-b", { "pkg-c": "*" }), pkg("pkg-c")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.hasCycle();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toBe(false);
		});

		it("returns true for cyclic graph", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "*" }), pkg("pkg-b", { "pkg-a": "*" })]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.hasCycle();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toBe(true);
		});

		it("returns true for indirect cycle", async () => {
			const layer = testLayer([
				pkg("pkg-a", { "pkg-b": "*" }),
				pkg("pkg-b", { "pkg-c": "*" }),
				pkg("pkg-c", { "pkg-a": "*" }),
			]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.hasCycle();
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toBe(true);
		});
	});

	describe("adjacencyMap", () => {
		it("returns the full graph structure", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "*" }), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.adjacencyMap();
				}).pipe(Effect.provide(layer)),
			);

			expect(result.get("pkg-a")).toEqual(new Set(["pkg-b"]));
			expect(result.get("pkg-b")).toEqual(new Set());
		});
	});

	describe("request caching", () => {
		it("caches dependenciesOf requests within the same scope", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "workspace:*" }), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					const first = yield* graph.dependenciesOf("pkg-a");
					const second = yield* graph.dependenciesOf("pkg-a");
					return { first, second };
				}).pipe(Effect.provide(layer)),
			);

			// Reference equality proves caching — without caching,
			// each call creates a new Array.from(deps).sort()
			expect(result.first).toBe(result.second);
			expect(result.first).toEqual(["pkg-b"]);
		});

		it("caches dependentsOf requests within the same scope", async () => {
			const layer = testLayer([pkg("pkg-a", { "pkg-b": "workspace:*" }), pkg("pkg-b")]);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					const first = yield* graph.dependentsOf("pkg-b");
					const second = yield* graph.dependentsOf("pkg-b");
					return { first, second };
				}).pipe(Effect.provide(layer)),
			);

			expect(result.first).toBe(result.second);
			expect(result.first).toEqual(["pkg-a"]);
		});
	});
});
