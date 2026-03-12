/**
 * Live implementation of WorkspaceDiscovery service.
 *
 * Reads workspace patterns from PM-specific config, resolves them
 * to directories, and reads package.json for each workspace package.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { PackageNotFoundError, WorkspaceDiscoveryError } from "../errors/index.js";
import { PackageJsonSchema, WorkspacePackage } from "../schemas/core.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";

/**
 * Read workspace patterns from pnpm-workspace.yaml or package.json.
 */
const readWorkspacePatterns = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
): Effect.Effect<ReadonlyArray<string>, WorkspaceDiscoveryError> =>
	Effect.gen(function* () {
		// Try pnpm-workspace.yaml first
		const pnpmConfigPath = path.join(root, "pnpm-workspace.yaml");
		const hasPnpmConfig = yield* fs.exists(pnpmConfigPath).pipe(Effect.orElseSucceed(() => false));

		if (hasPnpmConfig) {
			const content = yield* fs.readFileString(pnpmConfigPath).pipe(Effect.orElseSucceed(() => ""));
			// Simple YAML parsing for packages field
			// pnpm-workspace.yaml typically looks like:
			//   packages:
			//     - "packages/*"
			//     - "apps/*"
			const patterns = parsePnpmWorkspacePatterns(content);
			if (patterns.length > 0) return patterns;
		}

		// Fall back to package.json workspaces field
		const pkgJsonPath = path.join(root, "package.json");
		const hasPkgJson = yield* fs.exists(pkgJsonPath).pipe(Effect.orElseSucceed(() => false));

		if (hasPkgJson) {
			const content = yield* fs.readFileString(pkgJsonPath).pipe(Effect.orElseSucceed(() => "{}"));
			const parsed = JSON.parse(content) as Record<string, unknown>;
			const workspaces = parsed.workspaces;

			if (Array.isArray(workspaces)) {
				return workspaces.filter((w): w is string => typeof w === "string");
			}
			if (workspaces != null && typeof workspaces === "object" && "packages" in workspaces) {
				const pkgs = (workspaces as { packages: unknown }).packages;
				if (Array.isArray(pkgs)) {
					return pkgs.filter((w): w is string => typeof w === "string");
				}
			}
		}

		return yield* Effect.fail(
			new WorkspaceDiscoveryError({
				root,
				reason: "no workspace patterns found in pnpm-workspace.yaml or package.json",
			}),
		);
	});

/**
 * Simple parser for pnpm-workspace.yaml packages field.
 * Handles the common format without a full YAML parser dependency.
 */
const parsePnpmWorkspacePatterns = (content: string): string[] => {
	const patterns: string[] = [];
	const lines = content.split("\n");
	let inPackages = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === "packages:" || trimmed === "packages :") {
			inPackages = true;
			continue;
		}

		if (inPackages) {
			// End of packages section if we hit another top-level key
			if (trimmed.length > 0 && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
				break;
			}

			if (trimmed.startsWith("-")) {
				// Extract the pattern, removing quotes
				let pattern = trimmed.slice(1).trim();
				// Remove surrounding quotes
				if ((pattern.startsWith('"') && pattern.endsWith('"')) || (pattern.startsWith("'") && pattern.endsWith("'"))) {
					pattern = pattern.slice(1, -1);
				}
				if (pattern.length > 0) {
					patterns.push(pattern);
				}
			}
		}
	}

	return patterns;
};

/**
 * Resolve workspace patterns to actual directory paths.
 * Handles simple wildcard patterns like "packages/*".
 * Negation patterns (starting with "!") are used to exclude matches.
 */
const resolvePatterns = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	patterns: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, WorkspaceDiscoveryError> =>
	Effect.gen(function* () {
		const included = new Set<string>();
		const excluded = new Set<string>();

		for (const pattern of patterns) {
			if (pattern.startsWith("!")) {
				// Negation pattern — resolve and add to exclusions
				const positivePattern = pattern.slice(1);
				const resolved = yield* resolvePattern(fs, path, root, positivePattern);
				for (const p of resolved) excluded.add(p);
			} else {
				const resolved = yield* resolvePattern(fs, path, root, pattern);
				for (const p of resolved) included.add(p);
			}
		}

		// Remove excluded paths
		for (const ex of excluded) included.delete(ex);

		return Array.from(included).sort();
	});

/**
 * Resolve a single workspace pattern to directory paths.
 * Supports: "packages/*", "apps/*", exact paths like "tools/cli".
 */
const resolvePattern = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	pattern: string,
): Effect.Effect<ReadonlyArray<string>, WorkspaceDiscoveryError> =>
	Effect.gen(function* () {
		// Handle "packages/*" style patterns
		if (pattern.endsWith("/*") || pattern.endsWith("/**")) {
			const baseDir = pattern.replace(/\/\*+$/, "");
			const fullBase = path.join(root, baseDir);

			const exists = yield* fs.exists(fullBase).pipe(Effect.orElseSucceed(() => false));
			if (!exists) return [];

			const entries = yield* fs.readDirectory(fullBase).pipe(Effect.orElseSucceed(() => [] as string[]));

			// Filter to directories that contain a package.json
			const results: string[] = [];
			for (const entry of entries) {
				const entryPath = path.join(fullBase, entry);
				const hasPkgJson = yield* fs
					.exists(path.join(entryPath, "package.json"))
					.pipe(Effect.orElseSucceed(() => false));
				if (hasPkgJson) {
					results.push(entryPath);
				}
			}
			return results;
		}

		// Exact path — check if it has a package.json
		const fullPath = path.join(root, pattern);
		const hasPkgJson = yield* fs.exists(path.join(fullPath, "package.json")).pipe(Effect.orElseSucceed(() => false));
		if (hasPkgJson) {
			return [fullPath];
		}
		return [];
	});

/**
 * Read a package.json and construct a WorkspacePackage.
 */
const readWorkspacePackage = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	pkgDir: string,
): Effect.Effect<WorkspacePackage, WorkspaceDiscoveryError> =>
	Effect.gen(function* () {
		const pkgJsonPath = path.join(pkgDir, "package.json");
		const content = yield* fs.readFileString(pkgJsonPath).pipe(
			Effect.mapError(
				() =>
					new WorkspaceDiscoveryError({
						root,
						reason: `failed to read ${pkgJsonPath}`,
					}),
			),
		);

		const raw = JSON.parse(content) as Record<string, unknown>;
		const decoded = yield* Schema.decodeUnknown(PackageJsonSchema)(raw).pipe(
			Effect.mapError(
				() =>
					new WorkspaceDiscoveryError({
						root,
						reason: `failed to parse package.json at ${pkgJsonPath}`,
					}),
			),
		);

		const name = decoded.name;
		if (!name) {
			return yield* Effect.fail(
				new WorkspaceDiscoveryError({
					root,
					reason: `package.json at ${pkgJsonPath} has no name field`,
				}),
			);
		}

		// Compute relative path from root
		const relativePath = path.relative(root, pkgDir);

		return new WorkspacePackage({
			name,
			version: decoded.version ?? "0.0.0",
			path: pkgDir,
			relativePath,
			private: decoded.private ?? false,
			dependencies: (decoded.dependencies as Record<string, string>) ?? {},
			devDependencies: (decoded.devDependencies as Record<string, string>) ?? {},
		});
	});

/**
 * Live layer for WorkspaceDiscovery.
 * Depends on WorkspaceRoot, FileSystem, and Path.
 */
export const WorkspaceDiscoveryLive: Layer.Layer<
	WorkspaceDiscovery,
	never,
	WorkspaceRoot | FileSystem.FileSystem | Path.Path
> = Layer.effect(
	WorkspaceDiscovery,
	Effect.gen(function* () {
		const rootService = yield* WorkspaceRoot;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		// Cache for discovered packages
		let cachedPackages: ReadonlyArray<WorkspacePackage> | undefined;

		const discoverPackages = (): Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError> =>
			Effect.gen(function* () {
				if (cachedPackages) return cachedPackages;

				const root = yield* rootService.find(process.cwd()).pipe(
					Effect.mapError(
						(e) =>
							new WorkspaceDiscoveryError({
								root: e.searchPath,
								reason: `workspace root not found: ${e.reason}`,
							}),
					),
				);

				const patterns = yield* readWorkspacePatterns(fs, path, root);
				const dirs = yield* resolvePatterns(fs, path, root, patterns);

				const packages = yield* Effect.forEach(dirs, (dir) => readWorkspacePackage(fs, path, root, dir), {
					concurrency: 10,
				});

				cachedPackages = packages;
				return packages;
			}).pipe(Effect.withSpan("WorkspaceDiscovery.listPackages"));

		return {
			listPackages: discoverPackages,

			getPackage: (name: string) =>
				Effect.gen(function* () {
					const packages = yield* discoverPackages().pipe(
						Effect.catchTag("WorkspaceDiscoveryError", () => Effect.succeed([] as ReadonlyArray<WorkspacePackage>)),
					);
					const found = packages.find((p) => p.name === name);
					if (found) return found;
					return yield* Effect.fail(
						new PackageNotFoundError({
							name,
							available: packages.map((p) => p.name),
						}),
					);
				}).pipe(
					Effect.withSpan("WorkspaceDiscovery.getPackage", {
						attributes: { "package.name": name },
					}),
				),
		};
	}),
);
