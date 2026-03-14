/**
 * Parser for pnpm `pnpm-lock.yaml` lockfiles.
 *
 * Parses YAML content, validates against {@link PnpmLockfileRaw}, and
 * transforms into the unified {@link LockfileData} model.
 *
 * @privateRemarks
 * Uses `yaml-effect` for YAML parsing and `Schema.decodeUnknown`
 * for structural validation. Importers are treated as workspace entries;
 * `link:` version prefixes identify inter-workspace dependencies.
 *
 * @packageDocumentation
 * @internal
 */

import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml-effect";
import { LockfileParseError } from "../../errors/LockfileParseError.js";
import { LockfileData, PnpmExtension, ResolvedPackage } from "../../schemas/lockfile.js";
import type { WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps } from "./shared.js";

/**
 * Raw schema for pnpm lockfile validation.
 *
 * @internal
 */

const PnpmImporterDeps = Schema.optional(
	Schema.Record({
		key: Schema.String,
		value: Schema.Struct({
			specifier: Schema.String,
			version: Schema.String,
		}),
	}),
);

const PnpmImporter = Schema.Struct({
	dependencies: PnpmImporterDeps,
	devDependencies: PnpmImporterDeps,
	peerDependencies: PnpmImporterDeps,
	optionalDependencies: PnpmImporterDeps,
});

const PnpmLockfileRaw = Schema.Struct({
	lockfileVersion: Schema.Union(Schema.String, Schema.Number),
	settings: Schema.optional(
		Schema.Struct({
			autoInstallPeers: Schema.optional(Schema.Boolean),
			excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
		}),
	),
	overrides: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({
				key: Schema.String,
				value: Schema.String,
			}),
		}),
	),
	importers: Schema.Record({
		key: Schema.String,
		value: PnpmImporter,
	}),
	packages: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Struct({
				resolution: Schema.optional(
					Schema.Struct({
						integrity: Schema.optional(Schema.String),
					}),
				),
			}),
		}),
	),
});

type PnpmLockfileRawType = Schema.Schema.Type<typeof PnpmLockfileRaw>;

/**
 * Parse a pnpm `pnpm-lock.yaml` lockfile into the unified {@link LockfileData} model.
 *
 * @privateRemarks
 * Pipeline: YAML parse -\> Schema validation -\> transform to `LockfileData`.
 * Populates {@link PnpmExtension} with catalogs, overrides, and settings.
 *
 * @internal
 */
export const parsePnpmLockfile = (
	content: string,
	lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
	Effect.gen(function* () {
		// Step 1: YAML parse
		const raw = yield* parseYaml(content).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "pnpm",
						cause: e,
					}),
			),
		);

		// Step 2: Schema validation
		const validated = yield* Schema.decodeUnknown(PnpmLockfileRaw)(raw).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "pnpm",
						cause: e,
					}),
			),
		);

		// Step 3: Log parsed data
		yield* Effect.logDebug("Parsed pnpm lockfile").pipe(
			Effect.annotateLogs({
				"workspace.importers.count": Object.keys(validated.importers).length,
				"workspace.packages.count": Object.keys(validated.packages ?? {}).length,
			}),
		);

		// Step 4: Transform to unified model
		return toLockfileData(validated);
	}).pipe(
		Effect.withSpan("LockfileReader.parse.pnpm", {
			attributes: { "workspace.lockfile": lockfilePath },
		}),
	);

/**
 * Transform validated pnpm lockfile data into the unified model.
 *
 * @internal
 */
const toLockfileData = (raw: PnpmLockfileRawType): LockfileData => {
	const workspaceEntries = new Map<string, WorkspaceEntry>();
	const workspaceNames = new Set<string>();

	for (const [importerPath, importer] of Object.entries(raw.importers)) {
		const toVersionMap = (
			deps: Record<string, { specifier: string; version: string }> | undefined,
		): Record<string, string> | undefined => {
			if (!deps) return undefined;
			const result: Record<string, string> = {};
			for (const [name, info] of Object.entries(deps)) {
				result[name] = info.specifier;
			}
			return result;
		};

		const deps = toVersionMap(importer.dependencies);
		const devDeps = toVersionMap(importer.devDependencies);
		const peerDeps = toVersionMap(importer.peerDependencies);
		const optDeps = toVersionMap(importer.optionalDependencies);
		workspaceEntries.set(importerPath, {
			...(deps ? { dependencies: deps } : {}),
			...(devDeps ? { devDependencies: devDeps } : {}),
			...(peerDeps ? { peerDependencies: peerDeps } : {}),
			...(optDeps ? { optionalDependencies: optDeps } : {}),
		});

		for (const deps of [
			importer.dependencies,
			importer.devDependencies,
			importer.peerDependencies,
			importer.optionalDependencies,
		]) {
			if (!deps) continue;
			for (const [name, info] of Object.entries(deps)) {
				if (info.version.startsWith("link:")) {
					workspaceNames.add(name);
				}
			}
		}
	}

	for (const path of Object.keys(raw.importers)) {
		if (path !== ".") {
			workspaceNames.add(path);
		}
	}

	const packages: ResolvedPackage[] = [];

	for (const [importerPath] of Object.entries(raw.importers)) {
		if (importerPath === ".") continue;
		packages.push(
			new ResolvedPackage({
				name: importerPath,
				version: "0.0.0",
				isWorkspace: true,
			}),
		);
	}

	if (raw.packages) {
		for (const [key, pkg] of Object.entries(raw.packages)) {
			const atIndex = key.lastIndexOf("@");
			if (atIndex <= 0) continue;
			const name = key.slice(0, atIndex);
			const version = key.slice(atIndex + 1);
			packages.push(
				new ResolvedPackage({
					name,
					version,
					integrity: pkg.resolution?.integrity,
					isWorkspace: false,
				}),
			);
		}
	}

	const wsDeps = extractWorkspaceDeps(workspaceEntries, workspaceNames);

	const pmSpecific = new PnpmExtension({
		_tag: "pnpm",
		catalogs: raw.catalogs,
		overrides: raw.overrides,
		settings: raw.settings,
	});

	return new LockfileData({
		packageManager: "pnpm",
		lockfileVersion: String(raw.lockfileVersion),
		packages,
		workspaceDependencies: [...wsDeps],
		pmSpecific,
	});
};
