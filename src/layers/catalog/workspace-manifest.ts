import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { parse as parseYaml } from "yaml-effect";
import { CatalogAssemblyError } from "../../errors/CatalogAssemblyError.js";

/**
 * The catalog-relevant slice of pnpm-workspace.yaml.
 *
 * @remarks
 * Exported (and tagged `@public`) because it appears in the `extends`
 * clause of the `@public` {@link WorkspaceManifestData} interface —
 * api-extractor requires base types of public exports to themselves be
 * exported from the entry point.
 *
 * @public
 */
export interface WorkspaceManifestCatalogs {
	/** The default (unnamed) catalog. */
	readonly catalog?: Record<string, string> | undefined;
	/** Named catalogs. */
	readonly catalogs?: Record<string, Record<string, string>> | undefined;
	/** configDependencies map (name to versionSpec). */
	readonly configDependencies?: Record<string, string> | undefined;
}

/** The point-in-time-relevant slice of pnpm-workspace.yaml. @public */
export interface WorkspaceManifestData extends WorkspaceManifestCatalogs {
	/** Workspace package globs (the `packages:` list). */
	readonly packages?: ReadonlyArray<string> | undefined;
}

/**
 * Parse a pnpm-workspace.yaml text into its catalog/config-dependency/packages
 * slice. Pure with respect to the filesystem.
 *
 * @public
 */
export const workspaceManifestFromYaml = (
	content: string,
): Effect.Effect<WorkspaceManifestData, CatalogAssemblyError> =>
	parseYaml(content).pipe(
		Effect.mapError((e) => new CatalogAssemblyError({ source: "manifest", reason: `invalid yaml: ${String(e)}` })),
		Effect.map((parsed) => {
			const raw = parsed as Record<string, unknown>;
			return {
				catalog: raw.catalog as Record<string, string> | undefined,
				catalogs: raw.catalogs as Record<string, Record<string, string>> | undefined,
				configDependencies: raw.configDependencies as Record<string, string> | undefined,
				packages: raw.packages as ReadonlyArray<string> | undefined,
			};
		}),
	);

/**
 * Read catalog/catalogs/configDependencies from `pnpm-workspace.yaml`.
 * Returns all-undefined when the file is absent (non-pnpm workspace); fails
 * CatalogAssemblyError only on malformed YAML.
 */
export const readWorkspaceManifest = (
	workspaceRoot: string,
): Effect.Effect<WorkspaceManifestCatalogs, CatalogAssemblyError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(workspaceRoot, "pnpm-workspace.yaml");
		const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
		if (!exists) return { catalog: undefined, catalogs: undefined, configDependencies: undefined };
		const content = yield* fs
			.readFileString(file)
			.pipe(Effect.mapError((e) => new CatalogAssemblyError({ source: "manifest", reason: String(e) })));
		return yield* workspaceManifestFromYaml(content);
	}).pipe(Effect.withSpan("CatalogResolver.readWorkspaceManifest", { attributes: { workspaceRoot } }));
