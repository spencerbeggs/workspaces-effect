/**
 * Reader for the npm/bun `workspaces` field of a root `package.json` — the
 * package.json counterpart to `workspace-manifest.ts` (which reads pnpm's
 * `pnpm-workspace.yaml`). Pure with respect to the filesystem.
 *
 * @packageDocumentation
 * @internal
 */

import { Effect, ParseResult, Schema } from "effect";
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

const CatalogRecordSchema = Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
	identifier: "CatalogRecord",
});

const CatalogsRecordSchema = Schema.Record({ key: Schema.String, value: CatalogRecordSchema }).annotations({
	identifier: "CatalogsRecord",
});

// `Schema.mutable` here (rather than the default readonly `Schema.Array`) matters for
// narrowing below: `Array.isArray` cannot exclude a `ReadonlyArray<string>` member from a
// union with an object type (a readonly array isn't assignable to `any[]`), so the
// fallthrough branch stays widened to the full union. A mutable array narrows cleanly.
const PackageJsonWorkspacesArraySchema = Schema.mutable(Schema.Array(Schema.String)).annotations({
	identifier: "PackageJsonWorkspacesArray",
});

const PackageJsonWorkspacesObjectSchema = Schema.Struct({
	packages: Schema.optional(Schema.Array(Schema.String)),
	catalog: Schema.optional(CatalogRecordSchema),
	catalogs: Schema.optional(CatalogsRecordSchema),
}).annotations({ identifier: "PackageJsonWorkspacesObject" });

/**
 * The shape npm/bun accept for a root `package.json`'s `workspaces` field:
 * an array of globs, or an object carrying `packages` and (for bun) `catalog`
 * / `catalogs`. Any other JSON value (a number, string, boolean, `null`, or
 * an object with malformed `packages`/`catalog`/`catalogs`) is malformed.
 */
const WorkspacesFieldSchema = Schema.Union(
	PackageJsonWorkspacesArraySchema,
	PackageJsonWorkspacesObjectSchema,
).annotations({ identifier: "PackageJsonWorkspacesField" });

const PackageJsonWithWorkspacesSchema = Schema.Struct({
	workspaces: Schema.optional(WorkspacesFieldSchema),
});

/**
 * Parse the `workspaces` field out of a root `package.json`'s text.
 *
 * @param content - Raw `package.json` text.
 * @returns An Effect yielding the workspaces slice; all fields are `undefined`
 *   when the manifest has no `workspaces` field (a legitimate, common shape —
 *   not every root `package.json` declares workspaces). Fails with
 *   {@link CatalogAssemblyError} when the text is not valid JSON, or when a
 *   present `workspaces` field is not a valid npm/bun shape (not an array of
 *   strings and not an object with valid `packages`/`catalog`/`catalogs`) —
 *   an unreadable manifest must never be silently treated as an empty one,
 *   since that would make every dependency in the workspace look "added".
 *
 * @public
 */
export const parsePackageJsonWorkspaces = (
	content: string,
): Effect.Effect<PackageJsonWorkspaces, CatalogAssemblyError> =>
	Effect.gen(function* () {
		const parsed = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (error) =>
				new CatalogAssemblyError({
					source: "manifest",
					reason: `invalid json: ${String(error)}`,
				}),
		});

		const decoded = yield* Schema.decodeUnknown(PackageJsonWithWorkspacesSchema)(parsed).pipe(
			Effect.mapError(
				(error) =>
					new CatalogAssemblyError({
						source: "manifest",
						reason: `malformed workspaces field: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
					}),
			),
		);

		const ws = decoded.workspaces;
		if (ws === undefined) return {};
		if (Array.isArray(ws)) return { packages: ws };
		return {
			packages: ws.packages,
			catalog: ws.catalog,
			catalogs: ws.catalogs,
		};
	});

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
