/**
 * Live implementation of PackageManagerDetector service.
 *
 * Detection priority (first match wins):
 * 1. pnpm - pnpm-workspace.yaml exists
 * 2. bun - bun.lock exists AND packageManager starts with "bun\@"
 * 3. yarn - yarn.lock exists AND packageManager starts with "yarn\@"
 * 4. npm - fallback if package.json has workspaces field
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { PackageManagerDetectionError } from "../errors/index.js";
import type { PackageManagerType } from "../schemas/core.js";
import type { DetectedPackageManager } from "../services/PackageManagerDetector.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";

/**
 * Parse the packageManager field from package.json (e.g., "pnpm\@10.32.1").
 * Returns the PM name and version, or undefined if not present/parseable.
 */
const parsePackageManagerField = (raw: string | undefined): { name: string; version: string } | undefined => {
	if (!raw) return undefined;
	const atIdx = raw.indexOf("@");
	if (atIdx <= 0) return undefined;
	const name = raw.slice(0, atIdx);
	// Strip hash suffixes like "+sha512-..."
	const versionPart = raw.slice(atIdx + 1);
	const plusIdx = versionPart.indexOf("+");
	const version = plusIdx >= 0 ? versionPart.slice(0, plusIdx) : versionPart;
	return { name, version };
};

/**
 * Read the packageManager field from the root package.json.
 */
const readPackageManagerField = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
): Effect.Effect<string | undefined> =>
	Effect.gen(function* () {
		const pkgJsonPath = path.join(root, "package.json");
		const exists = yield* fs.exists(pkgJsonPath);
		if (!exists) return undefined;

		const content = yield* fs.readFileString(pkgJsonPath);
		const parsed = JSON.parse(content) as Record<string, unknown>;
		const field = parsed.packageManager;
		return typeof field === "string" ? field : undefined;
	}).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Check if a file exists at the given path.
 */
const fileExists = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	filename: string,
): Effect.Effect<boolean> => fs.exists(path.join(root, filename)).pipe(Effect.orElseSucceed(() => false));

/**
 * Detect the package manager for the given workspace root.
 */
const detectPackageManager = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
): Effect.Effect<DetectedPackageManager, PackageManagerDetectionError> =>
	Effect.gen(function* () {
		const pmField = yield* readPackageManagerField(fs, path, root);
		const pmInfo = parsePackageManagerField(pmField);

		// 1. pnpm: pnpm-workspace.yaml exists
		const hasPnpmWorkspace = yield* fileExists(fs, path, root, "pnpm-workspace.yaml");
		if (hasPnpmWorkspace) {
			const result = {
				type: "pnpm" as PackageManagerType,
				version: pmInfo?.name === "pnpm" ? pmInfo.version : undefined,
			};
			yield* Effect.logInfo("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 2. bun: bun.lock exists AND packageManager starts with "bun@"
		const hasBunLock = yield* fileExists(fs, path, root, "bun.lock");
		const hasBunLockb = yield* fileExists(fs, path, root, "bun.lockb");
		if ((hasBunLock || hasBunLockb) && pmInfo?.name === "bun") {
			const result = {
				type: "bun" as PackageManagerType,
				version: pmInfo.version,
			};
			yield* Effect.logInfo("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 3. yarn: yarn.lock exists AND packageManager starts with "yarn@"
		const hasYarnLock = yield* fileExists(fs, path, root, "yarn.lock");
		if (hasYarnLock && pmInfo?.name === "yarn") {
			const result = {
				type: "yarn" as PackageManagerType,
				version: pmInfo.version,
			};
			yield* Effect.logInfo("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 4. npm: fallback if package.json has workspaces field
		const pkgJsonPath = path.join(root, "package.json");
		const pkgExists = yield* fs.exists(pkgJsonPath).pipe(Effect.orElseSucceed(() => false));
		if (pkgExists) {
			const content = yield* fs.readFileString(pkgJsonPath).pipe(Effect.orElseSucceed(() => "{}"));
			const parsed = JSON.parse(content) as Record<string, unknown>;
			if ("workspaces" in parsed && parsed.workspaces != null) {
				const result = {
					type: "npm" as PackageManagerType,
					version: pmInfo?.name === "npm" ? pmInfo.version : undefined,
				};
				yield* Effect.logInfo("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
				return result;
			}
		}

		return yield* Effect.fail(
			new PackageManagerDetectionError({
				searchPath: root,
				reason: "no lockfile or workspace configuration found",
			}),
		);
	}).pipe(
		Effect.withSpan("PackageManagerDetector.detect", {
			attributes: { "workspace.root": root },
		}),
	);

/** Live layer for PackageManagerDetector using Effect platform FileSystem and Path. */
export const PackageManagerDetectorLive: Layer.Layer<PackageManagerDetector, never, FileSystem.FileSystem | Path.Path> =
	Layer.effect(
		PackageManagerDetector,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			return {
				detect: (root: string) => detectPackageManager(fs, path, root),
			};
		}),
	);
