import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { FileSystem, Path } from "@effect/platform";
import type { Catalogs } from "@pnpm/catalogs.types";
import { Effect } from "effect";

/** A pnpm config dependency `updateConfig` hook. */
export type UpdateConfigHook = (
	config: { catalogs: Catalogs } & Record<string, unknown>,
) =>
	| ({ catalogs?: Catalogs | undefined } & Record<string, unknown>)
	| Promise<{ catalogs?: Catalogs | undefined } & Record<string, unknown>>;

const PLUGIN_NAME = /^(?:@[^/]+\/pnpm-plugin-|@pnpm\/plugin-|pnpm-plugin-)/;

/** Match pnpm's config-dependency plugin name gate. */
export function isPluginName(name: string): boolean {
	return PLUGIN_NAME.test(name);
}

/** configDependencies reduced to plugin names only, lexicographically ordered (pnpm's load order). */
export function orderedPluginNames(configDependencies: Record<string, string> | undefined): ReadonlyArray<string> {
	if (!configDependencies) return [];
	return Object.keys(configDependencies)
		.filter(isPluginName)
		.sort((a, b) => a.localeCompare(b));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Replay updateConfig hooks in order, threading one seeded config. A hook that
 * throws or returns a non-object is skipped (prior config kept). Returns the
 * final `config.catalogs`. Pure over the provided hook functions (no I/O).
 */
export async function runUpdateConfigHooks(
	hooks: ReadonlyArray<UpdateConfigHook>,
	seedCatalogs: Catalogs,
): Promise<Catalogs> {
	let config: { catalogs: Catalogs } & Record<string, unknown> = { catalogs: seedCatalogs };
	for (const hook of hooks) {
		try {
			const result = await hook(config);
			if (isPlainObject(result)) {
				config = { ...result, catalogs: (result.catalogs ?? config.catalogs) as Catalogs };
			}
			// non-object result -> skip, keep prior config
		} catch {
			// throwing hook -> skip, keep prior config
		}
	}
	return config.catalogs;
}

/**
 * Load each plugin-named config dependency's installed pnpmfile and return its
 * updateConfig hook. Missing/unloadable pnpmfiles are skipped. Effectful (fs + import).
 */
export const loadConfigDependencyHooks = (
	workspaceRoot: string,
	configDependencies: Record<string, string> | undefined,
): Effect.Effect<ReadonlyArray<UpdateConfigHook>, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const names = orderedPluginNames(configDependencies);
		const hooks: UpdateConfigHook[] = [];
		for (const name of names) {
			const base = path.join(workspaceRoot, "node_modules", ".pnpm-config", name);
			const mjs = path.join(base, "pnpmfile.mjs");
			const cjs = path.join(base, "pnpmfile.cjs");
			const hasMjs = yield* fs.exists(mjs).pipe(Effect.orElseSucceed(() => false));
			const hasCjs = hasMjs ? false : yield* fs.exists(cjs).pipe(Effect.orElseSucceed(() => false));
			const hook = yield* (
				hasMjs
					? Effect.tryPromise(async () => {
							const mod = (await import(pathToFileURL(mjs).href)) as {
								hooks?: { updateConfig?: UpdateConfigHook };
							};
							return mod.hooks?.updateConfig;
						})
					: hasCjs
						? Effect.tryPromise(async () => {
								const require = createRequire(`${base}/`);
								const mod = require(cjs) as { hooks?: { updateConfig?: UpdateConfigHook } };
								return mod.hooks?.updateConfig;
							})
						: Effect.succeed(undefined)
			).pipe(
				Effect.tapError((e) => Effect.logDebug(`skipped config dependency ${name}: ${String(e)}`)),
				Effect.orElseSucceed(() => undefined),
			);
			if (hook) hooks.push(hook);
		}
		return hooks;
	}).pipe(Effect.withSpan("CatalogResolver.loadConfigDependencyHooks"));
