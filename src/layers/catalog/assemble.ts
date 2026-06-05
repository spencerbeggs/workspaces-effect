import type { FileSystem, Path } from "@effect/platform";
import { getCatalogsFromWorkspaceManifest } from "@pnpm/catalogs.config";
import type { Catalogs } from "@pnpm/catalogs.types";
import { Effect } from "effect";
import type { CatalogAssemblyError } from "../../errors/CatalogAssemblyError.js";
import type { WorkspaceManifestCatalogs } from "./workspace-manifest.js";
import { readWorkspaceManifest } from "./workspace-manifest.js";

/** Merge catalog sources; later sources win per dependency within a catalog. */
export function mergeCatalogs(...sources: ReadonlyArray<Catalogs | undefined>): Catalogs {
	const result: Record<string, Record<string, string | undefined>> = {};
	for (const source of sources) {
		if (!source) continue;
		for (const [name, entries] of Object.entries(source)) {
			if (!entries) continue;
			result[name] = { ...result[name], ...entries };
		}
	}
	return result as Catalogs;
}

/** Project manifest catalog/catalogs into a Catalogs map (default under "default"). */
export function inlineCatalogs(manifest: Pick<WorkspaceManifestCatalogs, "catalog" | "catalogs">): Catalogs {
	if (!manifest.catalog && !manifest.catalogs) return {} as Catalogs;
	return getCatalogsFromWorkspaceManifest({ catalog: manifest.catalog, catalogs: manifest.catalogs });
}

export interface AssembleOptions {
	readonly workspaceRoot: string;
	/** Lockfile catalogs (lowest precedence). From LockfileReader.pmSpecific.catalogs when pnpm. */
	readonly lockfileCatalogs?: Catalogs | undefined;
	/**
	 * Pre-loaded config-dependency-injected catalogs (highest precedence).
	 * The layer computes these via the hook-replay loader; tests inject directly.
	 */
	readonly injectedCatalogs?: Catalogs | undefined;
}

/** Assemble the complete catalog set with precedence lockfile, then inline, then config-dependency-injected. */
export const assembleCatalogs = (
	options: AssembleOptions,
): Effect.Effect<Catalogs, CatalogAssemblyError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const manifest = yield* readWorkspaceManifest(options.workspaceRoot);
		const inline = inlineCatalogs(manifest);
		const assembled = mergeCatalogs(options.lockfileCatalogs, inline, options.injectedCatalogs);
		yield* Effect.logDebug("assembled catalogs").pipe(
			Effect.annotateLogs({ catalogs: Object.keys(assembled).join(",") }),
		);
		return assembled;
	}).pipe(Effect.withSpan("CatalogResolver.assembleCatalogs"));
