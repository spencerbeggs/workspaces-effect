import { Effect, Schema } from "effect";
import { parse as parseJsonc } from "jsonc-effect";
import { LockfileParseError } from "../../errors/index.js";
import { BunExtension, LockfileData, ResolvedPackage } from "../../schemas/lockfile.js";
import type { WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps } from "./shared.js";

// -- Raw schema (internal) --

const BunWorkspaceEntrySchema = Schema.Struct({
	name: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	dependencies: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
	devDependencies: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
	peerDependencies: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
	optionalDependencies: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
});

const BunLockfileRawSchema = Schema.Struct({
	lockfileVersion: Schema.Number,
	workspaces: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: BunWorkspaceEntrySchema,
		}),
	),
	packages: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Array(Schema.Unknown),
		}),
	),
	catalog: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Unknown,
		}),
	),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({
				key: Schema.String,
				value: Schema.Unknown,
			}),
		}),
	),
	overrides: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.String,
		}),
	),
	trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
});

type BunLockfileRaw = Schema.Schema.Type<typeof BunLockfileRawSchema>;

// -- Parser --

export const parseBunLockfile = (
	content: string,
	lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
	Effect.gen(function* () {
		// Step 1: Parse JSONC via jsonc-effect
		const parsed = yield* parseJsonc(content).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "bun",
						cause: e,
					}),
			),
		);

		// Step 2: Validate against schema
		const lockfile = yield* Schema.decodeUnknown(BunLockfileRawSchema)(parsed).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "bun",
						cause: e,
					}),
			),
		);

		const workspaceCount = lockfile.workspaces ? Object.keys(lockfile.workspaces).length - 1 : 0;
		yield* Effect.logDebug("Parsed bun lockfile").pipe(
			Effect.annotateLogs({
				"workspace.workspaces.count": Math.max(0, workspaceCount),
				"workspace.packages.count": Object.keys(lockfile.packages ?? {}).length,
			}),
		);

		return toLockfileData(lockfile);
	}).pipe(
		Effect.withSpan("LockfileReader.parse.bun", {
			attributes: { "workspace.lockfile": lockfilePath },
		}),
	);

const toLockfileData = (raw: BunLockfileRaw): LockfileData => {
	const packages: ResolvedPackage[] = [];
	const workspaceNames = new Set<string>();
	const workspaceEntries = new Map<string, WorkspaceEntry>();

	// Process workspace entries
	if (raw.workspaces) {
		for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
			if (wsPath === "") continue; // skip root
			const name = wsEntry.name ?? wsPath;
			workspaceNames.add(name);
			packages.push(
				new ResolvedPackage({
					name,
					version: wsEntry.version ?? "0.0.0",
					isWorkspace: true,
				}),
			);
			workspaceEntries.set(name, {
				...(wsEntry.dependencies ? { dependencies: wsEntry.dependencies } : {}),
				...(wsEntry.devDependencies ? { devDependencies: wsEntry.devDependencies } : {}),
				...(wsEntry.peerDependencies ? { peerDependencies: wsEntry.peerDependencies } : {}),
				...(wsEntry.optionalDependencies ? { optionalDependencies: wsEntry.optionalDependencies } : {}),
			});
		}
	}

	// Process package tuples
	if (raw.packages) {
		for (const [, tuple] of Object.entries(raw.packages)) {
			if (!Array.isArray(tuple) || tuple.length < 1) continue;
			const id = String(tuple[0]); // "name@version"
			const integrity = tuple.length >= 4 ? String(tuple[3]) : undefined;

			// Parse "name@version" -- handle scoped packages
			const atIdx = id.lastIndexOf("@");
			if (atIdx <= 0) continue;
			const name = id.slice(0, atIdx);
			const version = id.slice(atIdx + 1);

			// Skip if this is a workspace package (already added above)
			if (workspaceNames.has(name)) continue;

			packages.push(
				new ResolvedPackage({
					name,
					version,
					integrity,
					isWorkspace: false,
				}),
			);
		}
	}

	const wsDeps = extractWorkspaceDeps(workspaceEntries, workspaceNames);

	const pmSpecific = new BunExtension({
		_tag: "bun",
		catalog: raw.catalog,
		catalogs: raw.catalogs,
		overrides: raw.overrides,
		trustedDependencies: raw.trustedDependencies,
	});

	return new LockfileData({
		packageManager: "bun",
		lockfileVersion: String(raw.lockfileVersion),
		packages,
		workspaceDependencies: [...wsDeps],
		pmSpecific,
	});
};
