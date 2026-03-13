import { FileSystem, Path, Error as PlatformError } from "@effect/platform";
import { Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { LockfileReader } from "../services/LockfileReader.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";

// Inline fixture (shortened for test focus)
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
			),
		),
	);

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
});
