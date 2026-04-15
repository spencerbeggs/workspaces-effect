/**
 * Synchronous workspace utilities for non-Effect contexts.
 *
 * Provides `findWorkspaceRootSync` and `getWorkspacePackagesSync` for
 * consumers that cannot use Effect pipelines (e.g., lint-staged handlers).
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Find the workspace root by walking up from `cwd`.
 *
 * Looks for `pnpm-workspace.yaml` first, then `package.json` with a
 * `workspaces` field. Returns the absolute path to the root, or `null`
 * if no workspace root is found.
 *
 * @param cwd - Starting directory (defaults to `process.cwd()`)
 * @returns Absolute path to workspace root, or `null`
 * @throws If the provided path does not exist
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

		try {
			const pkgPath = join(current, "package.json");
			if (existsSync(pkgPath)) {
				const content = readFileSync(pkgPath, "utf-8");
				const parsed = JSON.parse(content) as Record<string, unknown>;
				if ("workspaces" in parsed && parsed.workspaces != null) {
					return current;
				}
			}
		} catch {
			// Ignore read/parse errors, keep walking
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
};

/**
 * Read the root package.json name field.
 *
 * @internal
 */
const readRootPackageName = (root: string): string | undefined => {
	try {
		const content = readFileSync(join(root, "package.json"), "utf-8");
		const parsed = JSON.parse(content) as Record<string, unknown>;
		const name = parsed.name;
		return typeof name === "string" && name.length > 0 ? name : undefined;
	} catch {
		return undefined;
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

/**
 * List workspace packages synchronously.
 *
 * Reads workspace patterns from `pnpm-workspace.yaml` or `package.json`,
 * resolves them to directories, and reads each `package.json` name.
 * Always includes the root package as the first entry, matching the
 * behavior of the Effect-based `listPackages()`.
 *
 * @param root - Absolute path to the workspace root
 * @returns Array of workspace packages with root as first entry
 * @throws If the root directory does not exist
 *
 * @public
 */
export const getWorkspacePackagesSync = (
	root: string,
): ReadonlyArray<{ readonly name: string; readonly path: string }> => {
	if (!existsSync(root)) {
		throw new Error(`Directory does not exist: ${root}`);
	}

	const rootName = readRootPackageName(root);
	const rootPkg = rootName ? { name: rootName, path: root } : undefined;

	const patterns = readPatterns(root);
	if (patterns.length === 0) {
		return rootPkg ? [rootPkg] : [];
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

	const packages: Array<{ name: string; path: string }> = [];
	if (rootPkg) {
		packages.push(rootPkg);
	}

	for (const dir of nonRootDirs) {
		try {
			const content = readFileSync(join(dir, "package.json"), "utf-8");
			const parsed = JSON.parse(content) as Record<string, unknown>;
			const name = parsed.name;
			if (typeof name === "string" && name.length > 0) {
				packages.push({ name, path: dir });
			}
		} catch {
			// Skip unreadable packages
		}
	}

	return packages;
};
