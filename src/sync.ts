/**
 * Synchronous workspace utilities for non-Effect contexts.
 *
 * Provides `findWorkspaceRootSync` and `getWorkspacePackagesSync` for
 * consumers that cannot use Effect pipelines (e.g., lint-staged handlers).
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Find the workspace root by walking up from `cwd`.
 *
 * Looks for `pnpm-workspace.yaml` first, then `package.json` with a
 * `workspaces` field. Returns the absolute path to the root, or `null`
 * if no workspace root is found.
 *
 * @param cwd - Starting directory (defaults to `process.cwd()`)
 * @returns Absolute path to workspace root, or `null`
 *
 * @public
 */
export const findWorkspaceRootSync = (cwd?: string): string | null => {
	let current: string;
	try {
		current = resolve(cwd ?? process.cwd());
	} catch {
		return null;
	}

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
 * Returns an array of `{ name, path }` objects, or `null` if the root
 * directory doesn't exist.
 *
 * @param root - Absolute path to the workspace root
 * @returns Array of workspace packages (excluding root), or `null`
 *
 * @public
 */
export const getWorkspacePackagesSync = (
	root: string,
): ReadonlyArray<{ readonly name: string; readonly path: string }> | null => {
	if (!existsSync(root)) return null;

	const patterns = readPatterns(root);
	if (patterns.length === 0) return [];

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

	const packages: Array<{ name: string; path: string }> = [];
	for (const dir of Array.from(included).sort()) {
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
