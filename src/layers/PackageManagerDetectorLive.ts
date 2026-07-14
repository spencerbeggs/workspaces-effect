/**
 * Live implementation of the {@link PackageManagerDetector} service.
 *
 * Detection priority (first match wins):
 * 0. devEngines.packageManager -- declared in the root `package.json`
 * 1. pnpm -- `pnpm-workspace.yaml` exists
 * 2. bun -- `bun.lock` exists AND `packageManager` starts with `"bun@"`
 * 3. yarn -- `yarn.lock` exists AND `packageManager` starts with `"yarn@"`
 * 4. npm -- fallback if `package.json` has `"workspaces"` field
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { PackageManagerDetectionError } from "../errors/PackageManagerDetectionError.js";
import type { PackageManagerType } from "../schemas/core.js";
import type { DetectedPackageManager } from "../services/PackageManagerDetector.js";
import { PackageManagerDetector } from "../services/PackageManagerDetector.js";

/**
 * Parse the `packageManager` field from `package.json` (e.g., `"pnpm@10.32.1"`).
 * Returns the PM name and version, or `undefined` if not present or parseable.
 *
 * @internal
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
 * Read the `packageManager` field from the root `package.json`.
 *
 * @internal
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
		const parsed = yield* Effect.try({
			try: () => JSON.parse(content) as Record<string, unknown>,
			catch: (error) => new Error(`invalid json: ${String(error)}`),
		});
		const field = parsed.packageManager;
		return typeof field === "string" ? field : undefined;
	}).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Read `devEngines.packageManager` from the root `package.json`.
 *
 * The npm spec allows a single object or an array of them; we take the first
 * entry. Any read/parse failure is `undefined` — this is a hint, not a contract.
 *
 * @internal
 */
const readDevEnginesPackageManager = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
): Effect.Effect<{ name: string; version: string | undefined } | undefined> =>
	Effect.gen(function* () {
		const pkgJsonPath = path.join(root, "package.json");
		if (!(yield* fs.exists(pkgJsonPath))) return undefined;
		const content = yield* fs.readFileString(pkgJsonPath);
		const parsed = yield* Effect.try({
			try: () =>
				JSON.parse(content) as {
					devEngines?: { packageManager?: unknown };
				},
			catch: (error) => new Error(`invalid json: ${String(error)}`),
		});
		const raw = parsed.devEngines?.packageManager;
		const entry = Array.isArray(raw) ? raw[0] : raw;
		if (typeof entry !== "object" || entry === null) return undefined;
		const { name, version } = entry as { name?: unknown; version?: unknown };
		if (typeof name !== "string" || name === "") return undefined;
		return { name, version: typeof version === "string" ? version : undefined };
	}).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Narrow a free-form package manager name to a known one.
 *
 * @internal
 */
const asPackageManagerType = (name: string): PackageManagerType | undefined =>
	name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : undefined;

/**
 * Check if a file exists at the given path.
 *
 * @internal
 */
const fileExists = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	filename: string,
): Effect.Effect<boolean> => fs.exists(path.join(root, filename)).pipe(Effect.orElseSucceed(() => false));

/**
 * Detect the package manager for the given workspace root.
 *
 * @privateRemarks
 * Follows a strict priority chain: devEngines \> pnpm \> bun \> yarn \> npm.
 * Each check combines lockfile presence with `packageManager` field validation.
 *
 * @internal
 */
const detectPackageManager = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
): Effect.Effect<DetectedPackageManager, PackageManagerDetectionError> =>
	Effect.gen(function* () {
		const pmField = yield* readPackageManagerField(fs, path, root);
		const pmInfo = parsePackageManagerField(pmField);

		// 0. devEngines.packageManager — the declarative, intentional signal. It
		//    outranks file presence: a repo may carry a stale pnpm-workspace.yaml
		//    while devEngines says bun, and devEngines is what the human meant.
		const devEngines = yield* readDevEnginesPackageManager(fs, path, root);
		const declared = devEngines ? asPackageManagerType(devEngines.name) : undefined;
		if (declared) {
			// The packageManager field is an exact pin; devEngines may hold a range.
			// Prefer the pin when both name the same PM.
			const version = pmInfo?.name === declared ? pmInfo.version : devEngines?.version;
			const detected: DetectedPackageManager = {
				type: declared,
				version,
				runtime: declared === "bun" ? "bun" : "node",
			};
			yield* Effect.logDebug("Package manager detected").pipe(
				Effect.annotateLogs("workspace.pm", declared),
				Effect.annotateLogs("workspace.pm.source", "devEngines"),
			);
			return detected;
		}

		// 1. pnpm: pnpm-workspace.yaml exists
		const hasPnpmWorkspace = yield* fileExists(fs, path, root, "pnpm-workspace.yaml");
		if (hasPnpmWorkspace) {
			const result = {
				type: "pnpm" as PackageManagerType,
				version: pmInfo?.name === "pnpm" ? pmInfo.version : undefined,
				runtime: "node" as const,
			};
			yield* Effect.logDebug("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 2. bun: bun.lock exists AND packageManager starts with "bun@"
		const hasBunLock = yield* fileExists(fs, path, root, "bun.lock");
		const hasBunLockb = yield* fileExists(fs, path, root, "bun.lockb");
		if ((hasBunLock || hasBunLockb) && pmInfo?.name === "bun") {
			const result = {
				type: "bun" as PackageManagerType,
				version: pmInfo.version,
				runtime: "bun" as const,
			};
			yield* Effect.logDebug("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 3. yarn: yarn.lock exists AND packageManager starts with "yarn@"
		const hasYarnLock = yield* fileExists(fs, path, root, "yarn.lock");
		if (hasYarnLock && pmInfo?.name === "yarn") {
			const result = {
				type: "yarn" as PackageManagerType,
				version: pmInfo.version,
				runtime: "node" as const,
			};
			yield* Effect.logDebug("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
			return result;
		}

		// 4. npm: fallback if package.json has workspaces field
		const pkgJsonPath = path.join(root, "package.json");
		const pkgExists = yield* fs.exists(pkgJsonPath).pipe(Effect.orElseSucceed(() => false));
		if (pkgExists) {
			const content = yield* fs.readFileString(pkgJsonPath).pipe(Effect.orElseSucceed(() => "{}"));
			const parsed = yield* Effect.try({
				try: () => JSON.parse(content) as Record<string, unknown>,
				catch: (error) => new Error(`invalid json: ${String(error)}`),
			}).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));
			if ("workspaces" in parsed && parsed.workspaces != null) {
				const result = {
					type: "npm" as PackageManagerType,
					version: pmInfo?.name === "npm" ? pmInfo.version : undefined,
					runtime: "node" as const,
				};
				yield* Effect.logDebug("Package manager detected").pipe(Effect.annotateLogs("workspace.pm", result.type));
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

/**
 * Live layer for the {@link PackageManagerDetector} service.
 *
 * Detects which package manager (pnpm, npm, yarn, or bun) manages
 * a given workspace root by inspecting lockfiles and the `packageManager`
 * field in `package.json`.
 *
 * @remarks
 * Requires `FileSystem` and `Path` from `@effect/platform`. Provide these
 * via `NodeContext.layer` (Node.js) or `BunContext.layer` (Bun).
 *
 * @privateRemarks
 * Resolves `FileSystem` and `Path` at construction time, then delegates
 * to {@link detectPackageManager} for each `detect()` call.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { PackageManagerDetector, PackageManagerDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* PackageManagerDetector;
 *   return yield* detector.detect("/path/to/monorepo");
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(PackageManagerDetectorLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
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
