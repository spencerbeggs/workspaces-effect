/**
 * Live layer for the {@link CatalogResolver} service.
 *
 * Assembles the complete catalog set from inline workspace manifest catalogs,
 * config-dependency hook injections, and lockfile catalogs, then exposes
 * `resolve` / `resolveSpecifier` methods that rewrite `catalog:` and
 * `workspace:` specifiers to concrete version constraints.
 *
 * @packageDocumentation
 * @internal
 */

import { FileSystem, Path } from "@effect/platform";
import type { Catalogs } from "@pnpm/catalogs.types";
import { Effect, Layer, Option } from "effect";
import { CatalogResolutionError } from "../errors/CatalogResolutionError.js";
import type { CatalogResolverError } from "../services/CatalogResolver.js";
import { CatalogResolver } from "../services/CatalogResolver.js";
import { LockfileReader } from "../services/LockfileReader.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { assembleCatalogs, inlineCatalogs } from "./catalog/assemble.js";
import { loadConfigDependencyHooks, runUpdateConfigHooks } from "./catalog/config-dependency-hooks.js";
import type { ManifestLike } from "./catalog/resolve.js";
import { resolveManifest } from "./catalog/resolve.js";
import { readWorkspaceManifest } from "./catalog/workspace-manifest.js";

/**
 * Convenience type alias for the {@link CatalogResolverLive} layer signature.
 *
 * @public
 */
export type CatalogResolverLiveLayer = Layer.Layer<
	CatalogResolver,
	never,
	WorkspaceRoot | LockfileReader | WorkspaceDiscovery | FileSystem.FileSystem | Path.Path
>;

/**
 * Live layer for the {@link CatalogResolver} service.
 *
 * Provides catalog assembly and specifier resolution backed by:
 * - Inline `catalog:` / `catalogs:` declarations in `pnpm-workspace.yaml`
 * - Config-dependency `updateConfig` hooks (pnpmfile hook replay)
 * - Lockfile-recorded catalogs (pnpm `pmSpecific.catalogs`)
 *
 * Assembly is deferred to the first use and memoized via `Effect.cached`,
 * matching the lazy-init pattern used by {@link LockfileReaderLive}.
 *
 * @public
 */
export const CatalogResolverLive: CatalogResolverLiveLayer = Layer.effect(
	CatalogResolver,
	Effect.gen(function* () {
		const workspaceRoot = yield* WorkspaceRoot;
		const lockfileReader = yield* LockfileReader;
		const discovery = yield* WorkspaceDiscovery;
		// Resolve FileSystem and Path at layer construction time so the cached
		// Effect has R=never (same pattern as readWorkspaceManifest / assembleCatalogs
		// which need FileSystem|Path but must not re-resolve them per call).
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		// Lazy, cached assembly: runs once on first access (success or failure both
		// memoized for the lifetime of the layer — same idiom as LockfileReaderLive).
		const assembled: Effect.Effect<Catalogs, CatalogResolverError> = yield* Effect.cached(
			Effect.gen(function* () {
				const root = yield* workspaceRoot.find(process.cwd());
				const manifest = yield* readWorkspaceManifest(root);
				const seed = inlineCatalogs(manifest);
				const hooks = yield* loadConfigDependencyHooks(root, manifest.configDependencies);
				const injected = yield* Effect.promise(() => runUpdateConfigHooks(hooks, seed));

				// Extract lockfile catalogs for pnpm. The lockfile stores each entry as
				// either a plain string specifier or a {specifier, version} object;
				// Catalogs.Catalog requires string|undefined, so we normalise to the
				// specifier string.
				const lockfileCatalogs: Catalogs | undefined = yield* lockfileReader.readLockfile().pipe(
					Effect.map((data) => {
						const pmSpecific = data.pmSpecific;
						if (pmSpecific?._tag !== "pnpm" || !pmSpecific.catalogs) return undefined;
						const raw = pmSpecific.catalogs;
						const result: Record<string, Record<string, string | undefined>> = {};
						for (const [catalogName, entries] of Object.entries(raw)) {
							if (!entries) continue;
							const catalog: Record<string, string | undefined> = {};
							for (const [dep, value] of Object.entries(entries)) {
								if (typeof value === "string") {
									catalog[dep] = value;
								} else if (value !== null && typeof value === "object" && "specifier" in value) {
									catalog[dep] = (value as { specifier: string }).specifier;
								}
							}
							result[catalogName] = catalog;
						}
						return result as Catalogs;
					}),
					Effect.orElseSucceed(() => undefined),
				);

				return yield* assembleCatalogs({
					workspaceRoot: root,
					inlineCatalogs: seed,
					lockfileCatalogs,
					injectedCatalogs: injected,
				});
			}).pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path),
				Effect.withSpan("CatalogResolver.init"),
			),
		);

		// Resolve a workspace: specifier for a named package by querying WorkspaceDiscovery.
		// getPackage fails with PackageNotFoundError when the package doesn't exist; we
		// convert to Option so call sites can branch gracefully.
		const workspaceVersionFor = (name: string): Effect.Effect<Option.Option<string>> =>
			discovery.getPackage(name).pipe(
				Effect.map((pkg) => pkg.version),
				Effect.option,
			);

		const resolve = (
			manifest: ManifestLike,
		): Effect.Effect<ManifestLike, CatalogResolverError | CatalogResolutionError> =>
			Effect.gen(function* () {
				const catalogs = yield* assembled;

				// Collect workspace versions for any workspace: specifiers in the manifest.
				const versions: Record<string, string> = {};
				for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
					const deps = manifest[field] as Record<string, string> | undefined;
					if (!deps) continue;
					for (const [dep, spec] of Object.entries(deps)) {
						if (spec.startsWith("workspace:")) {
							const v = yield* workspaceVersionFor(dep);
							if (Option.isSome(v)) versions[dep] = v.value;
						}
					}
				}

				// resolveManifest throws CatalogResolutionError synchronously on
				// unresolvable references; surface it as a typed failure so consumers
				// can Effect.catchTag("CatalogResolutionError", …).
				return yield* Effect.try({
					try: () => resolveManifest(catalogs, versions, manifest),
					catch: (e) => {
						if (e instanceof CatalogResolutionError) return e;
						throw e;
					},
				});
			}).pipe(Effect.withSpan("CatalogResolver.resolve"));

		return CatalogResolver.of({
			catalogs: () => assembled,

			resolve,

			resolveSpecifier: (dependency: string, specifier: string) =>
				Effect.gen(function* () {
					// Plain specifiers need no rewrite. catalog:/workspace: both route through
					// resolveManifest so resolveSpecifier and resolve share one resolution path
					// (and therefore one error behavior — an unresolvable workspace: ref fails
					// with CatalogResolutionError here too, not a silent None).
					if (!specifier.startsWith("catalog:") && !specifier.startsWith("workspace:")) {
						return Option.none<string>();
					}
					const catalogs = yield* assembled;
					const versions: Record<string, string> = {};
					if (specifier.startsWith("workspace:")) {
						const v = yield* workspaceVersionFor(dependency);
						if (Option.isSome(v)) versions[dependency] = v.value;
					}
					return yield* Effect.try({
						try: () => {
							const resolved = resolveManifest(catalogs, versions, {
								name: "_",
								version: "0",
								dependencies: { [dependency]: specifier },
							});
							const spec = resolved.dependencies?.[dependency];
							return spec !== undefined ? Option.some(spec) : Option.none<string>();
						},
						catch: (e) => {
							if (e instanceof CatalogResolutionError) return e;
							throw e;
						},
					});
				}),
		});
	}),
);
