/**
 * Shared parser utilities used by all four lockfile parsers.
 *
 * Provides common interfaces, specifier detection, and workspace
 * dependency extraction logic.
 *
 * @packageDocumentation
 * @internal
 */

import { WorkspaceDependency } from "../../schemas/lockfile.js";

/**
 * Dependency type keys to inspect when extracting workspace dependencies.
 *
 * @internal
 */
const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * The four dependency sections of a manifest, in a stable order.
 *
 * Each tuple pairs the manifest field name with the {@link ImporterDependency}
 * `depType` it maps to. Declared once and shared by the pnpm, bun, and npm
 * parsers when building their importer records.
 *
 * @internal
 */
export const DEP_SECTIONS = [
	["dependencies", "dependencies"],
	["devDependencies", "devDependencies"],
	["peerDependencies", "peerDependencies"],
	["optionalDependencies", "optionalDependencies"],
] as const;

/**
 * Common dependency map shape shared across all lockfile formats.
 * Represents the dependency fields of a single workspace entry.
 *
 * @internal
 */
export interface WorkspaceEntry {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
}

/**
 * Returns `true` if the specifier is a workspace, link, or file reference
 * (e.g., `"workspace:*"`, `"link:../foo"`, `"file:../bar"`).
 *
 * @internal
 */
export const isWorkspaceSpecifier = (specifier: string): boolean =>
	specifier.startsWith("workspace:") || specifier.startsWith("link:") || specifier.startsWith("file:");

/**
 * Extract inter-workspace dependencies from workspace entries.
 *
 * Iterates all dependency types for each workspace and emits a
 * {@link WorkspaceDependency} for every dependency whose name is
 * present in `workspaceNames`.
 *
 * @internal
 */
export const extractWorkspaceDeps = (
	workspaces: ReadonlyMap<string, WorkspaceEntry>,
	workspaceNames: ReadonlySet<string>,
): ReadonlyArray<WorkspaceDependency> => {
	const deps: WorkspaceDependency[] = [];
	for (const [from, entry] of workspaces) {
		for (const depType of DEP_TYPES) {
			const depMap = entry[depType];
			if (!depMap) continue;
			for (const [name, constraint] of Object.entries(depMap)) {
				if (workspaceNames.has(name)) {
					deps.push(new WorkspaceDependency({ from, to: name, depType, constraint }));
				}
			}
		}
	}
	return deps;
};
