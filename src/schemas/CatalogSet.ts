import type { Catalogs } from "@pnpm/catalogs.types";
import { Effect, Option, Schema } from "effect";
import type { CatalogAssemblyError } from "../errors/CatalogAssemblyError.js";
import { CatalogResolutionError } from "../errors/CatalogResolutionError.js";
import { inlineCatalogs, mergeCatalogs } from "../layers/catalog/assemble.js";
import { resolveManifest } from "../layers/catalog/resolve.js";
import { workspaceManifestFromYaml } from "../layers/catalog/workspace-manifest.js";

/**
 * An immutable, fully-normalized catalog collection with the one
 * resolution semantic shared by live and point-in-time resolution.
 *
 * @public
 */
export class CatalogSet extends Schema.Class<CatalogSet>("CatalogSet")({
	entries: Schema.Record({
		key: Schema.String,
		value: Schema.Record({ key: Schema.String, value: Schema.String }),
	}),
}) {
	/** An empty catalog set. */
	static empty(): CatalogSet {
		return new CatalogSet({ entries: {} });
	}

	/** Wrap a pnpm `Catalogs` map, dropping undefined entries. */
	static fromCatalogs(catalogs: Catalogs): CatalogSet {
		const entries: Record<string, Record<string, string>> = {};
		for (const [name, catalog] of Object.entries(catalogs)) {
			if (!catalog) continue;
			const clean: Record<string, string> = {};
			for (const [dep, spec] of Object.entries(catalog)) {
				if (typeof spec === "string") clean[dep] = spec;
			}
			entries[name] = clean;
		}
		return new CatalogSet({ entries });
	}

	/** Parse the `catalog:`/`catalogs:` sections of a pnpm-workspace.yaml text. */
	static fromWorkspaceYaml(text: string): Effect.Effect<CatalogSet, CatalogAssemblyError> {
		return workspaceManifestFromYaml(text).pipe(
			Effect.map((manifest) =>
				CatalogSet.fromCatalogs(inlineCatalogs({ catalog: manifest.catalog, catalogs: manifest.catalogs })),
			),
		);
	}

	/**
	 * Normalize a pnpm lockfile `catalogs:` section — entries are either a
	 * specifier string or a `{ specifier, version }` object.
	 */
	static fromLockfileCatalogs(raw: unknown): CatalogSet {
		if (raw === null || typeof raw !== "object") return CatalogSet.empty();
		const entries: Record<string, Record<string, string>> = {};
		for (const [catalogName, catalog] of Object.entries(raw as Record<string, unknown>)) {
			if (catalog === null || typeof catalog !== "object") continue;
			const clean: Record<string, string> = {};
			for (const [dep, value] of Object.entries(catalog as Record<string, unknown>)) {
				if (typeof value === "string") {
					clean[dep] = value;
				} else if (value !== null && typeof value === "object" && "specifier" in value) {
					const spec = (value as { specifier: unknown }).specifier;
					if (typeof spec === "string") clean[dep] = spec;
				}
			}
			entries[catalogName] = clean;
		}
		return new CatalogSet({ entries });
	}

	/** Merge sets; later sets win per dependency within a catalog. */
	static merge(...sets: ReadonlyArray<CatalogSet>): CatalogSet {
		return CatalogSet.fromCatalogs(mergeCatalogs(...sets.map((s) => s.toCatalogs())));
	}

	/** View as the pnpm `Catalogs` shape. */
	toCatalogs(): Catalogs {
		return this.entries as Catalogs;
	}

	/**
	 * Resolve a `catalog:` specifier to its concrete range. `Option.none`
	 * for non-catalog specifiers and unresolved catalog entries.
	 */
	resolveSpecifier(dependency: string, specifier: string): Option.Option<string> {
		if (!specifier.startsWith("catalog:")) return Option.none();
		try {
			const resolved = resolveManifest(
				this.toCatalogs(),
				{},
				{
					name: "_",
					version: "0",
					dependencies: { [dependency]: specifier },
				},
			);
			const spec = resolved.dependencies?.[dependency];
			return spec !== undefined && spec !== specifier ? Option.some(spec) : Option.none();
		} catch (e) {
			if (e instanceof CatalogResolutionError) return Option.none();
			throw e;
		}
	}
}
