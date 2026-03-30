/**
 * Tests for WorkspacesLive and WorkspacesFullLive composite layers.
 *
 * These are composition tests — they verify all services resolve through
 * the composite layer, not the service logic itself (individual layer
 * tests cover that).
 *
 * WorkspaceDiscoveryLive eagerly calls rootService.find(process.cwd())
 * at layer construction time, so WorkspacesLive cannot be used directly in
 * tests without the real filesystem. Instead we assemble a parallel test
 * layer that mirrors WorkspacesLive's wiring but substitutes mockRoot for
 * WorkspaceRootLive everywhere it appears as a dependency.
 */

import { CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";
import { ChangeDetectorLive } from "../../src/layers/ChangeDetectorLive.js";
import { DependencyGraphLive } from "../../src/layers/DependencyGraphLive.js";
import { LockfileReaderLive } from "../../src/layers/LockfileReaderLive.js";
import { PackageManagerDetectorLive } from "../../src/layers/PackageManagerDetectorLive.js";
import { PackageResolverLive } from "../../src/layers/PackageResolverLive.js";
import { PublishabilityDetectorLive } from "../../src/layers/PublishabilityDetectorLive.js";
import { TopologicalSorterLive } from "../../src/layers/TopologicalSorterLive.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import { ChangeDetector } from "../../src/services/ChangeDetector.js";
import { DependencyGraph } from "../../src/services/DependencyGraph.js";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { PackageManagerDetector } from "../../src/services/PackageManagerDetector.js";
import { PackageResolver } from "../../src/services/PackageResolver.js";
import { PublishabilityDetector } from "../../src/services/PublishabilityDetector.js";
import { TopologicalSorter } from "../../src/services/TopologicalSorter.js";
import { WorkspaceDiscovery } from "../../src/services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

// ── Mock filesystem ───────────────────────────────────────────────────

/**
 * A minimal pnpm monorepo:
 *   /projects/monorepo/
 *     pnpm-workspace.yaml
 *     package.json  (packageManager: pnpm@9.0.0)
 *     pnpm-lock.yaml
 *     packages/
 *       pkg-a/
 *         package.json
 */
const mockFs = () => {
	const files: Record<string, string> = {
		"/projects/monorepo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'",
		"/projects/monorepo/package.json": JSON.stringify({
			name: "my-monorepo",
			version: "1.0.0",
			packageManager: "pnpm@9.0.0",
		}),
		"/projects/monorepo/pnpm-lock.yaml": [
			'lockfileVersion: "9.0"',
			"importers:",
			"  .:",
			"    dependencies: {}",
			"packages: {}",
		].join("\n"),
		"/projects/monorepo/packages/pkg-a/package.json": JSON.stringify({
			name: "pkg-a",
			version: "1.0.0",
		}),
	};

	const dirs: Record<string, string[]> = {
		"/projects/monorepo/packages": ["pkg-a"],
	};

	return FileSystem.layerNoop({
		exists: (path) => Effect.succeed(path in files || path in dirs),
		readFileString: (path) => {
			const content = files[path];
			if (content === undefined) {
				return Effect.die(new Error(`ENOENT: ${path}`));
			}
			return Effect.succeed(content);
		},
		readDirectory: (path) => {
			const entries = dirs[path];
			if (entries === undefined) {
				return Effect.die(new Error(`ENOENT dir: ${path}`));
			}
			return Effect.succeed(entries);
		},
	});
};

// ── Shared mock layers ────────────────────────────────────────────────

/**
 * Mock WorkspaceRoot that always returns the known monorepo path,
 * bypassing the eager process.cwd() call inside WorkspaceDiscoveryLive.
 */
const mockRoot = Layer.succeed(WorkspaceRoot, {
	find: () => Effect.succeed("/projects/monorepo"),
});

/**
 * Minimal mock CommandExecutor for WorkspacesFullLive composition tests.
 * ChangeDetector resolves without needing real git invocations.
 */
const mockExecutor = Layer.succeed(CommandExecutor.CommandExecutor, {
	start: () => Effect.die(new Error("not implemented")),
} as unknown as CommandExecutor.CommandExecutor);

/** Platform dependencies. */
const platformDeps = Layer.mergeAll(mockFs(), Path.layer, Logger.replace(Logger.defaultLogger, Logger.none));

// ── WorkspacesLive — mirrored test layer ──────────────────────────────
//
// Mirrors the wiring in WorkspacesLive.ts exactly, but substitutes
// mockRoot for WorkspaceRootLive so layer construction does not walk the
// real filesystem starting from process.cwd().

const discoveryTestLayer = WorkspaceDiscoveryLive.pipe(Layer.provide(mockRoot));

const workspacesTestLayer = Layer.mergeAll(
	mockRoot,
	PackageManagerDetectorLive,
	discoveryTestLayer,
	DependencyGraphLive.pipe(Layer.provide(discoveryTestLayer), Layer.provide(mockRoot)),
	TopologicalSorterLive.pipe(
		Layer.provide(DependencyGraphLive),
		Layer.provide(discoveryTestLayer),
		Layer.provide(mockRoot),
	),
	LockfileReaderLive.pipe(Layer.provide(mockRoot), Layer.provide(PackageManagerDetectorLive)),
	PublishabilityDetectorLive,
).pipe(Layer.provide(platformDeps));

// ── WorkspacesFullLive — mirrored test layer ──────────────────────────
//
// Extends the WorkspacesLive test layer with PackageResolver and
// ChangeDetector (same internal structure as WorkspacesFullLive.ts).

const resolverTestLayer = PackageResolverLive.pipe(Layer.provide(discoveryTestLayer));

const graphTestLayer = DependencyGraphLive.pipe(Layer.provide(discoveryTestLayer), Layer.provide(mockRoot));

const workspacesFullTestLayer = Layer.mergeAll(
	workspacesTestLayer,
	resolverTestLayer.pipe(Layer.provide(platformDeps)),
	ChangeDetectorLive.pipe(
		Layer.provide(resolverTestLayer),
		Layer.provide(graphTestLayer),
		Layer.provide(mockExecutor),
		Layer.provide(platformDeps),
	),
).pipe(Layer.provide(platformDeps));

// ── WorkspacesLive tests ──────────────────────────────────────────────

describe("WorkspacesLive", () => {
	it("provides WorkspaceRoot", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* WorkspaceRoot;
				return yield* root.find("/projects/monorepo");
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(result).toBe("/projects/monorepo");
	});

	it("provides PackageManagerDetector", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				return yield* detector.detect("/projects/monorepo");
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(result.type).toBe("pnpm");
		expect(result.version).toBe("9.0.0");
	});

	it("provides WorkspaceDiscovery", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				return yield* discovery.listPackages();
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("my-monorepo");
		expect(result[0].relativePath).toBe(".");
		expect(result[1].name).toBe("pkg-a");
	});

	it("provides DependencyGraph", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const graph = yield* DependencyGraph;
				return yield* graph.packages();
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(Array.isArray(result)).toBe(true);
		expect(result).toContain("pkg-a");
	});

	it("provides TopologicalSorter", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const sorter = yield* TopologicalSorter;
				return yield* sorter.sort();
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		// sort() returns package names (strings), not WorkspacePackage objects
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(2);
		expect(result).toContain("my-monorepo");
		expect(result).toContain("pkg-a");
	});

	it("provides PublishabilityDetector", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const detector = yield* PublishabilityDetector;
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				return yield* detector.detect(packages[0], "/projects/monorepo");
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it("provides LockfileReader", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* LockfileReader;
			}).pipe(Effect.provide(workspacesTestLayer)),
		);

		expect(typeof result.readLockfile).toBe("function");
		expect(typeof result.resolvedVersion).toBe("function");
		expect(typeof result.workspaceDependencies).toBe("function");
	});
});

// ── WorkspacesFullLive tests ──────────────────────────────────────────

describe("WorkspacesFullLive", () => {
	it("provides PackageResolver (resolveFile)", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const resolver = yield* PackageResolver;
				return yield* resolver.resolveFile("/projects/monorepo/packages/pkg-a/src/index.ts");
			}).pipe(Effect.provide(workspacesFullTestLayer)),
		);

		expect(result._tag).toBe("Some");
		if (Option.isSome(result)) {
			expect(result.value.name).toBe("pkg-a");
		}
	});

	it("provides ChangeDetector", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ChangeDetector;
			}).pipe(Effect.provide(workspacesFullTestLayer)),
		);

		expect(typeof result.changedFiles).toBe("function");
		expect(typeof result.changedPackages).toBe("function");
		expect(typeof result.affectedPackages).toBe("function");
	});
});
