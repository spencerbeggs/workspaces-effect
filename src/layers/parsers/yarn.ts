/**
 * Parser for Yarn Berry `yarn.lock` lockfiles.
 *
 * Parses YAML content, validates individual entries against
 * {@link YarnEntrySchema}, and transforms into the unified
 * {@link LockfileData} model.
 *
 * @privateRemarks
 * Yarn Berry lockfiles are YAML with a flat key structure where each
 * key encodes package name + resolution descriptor (e.g.,
 * `"@scope/name@npm:^1.0.0"`). Workspace entries are identified by
 * `linkType: "soft"`. Uses a two-pass approach: first pass identifies
 * workspace names, second pass builds `ResolvedPackage` entries.
 *
 * @packageDocumentation
 * @internal
 */

import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml-effect";
import { LockfileParseError } from "../../errors/LockfileParseError.js";
import { LockfileData, ResolvedPackage } from "../../schemas/lockfile.js";
import type { WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps } from "./shared.js";

/**
 * Raw schema for individual yarn lockfile entries (permissive).
 *
 * @internal
 */

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

/**
 * Parse a Yarn Berry `yarn.lock` lockfile into the unified {@link LockfileData} model.
 *
 * @privateRemarks
 * Pipeline: YAML parse -\> per-entry Schema validation -\> transform to `LockfileData`.
 * The `__metadata` key is extracted for `lockfileVersion` and skipped during
 * package iteration.
 *
 * @internal
 */
export const parseYarnLockfile = (
	content: string,
	lockfilePath: string,
): Effect.Effect<LockfileData, LockfileParseError> =>
	Effect.gen(function* () {
		const raw = (yield* parseYaml(content).pipe(
			Effect.mapError(
				(e) =>
					new LockfileParseError({
						lockfilePath,
						format: "yarn",
						cause: e,
					}),
			),
		)) as Record<string, unknown>;

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

		yield* Effect.logDebug("Parsed yarn lockfile").pipe(
			Effect.annotateLogs({
				"workspace.workspaces.count": workspaceNames.size,
				"workspace.packages.count": packages.length,
			}),
		);

		return new LockfileData({
			packageManager: "yarn",
			lockfileVersion,
			packages,
			workspaceDependencies: [...wsDeps],
		});
	}).pipe(
		Effect.withSpan("LockfileReader.parse.yarn", {
			attributes: { "workspace.lockfile": lockfilePath },
		}),
	);

/**
 * Extract package name from a yarn lockfile key.
 *
 * Handles keys like `"@scope/name@npm:^1.0.0"` or
 * `"@scope/name@workspace:packages/foo"` by finding the last
 * `@npm:` or `@workspace:` segment.
 *
 * @internal
 */
const extractYarnPackageName = (key: string): string | undefined => {
	// Find the last @npm: or @workspace: segment
	const npmIdx = key.lastIndexOf("@npm:");
	const wsIdx = key.lastIndexOf("@workspace:");
	const idx = Math.max(npmIdx, wsIdx);
	if (idx <= 0) return undefined;
	return key.slice(0, idx);
};

/**
 * Strip `"npm:"` prefix from yarn dependency values.
 *
 * @internal
 */
const cleanYarnDeps = (deps: Record<string, string> | undefined): Record<string, string> | undefined => {
	if (!deps) return undefined;
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(deps)) {
		result[name] = value.startsWith("npm:") ? value.slice(4) : value;
	}
	return result;
};
