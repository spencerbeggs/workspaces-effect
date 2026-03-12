/**
 * Tests for ChangeDetectorLive layer.
 */

import { Command, CommandExecutor } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect, Layer, Option, Sink, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspacePackage } from "../schemas/core.js";
import { ChangeDetectionOptions, ChangeDetector } from "../services/ChangeDetector.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { PackageResolver } from "../services/PackageResolver.js";
import { ChangeDetectorLive } from "./ChangeDetectorLive.js";

// ── Test data ────────────────────────────────────────────────────────

const makePackage = (name: string, pkgPath: string): WorkspacePackage =>
	new WorkspacePackage({
		name,
		version: "1.0.0",
		path: pkgPath,
		relativePath: pkgPath.replace("/projects/monorepo/", ""),
	});

const pkgA = makePackage("pkg-a", "/projects/monorepo/packages/pkg-a");
const pkgB = makePackage("pkg-b", "/projects/monorepo/packages/pkg-b");
const pkgC = makePackage("pkg-c", "/projects/monorepo/packages/pkg-c");

// ── Mock PackageResolver ─────────────────────────────────────────────

const mockResolver = (packages: ReadonlyArray<WorkspacePackage>) =>
	Layer.succeed(PackageResolver, {
		resolveFile: (filePath: string) => {
			for (const pkg of packages) {
				if (filePath.startsWith(`${pkg.path}/`)) {
					return Effect.succeed(Option.some(pkg));
				}
			}
			return Effect.succeed(Option.none());
		},
		resolveFiles: (filePaths: ReadonlyArray<string>) =>
			Effect.succeed(
				filePaths.reduce((map, fp) => {
					for (const pkg of packages) {
						if (fp.startsWith(`${pkg.path}/`)) {
							map.set(fp, pkg);
							break;
						}
					}
					return map;
				}, new Map<string, WorkspacePackage>()),
			),
		packagePaths: () => Effect.succeed(packages.map((pkg) => ({ path: `${pkg.path}/`, package: pkg }))),
	});

// ── Mock DependencyGraph ─────────────────────────────────────────────

const mockGraph = (deps: Record<string, string[]>, reverseDeps: Record<string, string[]>) =>
	Layer.succeed(DependencyGraph, {
		dependenciesOf: (name: string) => Effect.succeed(deps[name] ?? []),
		dependentsOf: (name: string) => Effect.succeed(reverseDeps[name] ?? []),
		packages: () => Effect.succeed(Object.keys(deps)),
		hasCycle: () => Effect.succeed(false),
		adjacencyMap: () => Effect.succeed(new Map()),
	});

// ── Mock CommandExecutor ─────────────────────────────────────────────

/**
 * Create a mock CommandExecutor that returns pre-recorded responses.
 * Responses are keyed by the git args (e.g., "rev-parse --git-dir").
 */
const mockExecutor = (responses: Record<string, string>, options?: { failAll?: boolean }) => {
	const encoder = new TextEncoder();

	const executor = CommandExecutor.makeExecutor((command) => {
		if (options?.failAll) {
			return Effect.fail(
				new SystemError({
					reason: "NotFound",
					module: "Command",
					method: "spawn",
					pathOrDescriptor: "git",
					description: "git not found",
				}),
			);
		}

		// Extract args — Command.make("git", ...args) stores command + args
		const flat = Command.flatten(command);
		const std = flat[0];
		const args = Array.from(std.args);
		const key = args.join(" ");

		const stdout = responses[key] ?? "";

		return Effect.succeed({
			[CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
			pid: CommandExecutor.ProcessId(1),
			exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
			isRunning: Effect.succeed(false),
			kill: () => Effect.void,
			stderr: Stream.empty,
			stdin: Sink.drain,
			stdout: Stream.make(encoder.encode(stdout)),
			toJSON: () => ({}),
		} as unknown as CommandExecutor.Process);
	});

	return Layer.succeed(CommandExecutor.CommandExecutor, executor);
};

// ── Test helpers ─────────────────────────────────────────────────────

const buildLayer = (
	packages: ReadonlyArray<WorkspacePackage>,
	gitResponses: Record<string, string>,
	deps: Record<string, string[]> = {},
	reverseDeps: Record<string, string[]> = {},
	executorOptions?: { failAll?: boolean },
) =>
	ChangeDetectorLive.pipe(
		Layer.provide(
			Layer.mergeAll(mockResolver(packages), mockGraph(deps, reverseDeps), mockExecutor(gitResponses, executorOptions)),
		),
	);

// ── Tests ────────────────────────────────────────────────────────────

describe("ChangeDetectorLive", () => {
	describe("changedFiles", () => {
		it("returns files from git diff between base and head", async () => {
			const layer = buildLayer([pkgA, pkgB], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD": "packages/pkg-a/src/index.ts\npackages/pkg-b/README.md\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedFiles(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["packages/pkg-a/src/index.ts", "packages/pkg-b/README.md"]);
		});

		it("returns empty array when no changes", async () => {
			const layer = buildLayer([pkgA], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD": "",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedFiles(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual([]);
		});

		it("uses custom base and head refs", async () => {
			const layer = buildLayer([pkgA], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only main...feature": "packages/pkg-a/src/new.ts\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedFiles(new ChangeDetectionOptions({ base: "main", head: "feature" }));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual(["packages/pkg-a/src/new.ts"]);
		});

		it("includes uncommitted changes when option is set", async () => {
			const layer = buildLayer([pkgA, pkgB], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD": "packages/pkg-a/src/index.ts\n",
				"diff --name-only": "packages/pkg-b/src/lib.ts\n",
				"diff --name-only --cached": "packages/pkg-a/src/new.ts\n",
				"ls-files --others --exclude-standard": "packages/pkg-b/temp.ts\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedFiles(new ChangeDetectionOptions({ includeUncommitted: true }));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toEqual([
				"packages/pkg-a/src/index.ts",
				"packages/pkg-a/src/new.ts",
				"packages/pkg-b/src/lib.ts",
				"packages/pkg-b/temp.ts",
			]);
		});

		it("fails with GitNotAvailableError when git is not available", async () => {
			const layer = buildLayer([pkgA], {}, {}, {}, { failAll: true });

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedFiles(new ChangeDetectionOptions({})).pipe(Effect.flip);
				}).pipe(Effect.provide(layer)),
			);

			expect(result._tag).toBe("GitNotAvailableError");
		});
	});

	describe("changedPackages", () => {
		it("maps changed files to their owning packages", async () => {
			const layer = buildLayer([pkgA, pkgB], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD":
					"/projects/monorepo/packages/pkg-a/src/index.ts\n/projects/monorepo/packages/pkg-b/README.md\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(2);
			expect(result.map((p) => p.name)).toEqual(["pkg-a", "pkg-b"]);
		});

		it("deduplicates packages when multiple files change in same package", async () => {
			const layer = buildLayer([pkgA], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD":
					"/projects/monorepo/packages/pkg-a/src/index.ts\n/projects/monorepo/packages/pkg-a/src/lib.ts\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("pkg-a");
		});

		it("ignores files outside all packages", async () => {
			const layer = buildLayer([pkgA], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD":
					"/projects/monorepo/packages/pkg-a/src/index.ts\n/projects/monorepo/tsconfig.json\n",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("pkg-a");
		});

		it("returns empty when no changes", async () => {
			const layer = buildLayer([pkgA], {
				"rev-parse --git-dir": ".git\n",
				"diff --name-only HEAD~1...HEAD": "",
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.changedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(0);
		});
	});

	describe("affectedPackages", () => {
		it("includes transitive dependents of changed packages", async () => {
			const layer = buildLayer(
				[pkgA, pkgB, pkgC],
				{
					"rev-parse --git-dir": ".git\n",
					"diff --name-only HEAD~1...HEAD": "/projects/monorepo/packages/pkg-a/src/index.ts\n",
				},
				{ "pkg-a": [], "pkg-b": ["pkg-a"], "pkg-c": ["pkg-b"] },
				{ "pkg-a": ["pkg-b"], "pkg-b": ["pkg-c"], "pkg-c": [] },
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.affectedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			const names = result.map((p) => p.name);
			expect(names).toContain("pkg-a");
			expect(names).toContain("pkg-b");
			expect(names).toContain("pkg-c");
			expect(names).toHaveLength(3);
		});

		it("does not include unrelated packages", async () => {
			const layer = buildLayer(
				[pkgA, pkgB, pkgC],
				{
					"rev-parse --git-dir": ".git\n",
					"diff --name-only HEAD~1...HEAD": "/projects/monorepo/packages/pkg-c/src/index.ts\n",
				},
				{ "pkg-a": [], "pkg-b": [], "pkg-c": [] },
				{ "pkg-a": [], "pkg-b": [], "pkg-c": [] },
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.affectedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("pkg-c");
		});

		it("returns empty when no changes", async () => {
			const layer = buildLayer(
				[pkgA],
				{
					"rev-parse --git-dir": ".git\n",
					"diff --name-only HEAD~1...HEAD": "",
				},
				{ "pkg-a": [] },
				{ "pkg-a": [] },
			);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const detector = yield* ChangeDetector;
					return yield* detector.affectedPackages(new ChangeDetectionOptions({}));
				}).pipe(Effect.provide(layer)),
			);

			expect(result).toHaveLength(0);
		});
	});
});
