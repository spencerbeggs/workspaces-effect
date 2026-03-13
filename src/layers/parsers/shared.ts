/**
 * Shared parser utilities used by all 4 lockfile parsers.
 */

import { WorkspaceDependency } from "../../schemas/lockfile.js";

const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

export interface WorkspaceEntry {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
}

/** True if the specifier is a workspace/link/file reference. */
export const isWorkspaceSpecifier = (specifier: string): boolean =>
	specifier.startsWith("workspace:") || specifier.startsWith("link:") || specifier.startsWith("file:");

/** Extract inter-workspace dependencies from workspace entries. */
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
