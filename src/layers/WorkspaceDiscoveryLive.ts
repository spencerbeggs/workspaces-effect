/**
 * Live implementation of the {@link WorkspaceDiscovery} service.
 *
 * Reads workspace patterns from PM-specific config, resolves them
 * to directories, and reads `package.json` for each workspace package.
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { PackageNotFoundError } from "../errors/PackageNotFoundError.js";
import { WorkspaceDiscoveryError } from "../errors/WorkspaceDiscoveryError.js";
import { PackageJsonSchema, WorkspacePackage } from "../schemas/core.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";

/**
 * Read workspace patterns from `pnpm-workspace.yaml` or `package.json`.
 *
 * @internal
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
			const parsed = yield* Effect.try({
				try: () => JSON.parse(content) as Record<string, unknown>,
				catch: () => new WorkspaceDiscoveryError({ root, reason: "invalid JSON in root package.json" }),
			});
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

		// No workspace config found — standalone package
		return [];
	});

/**
 * Simple parser for `pnpm-workspace.yaml` `packages` field.
 * Handles the common format without a full YAML parser dependency.
 *
 * @privateRemarks
 * Uses line-by-line parsing to avoid pulling in a YAML library for
 * a well-known, simple format. Supports quoted and unquoted list items.
 *
 * @internal
 */
const parsePnpmWorkspacePatterns = (content: string): string[] => {
	const patterns: string[] = [];
	const lines = content.replace(/\r\n/g, "\n").split("\n");
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
 * Handles simple wildcard patterns like `"packages/*"`.
 * Negation patterns (starting with `"!"`) are used to exclude matches.
 *
 * @internal
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
 * Supports: `"packages/*"`, `"apps/*"`, exact paths like `"tools/cli"`.
 *
 * @internal
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
			if (!exists) {
				return yield* Effect.fail(
					new WorkspaceDiscoveryError({
						root,
						reason: `workspace pattern "${pattern}" references non-existent directory "${baseDir}"`,
					}),
				);
			}

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
 * Read a `package.json` and construct a {@link WorkspacePackage}.
 *
 * @internal
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

		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as Record<string, unknown>,
			catch: () =>
				new WorkspaceDiscoveryError({
					root,
					reason: `invalid JSON in ${pkgJsonPath}`,
				}),
		});
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

		const version = decoded.version;
		if (!version) {
			return yield* Effect.fail(
				new WorkspaceDiscoveryError({
					root,
					reason: `package.json at ${pkgJsonPath} has no version field`,
				}),
			);
		}

		// Compute relative path from root
		const relativePath = path.relative(root, pkgDir);

		return new WorkspacePackage({
			name,
			version,
			path: pkgDir,
			packageJsonPath: pkgJsonPath,
			relativePath,
			private: decoded.private ?? false,
			dependencies: (decoded.dependencies as Record<string, string>) ?? {},
			devDependencies: (decoded.devDependencies as Record<string, string>) ?? {},
			peerDependencies: (decoded.peerDependencies as Record<string, string>) ?? {},
			optionalDependencies: (decoded.optionalDependencies as Record<string, string>) ?? {},
			publishConfig: decoded.publishConfig,
		});
	});

/**
 * Live layer for the {@link WorkspaceDiscovery} service.
 *
 * Discovers all workspace packages by reading PM-specific configuration,
 * resolving glob patterns to directories, and parsing each `package.json`.
 *
 * @remarks
 * Requires {@link WorkspaceRoot}, `FileSystem`, and `Path`. Layer construction
 * is O(1); the default workspace root (resolved from `process.cwd()`) is looked
 * up lazily on the first method call and cached for the lifetime of the layer.
 * Discovery method calls accept an optional `cwd` parameter to resolve a
 * different root for that single call; results are cached per resolved root
 * path for the lifetime of the layer.
 *
 * @privateRemarks
 * The default-root lookup is wrapped in `Effect.cached` so layer construction
 * is free and consumers that build the layer but never call a method pay
 * nothing. Per-call `cwd` arguments are resolved on demand via
 * `WorkspaceRoot.find` and memoized in a `Map` keyed by the absolute
 * resolved root path.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { WorkspaceDiscovery, WorkspaceDiscoveryLive, WorkspaceRootLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   return yield* discovery.listPackages();
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspaceDiscoveryLive),
 *     Effect.provide(WorkspaceRootLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
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

		// Lazily resolve the default root on first use. `Effect.cached` memoizes
		// success and failure for the lifetime of the layer, so consumers that
		// only invoke methods with an explicit `cwd` never pay the default-root
		// fs walk, and those that omit `cwd` pay it exactly once.
		const resolveDefaultRoot = yield* Effect.cached(
			rootService.find(process.cwd()).pipe(
				Effect.mapError(
					(e) =>
						new WorkspaceDiscoveryError({
							root: e.searchPath,
							reason: `workspace root not found: ${e.reason}`,
						}),
				),
			),
		);

		// Per-root cache of discovered packages keyed by absolute resolved root.
		const cache = new Map<string, ReadonlyArray<WorkspacePackage>>();

		const resolveRoot = (cwd: string | undefined): Effect.Effect<string, WorkspaceDiscoveryError> =>
			cwd === undefined
				? resolveDefaultRoot
				: rootService.find(cwd).pipe(
						Effect.mapError(
							(e) =>
								new WorkspaceDiscoveryError({
									root: e.searchPath,
									reason: `workspace root not found: ${e.reason}`,
								}),
						),
					);

		const discoverAtRoot = (root: string): Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError> =>
			Effect.gen(function* () {
				const cached = cache.get(root);
				if (cached) return cached;

				const patterns = yield* readWorkspacePatterns(fs, path, root);
				const dirs = yield* resolvePatterns(fs, path, root, patterns);

				const workspacePackages = yield* Effect.forEach(dirs, (dir) => readWorkspacePackage(fs, path, root, dir), {
					concurrency: 10,
				});

				// Filter out any workspace package that resolves to root (avoids
				// duplication when patterns include ".")
				const nonRootPackages = workspacePackages.filter((p) => p.relativePath !== "." && p.path !== root);

				// Read root package.json and prepend as first entry
				const rootPkgJsonPath = path.join(root, "package.json");
				const rootContent = yield* fs.readFileString(rootPkgJsonPath).pipe(
					Effect.mapError(
						() =>
							new WorkspaceDiscoveryError({
								root,
								reason: `failed to read root ${rootPkgJsonPath}`,
							}),
					),
				);
				const rootRaw = yield* Effect.try({
					try: () => JSON.parse(rootContent) as Record<string, unknown>,
					catch: () =>
						new WorkspaceDiscoveryError({
							root,
							reason: `invalid JSON in root ${rootPkgJsonPath}`,
						}),
				});
				const rootDecoded = yield* Schema.decodeUnknown(PackageJsonSchema)(rootRaw).pipe(
					Effect.mapError(
						() =>
							new WorkspaceDiscoveryError({
								root,
								reason: `failed to parse root ${rootPkgJsonPath}`,
							}),
					),
				);

				if (!rootDecoded.name) {
					return yield* Effect.fail(
						new WorkspaceDiscoveryError({
							root,
							reason: `root package.json at ${rootPkgJsonPath} has no name field`,
						}),
					);
				}
				if (!rootDecoded.version) {
					return yield* Effect.fail(
						new WorkspaceDiscoveryError({
							root,
							reason: `root package.json at ${rootPkgJsonPath} has no version field`,
						}),
					);
				}

				const rootPkg = new WorkspacePackage({
					name: rootDecoded.name,
					version: rootDecoded.version,
					path: root,
					packageJsonPath: rootPkgJsonPath,
					relativePath: ".",
					private: rootDecoded.private ?? false,
					dependencies: (rootDecoded.dependencies as Record<string, string>) ?? {},
					devDependencies: (rootDecoded.devDependencies as Record<string, string>) ?? {},
					peerDependencies: (rootDecoded.peerDependencies as Record<string, string>) ?? {},
					optionalDependencies: (rootDecoded.optionalDependencies as Record<string, string>) ?? {},
					publishConfig: rootDecoded.publishConfig,
				});

				const packages = [rootPkg, ...nonRootPackages];

				cache.set(root, packages);
				yield* Effect.logDebug("Workspace packages discovered").pipe(
					Effect.annotateLogs({
						"workspace.root": root,
						"workspace.packages.count": packages.length,
					}),
				);
				return packages;
			});

		const discoverPackages = (cwd?: string): Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryError> =>
			Effect.gen(function* () {
				const root = yield* resolveRoot(cwd);
				return yield* discoverAtRoot(root);
			}).pipe(Effect.withSpan("WorkspaceDiscovery.listPackages"));

		return {
			listPackages: discoverPackages,

			importerMap: (cwd?: string) =>
				Effect.gen(function* () {
					const packages = yield* discoverPackages(cwd);
					return new Map(packages.map((p) => [p.relativePath, p])) as ReadonlyMap<string, WorkspacePackage>;
				}).pipe(Effect.withSpan("WorkspaceDiscovery.importerMap")),

			getPackage: (name: string, cwd?: string) =>
				Effect.gen(function* () {
					const packages = yield* discoverPackages(cwd);
					const found = packages.find((p) => p.name === name);
					if (found) {
						yield* Effect.logDebug("Package resolved").pipe(Effect.annotateLogs("workspace.package", name));
						return found;
					}
					return yield* Effect.fail(
						new PackageNotFoundError({
							name,
							available: packages.map((p) => p.name),
						}),
					);
				}).pipe(
					Effect.withSpan("WorkspaceDiscovery.getPackage", {
						attributes: { "workspace.package": name },
					}),
				),
		};
	}),
);
