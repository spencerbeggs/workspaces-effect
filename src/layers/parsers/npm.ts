import { Effect, Schema } from "effect";
import { LockfileParseError } from "../../errors/index.js";
import { LockfileData, ResolvedPackage } from "../../schemas/lockfile.js";
import type { WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps } from "./shared.js";

// -- Raw schema (internal) --

const NpmPackageEntry = Schema.Struct({
	name: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	resolved: Schema.optional(Schema.String),
	integrity: Schema.optional(Schema.String),
	link: Schema.optional(Schema.Boolean),
	dev: Schema.optional(Schema.Boolean),
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
	workspaces: Schema.optional(Schema.Unknown),
	license: Schema.optional(Schema.String),
	bin: Schema.optional(Schema.Unknown),
	engines: Schema.optional(Schema.Unknown),
	funding: Schema.optional(Schema.Unknown),
});

const NpmLockfileRaw = Schema.Struct({
	name: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	lockfileVersion: Schema.Union(Schema.Number, Schema.String),
	requires: Schema.optional(Schema.Boolean),
	packages: Schema.Record({
		key: Schema.String,
		value: NpmPackageEntry,
	}),
});

type NpmLockfileRawType = Schema.Schema.Type<typeof NpmLockfileRaw>;

// -- Parser --

export const parseNpmLockfile = (
	content: string,
	lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
	Effect.gen(function* () {
		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (e) =>
				new LockfileParseError({
					lockfilePath,
					format: "npm",
					cause: e,
				}),
		});

		const validated = yield* Schema.decodeUnknown(NpmLockfileRaw)(raw).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "npm",
						cause: e,
					}),
			),
		);

		const workspaceCount = Object.values(validated.packages).filter((p) => p.link === true).length;
		yield* Effect.logDebug("Parsed npm lockfile").pipe(
			Effect.annotateLogs({
				"workspace.workspaces.count": workspaceCount,
				"workspace.packages.count": Object.keys(validated.packages).length,
			}),
		);

		return toLockfileData(validated);
	}).pipe(
		Effect.withSpan("LockfileReader.parse.npm", {
			attributes: { "workspace.lockfile": lockfilePath },
		}),
	);

// -- Transform --

const toLockfileData = (raw: NpmLockfileRawType): LockfileData => {
	const packages: ResolvedPackage[] = [];
	const workspaceNames = new Set<string>();
	const workspaceEntries = new Map<string, WorkspaceEntry>();

	// First pass: identify workspace link entries
	for (const [key, entry] of Object.entries(raw.packages)) {
		if (key.startsWith("node_modules/") && entry.link === true) {
			const name = entry.name ?? key.slice("node_modules/".length);
			workspaceNames.add(name);
		}
	}

	// Second pass: build packages and workspace entries
	for (const [key, entry] of Object.entries(raw.packages)) {
		if (key === "") continue; // skip root

		if (key.startsWith("node_modules/") && entry.link === true) {
			// Workspace link -- get the actual package data from the workspace path entry
			const resolved = entry.resolved;
			const wsEntry = resolved ? raw.packages[resolved] : undefined;
			const name = wsEntry?.name ?? entry.name ?? key.slice("node_modules/".length);
			packages.push(
				new ResolvedPackage({
					name,
					version: wsEntry?.version ?? "0.0.0",
					isWorkspace: true,
				}),
			);
			if (wsEntry) {
				workspaceEntries.set(name, {
					...(wsEntry.dependencies ? { dependencies: wsEntry.dependencies } : {}),
					...(wsEntry.devDependencies ? { devDependencies: wsEntry.devDependencies } : {}),
					...(wsEntry.peerDependencies ? { peerDependencies: wsEntry.peerDependencies } : {}),
					...(wsEntry.optionalDependencies ? { optionalDependencies: wsEntry.optionalDependencies } : {}),
				});
			}
		} else if (key.startsWith("node_modules/")) {
			// Regular resolved package
			const name = key.slice("node_modules/".length);
			if (entry.version) {
				packages.push(
					new ResolvedPackage({
						name,
						version: entry.version,
						integrity: entry.integrity,
						isWorkspace: false,
						dependencies: entry.dependencies ?? {},
					}),
				);
			}
		}
		// Skip workspace path entries (packages/foo) --
		// they're handled via the link entries above
	}

	const wsDeps = extractWorkspaceDeps(workspaceEntries, workspaceNames);

	return new LockfileData({
		packageManager: "npm",
		lockfileVersion: String(raw.lockfileVersion),
		packages,
		workspaceDependencies: [...wsDeps],
	});
};
