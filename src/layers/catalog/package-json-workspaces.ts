/**
 * Reader for the npm/bun `workspaces` field of a root `package.json` — the
 * package.json counterpart to `workspace-manifest.ts` (which reads pnpm's
 * `pnpm-workspace.yaml`). Pure with respect to the filesystem.
 *
 * @packageDocumentation
 * @internal
 */

import { Effect } from "effect";
import { CatalogAssemblyError } from "../../errors/CatalogAssemblyError.js";
import { CatalogSet } from "../../schemas/CatalogSet.js";

/**
 * The catalog- and glob-bearing slice of the npm/bun `workspaces` field of a
 * root `package.json`.
 *
 * @remarks
 * npm and bun accept `workspaces` as an array of globs, or as an object with a
 * `packages` array. Bun additionally reads `catalog` (the default catalog) and
 * `catalogs` (named catalogs) from the object form — the package.json analogue
 * of pnpm's `pnpm-workspace.yaml` `catalog:` / `catalogs:` keys.
 *
 * @public
 */
export interface PackageJsonWorkspaces {
	readonly packages?: ReadonlyArray<string> | undefined;
	readonly catalog?: Record<string, string> | undefined;
	readonly catalogs?: Record<string, Record<string, string>> | undefined;
}

/**
 * Parse the `workspaces` field out of a root `package.json`'s text.
 *
 * @param content - Raw `package.json` text.
 * @returns An Effect yielding the workspaces slice; all fields are `undefined`
 *   when the manifest has no `workspaces` field. Fails with
 *   {@link CatalogAssemblyError} when the text is not valid JSON.
 *
 * @public
 */
export const parsePackageJsonWorkspaces = (
	content: string,
): Effect.Effect<PackageJsonWorkspaces, CatalogAssemblyError> =>
	Effect.try({
		try: () => JSON.parse(content) as { workspaces?: unknown },
		catch: (error) =>
			new CatalogAssemblyError({
				source: "manifest",
				reason: `invalid json: ${String(error)}`,
			}),
	}).pipe(
		Effect.map((parsed): PackageJsonWorkspaces => {
			const ws = parsed.workspaces;
			if (Array.isArray(ws)) {
				return { packages: ws.filter((p): p is string => typeof p === "string") };
			}
			if (typeof ws !== "object" || ws === null) return {};
			const obj = ws as {
				packages?: unknown;
				catalog?: unknown;
				catalogs?: unknown;
			};
			return {
				packages: Array.isArray(obj.packages)
					? obj.packages.filter((p): p is string => typeof p === "string")
					: undefined,
				catalog: obj.catalog as Record<string, string> | undefined,
				catalogs: obj.catalogs as Record<string, Record<string, string>> | undefined,
			};
		}),
	);

/**
 * Build a {@link CatalogSet} from a root `package.json`'s `workspaces` field.
 *
 * @remarks
 * `workspaces.catalog` becomes the `"default"` catalog; every key of
 * `workspaces.catalogs` becomes a catalog of that name. This mirrors how
 * {@link CatalogSet.fromWorkspaceYaml} treats pnpm's `catalog:` / `catalogs:`.
 *
 * @param content - Raw `package.json` text.
 *
 * @public
 */
export const catalogSetFromPackageJson = (content: string): Effect.Effect<CatalogSet, CatalogAssemblyError> =>
	parsePackageJsonWorkspaces(content).pipe(
		Effect.map((ws) =>
			CatalogSet.fromCatalogs({
				...(ws.catalog ? { default: ws.catalog } : {}),
				...(ws.catalogs ?? {}),
			}),
		),
	);
