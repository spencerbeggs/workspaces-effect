import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Option, Request, RequestResolver } from "effect";
import type { LockfileParseError } from "../errors/index.js";
import { LockfileReadError } from "../errors/index.js";
import type { PackageManagerType } from "../schemas/core.js";
import type { ResolvedPackage } from "../schemas/lockfile.js";
import { LockfileReader } from "../services/LockfileReader.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { checkLockfileIntegrity } from "./integrity.js";
import { parseBunLockfile } from "./parsers/bun.js";
import { parseNpmLockfile } from "./parsers/npm.js";
import { parsePnpmLockfile } from "./parsers/pnpm.js";
import { parseYarnLockfile } from "./parsers/yarn.js";

const lockfileNameFor = (pm: PackageManagerType): string => {
	switch (pm) {
		case "pnpm":
			return "pnpm-lock.yaml";
		case "npm":
			return "package-lock.json";
		case "yarn":
			return "yarn.lock";
		case "bun":
			return "bun.lock";
	}
};

const parseLockfile = (content: string, lockfilePath: string, pm: PackageManagerType) => {
	switch (pm) {
		case "pnpm":
			return parsePnpmLockfile(content, lockfilePath);
		case "npm":
			return parseNpmLockfile(content, lockfilePath);
		case "yarn":
			return parseYarnLockfile(content, lockfilePath);
		case "bun":
			return parseBunLockfile(content, lockfilePath);
	}
};

/** @internal Request for resolvedVersion lookups. */
class ResolvedVersionRequest extends Request.TaggedClass("ResolvedVersionRequest")<
	Option.Option<ResolvedPackage>,
	never,
	{ readonly packageName: string }
> {}

// Exported type for consumers who want to annotate explicitly.
// The inferred error union includes WorkspaceRootNotFoundError and
// PackageManagerDetectionError because find() and detect() can fail.
export type LockfileReaderLiveLayer = Layer.Layer<
	LockfileReader,
	LockfileReadError | LockfileParseError,
	WorkspaceRoot | PackageManagerDetector | FileSystem.FileSystem | Path.Path
>;

export const LockfileReaderLive = Layer.effect(
	LockfileReader,
	Effect.gen(function* () {
		const rootService = yield* WorkspaceRoot;
		const detector = yield* PackageManagerDetector;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const root = yield* rootService.find(process.cwd());
		const { type: pm } = yield* detector.detect(root);

		const lockfilePath = path.join(root, lockfileNameFor(pm));

		const content = yield* fs.readFileString(lockfilePath).pipe(
			Effect.mapError(
				() =>
					new LockfileReadError({
						lockfilePath,
						reason: "file not found or unreadable",
					}),
			),
		);

		const lockfileData = yield* parseLockfile(content, lockfilePath, pm);

		// Build multi-version lookup index
		const packageIndex = new Map<string, Array<ResolvedPackage>>();
		for (const pkg of lockfileData.packages) {
			const existing = packageIndex.get(pkg.name) ?? [];
			existing.push(pkg);
			packageIndex.set(pkg.name, existing);
		}

		yield* Effect.logInfo("Lockfile reader initialized").pipe(
			Effect.annotateLogs({
				"workspace.pm": pm,
				"workspace.packages.count": lockfileData.packages.length,
			}),
		);

		// Per-layer cache for request deduplication (same pattern as DependencyGraphLive).
		const cache = yield* Request.makeCache({ capacity: 1024, timeToLive: "1 minute" });

		const ResolvedVersionResolver = RequestResolver.fromEffect((req: ResolvedVersionRequest) =>
			Effect.succeed(Option.fromNullable(packageIndex.get(req.packageName)?.[0])),
		);

		return {
			readLockfile: () => Effect.succeed(lockfileData),

			resolvedVersion: (packageName: string) =>
				Effect.request(new ResolvedVersionRequest({ packageName }), ResolvedVersionResolver).pipe(
					Effect.withRequestCache(cache),
					Effect.withRequestCaching(true),
					Effect.tap((result) =>
						Effect.logDebug("Resolved version lookup").pipe(
							Effect.annotateLogs({
								"workspace.package": packageName,
								"workspace.found": Option.isSome(result),
							}),
						),
					),
					Effect.withSpan("LockfileReader.resolvedVersion", {
						attributes: { "workspace.package": packageName },
					}),
				),

			workspaceDependencies: () => Effect.succeed(lockfileData.workspaceDependencies),

			checkIntegrity: () =>
				Effect.gen(function* () {
					const result = yield* checkLockfileIntegrity(lockfileData, root, fs, path);
					yield* Effect.logInfo("Lockfile integrity check complete").pipe(
						Effect.annotateLogs({
							"workspace.integrity.valid": result.valid,
							"workspace.integrity.issues":
								result.missingWorkspaces.length + result.extraWorkspaces.length + result.unsatisfiedConstraints.length,
						}),
					);
					return result;
				}).pipe(Effect.withSpan("LockfileReader.checkIntegrity")),
		};
	}).pipe(Effect.withSpan("LockfileReader.construct")),
);
