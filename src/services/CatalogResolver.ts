// src/services/CatalogResolver.ts
import type { Catalogs } from "@pnpm/catalogs.types";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { CatalogAssemblyError } from "../errors/CatalogAssemblyError.js";
import type { CatalogResolutionError } from "../errors/CatalogResolutionError.js";
import type { WorkspaceRootNotFoundError } from "../errors/WorkspaceRootNotFoundError.js";
import type { ManifestLike } from "../layers/catalog/resolve.js";

/**
 * Errors surfaced by {@link CatalogResolver} methods (assembly defers I/O to first call).
 *
 * @remarks
 * Assembly reads the working tree through the shared worktree-catalog pipeline,
 * so the only failure modes are locating the workspace root
 * ({@link WorkspaceRootNotFoundError}) and reading/parsing the manifest or an
 * unreadable lockfile ({@link CatalogAssemblyError}). A missing or malformed
 * lockfile degrades to empty catalogs rather than failing.
 *
 * @public
 */
export type CatalogResolverError = CatalogAssemblyError | WorkspaceRootNotFoundError;

/**
 * Resolves a workspace's catalogs and rewrites catalog:/workspace: specifiers.
 *
 * @remarks
 * Assembles the complete catalog set — inline `pnpm-workspace.yaml` catalogs,
 * catalogs injected by config dependencies (via pnpmfile `updateConfig` replay),
 * and lockfile catalogs — without depending on the transient workspace-state file.
 *
 * @public
 */
export class CatalogResolver extends Context.Tag("@spencerbeggs/workspaces-effect/CatalogResolver")<
	CatalogResolver,
	{
		/** The complete assembled catalog set for the workspace (cached). */
		readonly catalogs: () => Effect.Effect<Catalogs, CatalogResolverError>;
		/** Rewrite all catalog:/workspace: specifiers in a manifest to concrete specs. */
		readonly resolve: (
			manifest: ManifestLike,
		) => Effect.Effect<ManifestLike, CatalogResolverError | CatalogResolutionError>;
		/** Resolve a single dependency specifier; None when no rewrite is needed. */
		readonly resolveSpecifier: (
			dependency: string,
			specifier: string,
		) => Effect.Effect<Option.Option<string>, CatalogResolverError | CatalogResolutionError>;
	}
>() {}
