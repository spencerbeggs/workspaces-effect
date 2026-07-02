/**
 * The ONE code path that reads the working tree's catalog sources
 * (`pnpm-workspace.yaml` + `pnpm-lock.yaml`). Consumed by
 * `PointInTimeWorkspace.worktree()` (base snapshot) and by
 * `CatalogResolverLive` (which overlays config-dependency hook replay on
 * top). Do not add a second manifest/lockfile read for the worktree.
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { parse as parseYaml } from "yaml-effect";
import { CatalogAssemblyError } from "../../errors/CatalogAssemblyError.js";
import { CatalogSet } from "../../schemas/CatalogSet.js";
import { inlineCatalogs } from "../catalog/assemble.js";
import type { WorkspaceManifestData } from "../catalog/workspace-manifest.js";
import { readWorkspaceManifest } from "../catalog/workspace-manifest.js";

/**
 * Catalog-relevant working-tree state, decomposed so consumers can either
 * take the merged snapshot view or re-compose with an overlay.
 *
 * @internal
 */
export interface WorktreeCatalogState {
	readonly inline: CatalogSet;
	readonly lockfile: CatalogSet;
	/** `CatalogSet.merge(lockfile, inline)` — inline wins; the snapshot-visible set. */
	readonly merged: CatalogSet;
	readonly configDependencies: WorkspaceManifestData["configDependencies"];
}

/**
 * Catalogs of a lockfile TEXT. A malformed lockfile degrades to an empty
 * set — the inline catalogs still resolve; never fail the whole read.
 *
 * @internal
 */
const lockfileCatalogsFromText = (text: string): Effect.Effect<CatalogSet> =>
	parseYaml(text).pipe(
		Effect.map((parsed) => CatalogSet.fromLockfileCatalogs((parsed as { catalogs?: unknown } | null)?.catalogs)),
		Effect.orElseSucceed(() => CatalogSet.empty()),
	);

/**
 * Read the working tree's catalog state at `root`.
 *
 * A missing `pnpm-lock.yaml` yields empty lockfile catalogs; any OTHER read
 * failure (permissions, I/O) is a real problem and fails with
 * {@link CatalogAssemblyError} rather than being masked as "no lockfile".
 *
 * @internal
 */
export const readWorktreeCatalogState = (
	root: string,
): Effect.Effect<WorktreeCatalogState, CatalogAssemblyError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const manifest = yield* readWorkspaceManifest(root);
		const inline = CatalogSet.fromCatalogs(inlineCatalogs({ catalog: manifest.catalog, catalogs: manifest.catalogs }));
		const lockPath = path.join(root, "pnpm-lock.yaml");
		const lockText = yield* fs.readFileString(lockPath).pipe(
			Effect.catchAll((error) =>
				error._tag === "SystemError" && error.reason === "NotFound"
					? Effect.succeed(null)
					: Effect.fail(
							new CatalogAssemblyError({
								source: "lockfile",
								reason: `failed to read ${lockPath}: ${String(error)}`,
							}),
						),
			),
		);
		const lockfile = lockText === null ? CatalogSet.empty() : yield* lockfileCatalogsFromText(lockText);
		return {
			inline,
			lockfile,
			merged: CatalogSet.merge(lockfile, inline),
			configDependencies: manifest.configDependencies,
		};
	}).pipe(Effect.withSpan("PointInTimeWorkspace.readWorktreeCatalogState", { attributes: { root } }));
