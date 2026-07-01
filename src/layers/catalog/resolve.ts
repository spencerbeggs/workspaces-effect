import { parseCatalogProtocol } from "@pnpm/catalogs.protocol-parser";
import { matchCatalogResolveResult, resolveFromCatalog } from "@pnpm/catalogs.resolver";
import type { Catalogs } from "@pnpm/catalogs.types";
import { CatalogResolutionError } from "../../errors/CatalogResolutionError.js";

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Minimal shape of a `package.json` manifest needed to resolve catalog and
 * workspace specifiers.
 *
 * @public
 */
export interface ManifestLike {
	readonly name: string;
	readonly version: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	[k: string]: unknown;
}

/** Map a `workspace:` specifier against a concrete version. */
export function resolveWorkspaceProtocol(spec: string, version: string): string {
	const rest = spec.slice("workspace:".length);
	if (rest === "*" || rest === "") return version;
	if (rest === "~") return `~${version}`;
	if (rest === "^") return `^${version}`;
	return rest; // workspace:^1.0.0 -> ^1.0.0 ; workspace:1.5.0 -> 1.5.0
}

const resolveOne = (
	catalogs: Catalogs,
	workspaceVersions: Record<string, string>,
	field: string,
	dependency: string,
	spec: string,
): string => {
	const catalogName = parseCatalogProtocol(spec);
	if (catalogName !== null) {
		const result = resolveFromCatalog(catalogs, { alias: dependency, bareSpecifier: spec });
		return matchCatalogResolveResult(result, {
			found: (r) => r.resolution.specifier,
			misconfiguration: (r) => {
				throw new CatalogResolutionError({ field, dependency, specifier: spec, reason: r.error.message });
			},
			unused: () => spec, // not expected for a parsed catalog spec
		});
	}
	if (spec.startsWith("workspace:")) {
		const version = workspaceVersions[dependency];
		if (!version) {
			throw new CatalogResolutionError({
				field,
				dependency,
				specifier: spec,
				reason: "no workspace package with that name",
			});
		}
		return resolveWorkspaceProtocol(spec, version);
	}
	return spec;
};

/**
 * Resolve all catalog:/workspace: specifiers in a manifest to concrete specs.
 * `workspaceVersions` maps workspace package name to version. Throws
 * CatalogResolutionError on an unresolvable reference. Pure.
 */
export function resolveManifest(
	catalogs: Catalogs,
	workspaceVersions: Record<string, string>,
	manifest: ManifestLike,
): ManifestLike {
	const out: ManifestLike = { ...manifest };
	for (const field of DEP_FIELDS) {
		const deps = manifest[field] as Record<string, string> | undefined;
		if (!deps) continue;
		const resolved: Record<string, string> = {};
		for (const [dependency, spec] of Object.entries(deps)) {
			resolved[dependency] = resolveOne(catalogs, workspaceVersions, field, dependency, spec);
		}
		out[field] = resolved;
	}
	// Defensive: assert nothing survived.
	for (const field of DEP_FIELDS) {
		const deps = out[field] as Record<string, string> | undefined;
		if (!deps) continue;
		for (const [dependency, spec] of Object.entries(deps)) {
			if (spec.startsWith("catalog:") || spec.startsWith("workspace:")) {
				throw new CatalogResolutionError({ field, dependency, specifier: spec, reason: "unresolved after resolution" });
			}
		}
	}
	return out;
}
