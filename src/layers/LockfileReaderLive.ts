import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
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

		const root = yield* rootService.find(globalThis.process?.cwd() ?? "/");
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

		return {
			readLockfile: () => Effect.succeed(lockfileData),

			resolvedVersion: (packageName: string) => Effect.succeed(Option.fromNullable(packageIndex.get(packageName)?.[0])),

			workspaceDependencies: () => Effect.succeed(lockfileData.workspaceDependencies),

			checkIntegrity: () => checkLockfileIntegrity(lockfileData, root, fs, path),
		};
	}),
);
