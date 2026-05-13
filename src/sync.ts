/**
 * Synchronous workspace utilities for non-Effect contexts.
 *
 * Provides `findWorkspaceRootSync` and `getWorkspacePackagesSync` for
 * consumers that cannot use Effect pipelines (e.g., lint-staged handlers).
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PublishConfig, WorkspacePackage } from "./schemas/core.js";

/**
 * Find the workspace root by walking up from `cwd`.
 *
 * Resolution order at each level:
 *
 * 1. `pnpm-workspace.yaml` — return this directory.
 * 2. `package.json` with a `workspaces` field — return this directory.
 * 3. `.git` (project boundary) — stop ascent. If a `package.json` exists
 *    alongside `.git`, return that directory; otherwise throw, because a
 *    git project missing a root `package.json` is an error.
 *
 * If the walk reaches the filesystem root without seeing any workspace
 * marker or `.git`, returns `null` — `cwd` is not inside a project.
 *
 * @param cwd - Starting directory (defaults to `process.cwd()`)
 * @returns Absolute path to workspace root, or `null` when not inside any project
 * @throws If the provided path does not exist, or if a `.git` boundary is
 *   reached without a sibling `package.json`
 *
 * @public
 */
export const findWorkspaceRootSync = (cwd?: string): string | null => {
	const startDir = resolve(cwd ?? process.cwd());

	if (cwd !== undefined && !existsSync(startDir)) {
		throw new Error(`Directory does not exist: ${startDir}`);
	}

	let current = startDir;

	for (;;) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) {
			return current;
		}

		const pkgPath = join(current, "package.json");
		const hasPkg = existsSync(pkgPath);
		if (hasPkg) {
			try {
				const content = readFileSync(pkgPath, "utf-8");
				const parsed = JSON.parse(content) as Record<string, unknown>;
				if ("workspaces" in parsed && parsed.workspaces != null) {
					return current;
				}
			} catch {
				// Ignore read/parse errors, keep walking
			}
		}

		if (existsSync(join(current, ".git"))) {
			if (hasPkg) {
				return current;
			}
			throw new Error(
				`Found git project boundary at ${current} but no package.json — a project must have a root package.json`,
			);
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
};

/**
 * Parse pnpm-workspace.yaml packages field.
 *
 * @internal
 */
const parsePnpmPatterns = (content: string): string[] => {
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
			if (trimmed.length > 0 && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
				break;
			}
			if (trimmed.startsWith("-")) {
				let pattern = trimmed.slice(1).trim();
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
 * Read workspace patterns from pnpm-workspace.yaml or package.json.
 *
 * @internal
 */
const readPatterns = (root: string): string[] => {
	const pnpmPath = join(root, "pnpm-workspace.yaml");
	if (existsSync(pnpmPath)) {
		try {
			const content = readFileSync(pnpmPath, "utf-8");
			const patterns = parsePnpmPatterns(content);
			if (patterns.length > 0) return patterns;
		} catch {
			// Fall through
		}
	}

	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const content = readFileSync(pkgPath, "utf-8");
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
		} catch {
			// Fall through
		}
	}

	return [];
};

/**
 * Resolve a single pattern to directories containing package.json.
 *
 * @internal
 */
const resolvePattern = (root: string, pattern: string): string[] => {
	if (pattern.endsWith("/*") || pattern.endsWith("/**")) {
		const baseDir = pattern.replace(/\/\*+$/, "");
		const fullBase = join(root, baseDir);
		if (!existsSync(fullBase)) return [];

		try {
			const entries = readdirSync(fullBase);
			const results: string[] = [];
			for (const entry of entries) {
				const entryPath = join(fullBase, entry);
				if (existsSync(join(entryPath, "package.json"))) {
					results.push(entryPath);
				}
			}
			return results;
		} catch {
			return [];
		}
	}

	// Exact path
	const fullPath = join(root, pattern);
	if (existsSync(join(fullPath, "package.json"))) {
		return [fullPath];
	}
	return [];
};

const isStringRecord = (v: unknown): v is Record<string, string> =>
	v !== null && typeof v === "object" && !Array.isArray(v);

const buildPublishConfig = (raw: unknown): PublishConfig | undefined => {
	if (raw === null || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const access = r.access === "public" || r.access === "restricted" ? r.access : undefined;
	const registry = typeof r.registry === "string" ? r.registry : undefined;
	const directory = typeof r.directory === "string" ? r.directory : undefined;
	const tag = typeof r.tag === "string" ? r.tag : undefined;
	const linkDirectory = typeof r.linkDirectory === "boolean" ? r.linkDirectory : undefined;
	if (
		access === undefined &&
		registry === undefined &&
		directory === undefined &&
		tag === undefined &&
		linkDirectory === undefined
	) {
		return undefined;
	}
	return new PublishConfig({ access, registry, directory, tag, linkDirectory });
};

/**
 * Read a `package.json` and construct a {@link WorkspacePackage}, or return
 * `null` if the file is missing/unreadable, has no name, or has no version.
 *
 * @internal
 */
const readWorkspacePackageSync = (root: string, pkgDir: string): WorkspacePackage | null => {
	const pkgJsonPath = join(pkgDir, "package.json");
	let parsed: Record<string, unknown>;
	try {
		const content = readFileSync(pkgJsonPath, "utf-8");
		parsed = JSON.parse(content) as Record<string, unknown>;
	} catch {
		return null;
	}

	const name = typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : undefined;
	const version = typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : undefined;
	if (!name || !version) return null;

	const relativePath = pkgDir === root ? "." : relative(root, pkgDir);

	return new WorkspacePackage({
		name,
		version,
		path: pkgDir,
		packageJsonPath: pkgJsonPath,
		relativePath,
		private: parsed.private === true,
		dependencies: isStringRecord(parsed.dependencies) ? parsed.dependencies : {},
		devDependencies: isStringRecord(parsed.devDependencies) ? parsed.devDependencies : {},
		peerDependencies: isStringRecord(parsed.peerDependencies) ? parsed.peerDependencies : {},
		optionalDependencies: isStringRecord(parsed.optionalDependencies) ? parsed.optionalDependencies : {},
		publishConfig: buildPublishConfig(parsed.publishConfig),
	});
};

/**
 * List workspace packages synchronously.
 *
 * Reads workspace patterns from `pnpm-workspace.yaml` or `package.json`,
 * resolves them to directories, and parses each `package.json` into a
 * {@link WorkspacePackage}. The root package is always the first entry,
 * matching the behavior of the Effect-based `WorkspaceDiscovery.listPackages()`.
 *
 * @param root - Absolute path to the workspace root
 * @returns Array of workspace packages with root as first entry
 * @throws If the root directory does not exist, or if the root
 *   `package.json` is missing required `name` or `version` fields
 *
 * @public
 */
export const getWorkspacePackagesSync = (root: string): ReadonlyArray<WorkspacePackage> => {
	if (!existsSync(root)) {
		throw new Error(`Directory does not exist: ${root}`);
	}

	const rootPkg = readWorkspacePackageSync(root, root);
	if (rootPkg === null) {
		throw new Error(`Root package.json at ${join(root, "package.json")} is missing required name or version`);
	}

	const patterns = readPatterns(root);
	if (patterns.length === 0) {
		return [rootPkg];
	}

	const included = new Set<string>();
	const excluded = new Set<string>();

	for (const pattern of patterns) {
		if (pattern.startsWith("!")) {
			for (const p of resolvePattern(root, pattern.slice(1))) excluded.add(p);
		} else {
			for (const p of resolvePattern(root, pattern)) included.add(p);
		}
	}

	for (const ex of excluded) included.delete(ex);

	// Filter out any workspace that resolves to root (dedup when patterns include ".")
	const resolvedRoot = resolve(root);
	const nonRootDirs = Array.from(included)
		.filter((dir) => resolve(dir) !== resolvedRoot)
		.sort();

	const packages: WorkspacePackage[] = [rootPkg];
	for (const dir of nonRootDirs) {
		const pkg = readWorkspacePackageSync(root, dir);
		if (pkg !== null) packages.push(pkg);
	}

	return packages;
};
