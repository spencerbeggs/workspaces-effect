import { FileSystem, Path, Error as PlatformError } from "@effect/platform";
import { Effect, Exit, Layer, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";
import { LockfileReaderLive } from "../../src/layers/LockfileReaderLive.js";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { PackageManagerDetector } from "../../src/services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const PNPM_FIXTURE = `lockfileVersion: "9.0"
importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3
  packages/core:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
packages:
  lodash@4.17.21:
    resolution:
      integrity: sha512-abc
  typescript@5.3.3:
    resolution:
      integrity: sha512-def
`;

const NPM_FIXTURE = JSON.stringify({
	name: "my-monorepo",
	version: "1.0.0",
	lockfileVersion: 3,
	requires: true,
	packages: {
		"": { name: "my-monorepo", version: "1.0.0", devDependencies: { typescript: "^5.3.0" } },
		"node_modules/@my-monorepo/core": { resolved: "packages/core", link: true },
		"packages/core": { name: "@my-monorepo/core", version: "1.0.0" },
		"node_modules/typescript": { version: "5.3.3", integrity: "sha512-ghi", dev: true },
	},
});

const YARN_FIXTURE = `\
__metadata:
  version: 8
  cacheKey: 10c0

"my-monorepo@workspace:.":
  version: 0.0.0-use.local
  resolution: "my-monorepo@workspace:."
  devDependencies:
    typescript: "npm:^5.3.0"
  languageName: unknown
  linkType: soft

"typescript@npm:^5.3.0":
  version: 5.3.3
  resolution: "typescript@npm:5.3.3"
  checksum: ghi789
  languageName: node
  linkType: hard
`;

const BUN_FIXTURE = `{
  "lockfileVersion": 0,
  "workspaces": {
    "": {
      "name": "my-monorepo",
      "devDependencies": {
        "typescript": "^5.3.0",
      },
    },
  },
  "packages": {
    "typescript": ["typescript@5.3.3", "", {}, "sha512-ghi"],
  },
}`;

// ── Helpers ───────────────────────────────────────────────────────────

const notFound = (filePath: string) =>
	new PlatformError.SystemError({
		reason: "NotFound",
		module: "FileSystem",
		method: "readFileString",
		pathOrDescriptor: filePath,
	});

const testLayer = (pm: "pnpm" | "npm" | "yarn" | "bun", lockfileContent: string) =>
	LockfileReaderLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(WorkspaceRoot, {
					find: () => Effect.succeed("/project"),
				}),
				Layer.succeed(PackageManagerDetector, {
					detect: (_root: string) =>
						Effect.succeed({
							type: pm,
							version: undefined,
							runtime: pm === "bun" ? "bun" : "node",
						}),
				}),
				FileSystem.layerNoop({
					readFileString: (filePath: string) => {
						if (
							filePath.endsWith(".lock") ||
							filePath.endsWith(".yaml") ||
							(filePath.endsWith(".json") && filePath.includes("lock"))
						) {
							return Effect.succeed(lockfileContent);
						}
						return Effect.fail(notFound(filePath));
					},
				}),
				Path.layer,
				Logger.replace(Logger.defaultLogger, Logger.none),
			),
		),
	);

// ── Tests ─────────────────────────────────────────────────────────────

describe("LockfileReaderLive", () => {
	it("reads pnpm lockfile end-to-end", async () => {
		const layer = testLayer("pnpm", PNPM_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.readLockfile();
			}).pipe(Effect.provide(layer)),
		);
		expect(result.packageManager).toBe("pnpm");
		expect(result.packages.length).toBeGreaterThan(0);
	});

	it("reads npm lockfile end-to-end", async () => {
		const layer = testLayer("npm", NPM_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.readLockfile();
			}).pipe(Effect.provide(layer)),
		);
		expect(result.packageManager).toBe("npm");
		expect(result.packages.length).toBeGreaterThan(0);
	});

	it("reads yarn lockfile end-to-end", async () => {
		const layer = testLayer("yarn", YARN_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.readLockfile();
			}).pipe(Effect.provide(layer)),
		);
		expect(result.packageManager).toBe("yarn");
		expect(result.packages.length).toBeGreaterThan(0);
	});

	it("reads bun lockfile end-to-end", async () => {
		const layer = testLayer("bun", BUN_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.readLockfile();
			}).pipe(Effect.provide(layer)),
		);
		expect(result.packageManager).toBe("bun");
		expect(result.packages.length).toBeGreaterThan(0);
	});

	it("resolvedVersion returns Some for known package", async () => {
		const layer = testLayer("pnpm", PNPM_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.resolvedVersion("lodash");
			}).pipe(Effect.provide(layer)),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.version).toBe("4.17.21");
		}
	});

	it("resolvedVersion returns None for unknown package", async () => {
		const layer = testLayer("pnpm", PNPM_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.resolvedVersion("nonexistent");
			}).pipe(Effect.provide(layer)),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("workspaceDependencies returns the dependency list", async () => {
		const layer = testLayer("pnpm", PNPM_FIXTURE);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.workspaceDependencies();
			}).pipe(Effect.provide(layer)),
		);
		expect(Array.isArray(result)).toBe(true);
	});

	it("fails with LockfileReadError when lockfile missing", async () => {
		const layer = LockfileReaderLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(WorkspaceRoot, {
						find: () => Effect.succeed("/project"),
					}),
					Layer.succeed(PackageManagerDetector, {
						detect: () =>
							Effect.succeed({
								type: "pnpm" as const,
								version: undefined,
								runtime: "node" as const,
							}),
					}),
					FileSystem.layerNoop({
						readFileString: (filePath: string) => Effect.fail(notFound(filePath)),
					}),
					Path.layer,
				),
			),
		);

		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				return yield* reader.readLockfile();
			}).pipe(Effect.provide(layer)),
		);

		expect(Exit.isFailure(exit)).toBe(true);
	});

	describe("request caching", () => {
		it("caches resolvedVersion requests within the same scope", async () => {
			const layer = testLayer("pnpm", PNPM_FIXTURE);

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					const first = yield* reader.resolvedVersion("lodash");
					const second = yield* reader.resolvedVersion("lodash");
					return { first, second };
				}).pipe(Effect.provide(layer)),
			);

			// Reference equality proves caching — without caching,
			// each call creates a new Option.fromNullable(...)
			expect(result.first).toBe(result.second);
			expect(Option.isSome(result.first)).toBe(true);
			if (Option.isSome(result.first)) {
				expect(result.first.value.version).toBe("4.17.21");
			}
		});
	});

	describe("laziness", () => {
		it("does no I/O at layer construction", async () => {
			let findRuns = 0;
			let detectRuns = 0;
			let readRuns = 0;

			const layer = LockfileReaderLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(WorkspaceRoot, {
							find: () =>
								Effect.sync(() => {
									findRuns++;
									return "/project";
								}),
						}),
						Layer.succeed(PackageManagerDetector, {
							detect: () =>
								Effect.sync(() => {
									detectRuns++;
									return { type: "pnpm" as const, version: undefined, runtime: "node" as const };
								}),
						}),
						FileSystem.layerNoop({
							readFileString: (filePath: string) =>
								Effect.suspend(() => {
									readRuns++;
									if (filePath.endsWith("pnpm-lock.yaml")) return Effect.succeed(PNPM_FIXTURE);
									return Effect.fail(notFound(filePath));
								}),
						}),
						Path.layer,
						Logger.replace(Logger.defaultLogger, Logger.none),
					),
				),
			);

			// Acquire the service from the layer without invoking any of its methods.
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* LockfileReader;
				}).pipe(Effect.provide(layer)),
			);

			expect(findRuns).toBe(0);
			expect(detectRuns).toBe(0);
			expect(readRuns).toBe(0);
		});

		it("memoizes initialization across multiple method calls", async () => {
			let findRuns = 0;
			let detectRuns = 0;

			const layer = LockfileReaderLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(WorkspaceRoot, {
							find: () =>
								Effect.sync(() => {
									findRuns++;
									return "/project";
								}),
						}),
						Layer.succeed(PackageManagerDetector, {
							detect: () =>
								Effect.sync(() => {
									detectRuns++;
									return { type: "pnpm" as const, version: undefined, runtime: "node" as const };
								}),
						}),
						FileSystem.layerNoop({
							readFileString: (filePath: string) => {
								if (filePath.endsWith("pnpm-lock.yaml")) return Effect.succeed(PNPM_FIXTURE);
								return Effect.fail(notFound(filePath));
							},
						}),
						Path.layer,
						Logger.replace(Logger.defaultLogger, Logger.none),
					),
				),
			);

			await Effect.runPromise(
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					yield* reader.readLockfile();
					yield* reader.readLockfile();
					yield* reader.workspaceDependencies();
					yield* reader.resolvedVersion("lodash");
				}).pipe(Effect.provide(layer)),
			);

			// Initialization runs exactly once; subsequent method calls hit the cache.
			expect(findRuns).toBe(1);
			expect(detectRuns).toBe(1);
		});
	});
});
