import { Effect, Schema } from "effect";
import YAML from "yaml";
import { LockfileParseError } from "../../errors/index.js";
import { LockfileData, ResolvedPackage } from "../../schemas/lockfile.js";
import type { WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps } from "./shared.js";

// -- Raw schema (internal, permissive) --

const YarnEntrySchema = Schema.Struct({
	version: Schema.optional(Schema.String),
	resolution: Schema.optional(Schema.String),
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
	checksum: Schema.optional(Schema.String),
	languageName: Schema.optional(Schema.String),
	linkType: Schema.optional(Schema.String),
	bin: Schema.optional(Schema.Unknown),
});

// -- Parser --

export const parseYarnLockfile = (
	content: string,
	lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
	Effect.gen(function* () {
		const raw = yield* Effect.try({
			try: () => YAML.parse(content) as Record<string, unknown>,
			catch: (e) =>
				new LockfileParseError({
					lockfilePath,
					format: "yarn",
					cause: e,
				}),
		});

		// Extract metadata
		const metadata = raw.__metadata as { version?: number | string } | undefined;
		const lockfileVersion = String(metadata?.version ?? "unknown");

		const packages: ResolvedPackage[] = [];
		const workspaceNames = new Set<string>();
		const workspaceEntries = new Map<string, WorkspaceEntry>();

		// First pass: identify workspace entries
		for (const [key, value] of Object.entries(raw)) {
			if (key === "__metadata") continue;
			const entry = yield* Schema.decodeUnknown(YarnEntrySchema)(value).pipe(
				Effect.mapError(
					(e) =>
						new LockfileParseError({
							lockfilePath,
							format: "yarn",
							cause: e,
						}),
				),
			);

			if (entry.linkType === "soft") {
				const name = extractYarnPackageName(key);
				if (name) workspaceNames.add(name);
			}
		}

		// Second pass: build packages
		for (const [key, value] of Object.entries(raw)) {
			if (key === "__metadata") continue;
			const entry = yield* Schema.decodeUnknown(YarnEntrySchema)(value).pipe(
				Effect.mapError(
					(e) =>
						new LockfileParseError({
							lockfilePath,
							format: "yarn",
							cause: e,
						}),
				),
			);

			const name = extractYarnPackageName(key);
			if (!name) continue;

			const isWorkspace = entry.linkType === "soft";

			packages.push(
				new ResolvedPackage({
					name,
					version: entry.version ?? "0.0.0",
					integrity: entry.checksum,
					isWorkspace,
				}),
			);

			if (isWorkspace) {
				const deps = cleanYarnDeps(entry.dependencies);
				const devDeps = cleanYarnDeps(entry.devDependencies);
				const peerDeps = cleanYarnDeps(entry.peerDependencies);
				const optDeps = cleanYarnDeps(entry.optionalDependencies);
				workspaceEntries.set(name, {
					...(deps ? { dependencies: deps } : {}),
					...(devDeps ? { devDependencies: devDeps } : {}),
					...(peerDeps ? { peerDependencies: peerDeps } : {}),
					...(optDeps ? { optionalDependencies: optDeps } : {}),
				});
			}
		}

		const wsDeps = extractWorkspaceDeps(workspaceEntries, workspaceNames);

		return new LockfileData({
			packageManager: "yarn",
			lockfileVersion,
			packages,
			workspaceDependencies: [...wsDeps],
		});
	});

/** Extract package name from yarn key like
 * "\@scope/name\@npm:^1.0.0" or
 * "\@scope/name\@workspace:packages/foo" */
const extractYarnPackageName = (key: string): string | undefined => {
	// Find the last @npm: or @workspace: segment
	const npmIdx = key.lastIndexOf("@npm:");
	const wsIdx = key.lastIndexOf("@workspace:");
	const idx = Math.max(npmIdx, wsIdx);
	if (idx <= 0) return undefined;
	return key.slice(0, idx);
};

/** Strip "npm:" prefix from yarn dependency values. */
const cleanYarnDeps = (deps: Record<string, string> | undefined): Record<string, string> | undefined => {
	if (!deps) return undefined;
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(deps)) {
		result[name] = value.startsWith("npm:") ? value.slice(4) : value;
	}
	return result;
};
