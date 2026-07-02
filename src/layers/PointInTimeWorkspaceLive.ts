/**
 * Live layer for the {@link PointInTimeWorkspace} service.
 *
 * Reads workspace state at a git ref via `git show`/`git ls-tree` (over
 * `CommandExecutor`), or of the live working tree via `WorkspaceDiscovery`.
 * Each snapshot carries that moment's assembled pnpm catalog set, with
 * lockfile-then-inline precedence (inline `pnpm-workspace.yaml` catalogs win).
 *
 * @packageDocumentation
 * @internal
 */

import { CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import { parse as parseYaml } from "yaml-effect";
import type { CatalogAssemblyError } from "../errors/CatalogAssemblyError.js";
import { CatalogSet } from "../schemas/CatalogSet.js";
import { PackageStateSnapshot, WorkspaceStateSnapshot } from "../schemas/WorkspaceStateSnapshot.js";
import type { PointInTimeOptions } from "../services/PointInTimeWorkspace.js";
import { PointInTimeWorkspace } from "../services/PointInTimeWorkspace.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { inlineCatalogs } from "./catalog/assemble.js";
import { readWorkspaceManifest, workspaceManifestFromYaml } from "./catalog/workspace-manifest.js";
import { compileWorkspaceGlobs } from "./discovery/glob-core.js";
import { makeGitReader } from "./point-in-time/git.js";

/**
 * Build a {@link PackageStateSnapshot} from raw `package.json` text.
 *
 * @remarks
 * Returns `null` when the text is not valid JSON or has no `name` (both are
 * skip-not-fail conditions for point-in-time reads). `version` defaults to
 * `"0.0.0"` and each dependency record defaults to `{}`.
 *
 * @internal
 */
const packageSnapshotFromJson = (text: string, relativePath: string): PackageStateSnapshot | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (raw === null || typeof raw !== "object") return null;
	const pkg = raw as Record<string, unknown>;
	if (typeof pkg.name !== "string" || pkg.name.length === 0) return null;
	const depRecord = (value: unknown): Record<string, string> => {
		if (value === null || typeof value !== "object") return {};
		const out: Record<string, string> = {};
		for (const [dep, spec] of Object.entries(value as Record<string, unknown>)) {
			if (typeof spec === "string") out[dep] = spec;
		}
		return out;
	};
	return new PackageStateSnapshot({
		name: pkg.name,
		version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
		relativePath,
		dependencies: depRecord(pkg.dependencies),
		devDependencies: depRecord(pkg.devDependencies),
		peerDependencies: depRecord(pkg.peerDependencies),
		optionalDependencies: depRecord(pkg.optionalDependencies),
	});
};

/**
 * Convenience type alias for the {@link PointInTimeWorkspaceLive} layer signature.
 *
 * @public
 */
export type PointInTimeWorkspaceLiveLayer = Layer.Layer<
	PointInTimeWorkspace,
	never,
	WorkspaceRoot | WorkspaceDiscovery | CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
>;

/**
 * Live layer for the {@link PointInTimeWorkspace} service.
 *
 * Resolves `WorkspaceRoot`, `WorkspaceDiscovery`, `CommandExecutor`,
 * `FileSystem`, and `Path` at layer construction so both service methods have
 * `R = never`. Wired into `WorkspacesFullLive`.
 *
 * @public
 */
export const PointInTimeWorkspaceLive: PointInTimeWorkspaceLiveLayer = Layer.effect(
	PointInTimeWorkspace,
	Effect.gen(function* () {
		const workspaceRoot = yield* WorkspaceRoot;
		const discovery = yield* WorkspaceDiscovery;
		const executor = yield* CommandExecutor.CommandExecutor;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const reader = makeGitReader(executor);
		const cache = new Map<string, WorkspaceStateSnapshot>();

		const resolveRoot = (cwd?: string) => workspaceRoot.find(cwd ?? process.cwd());

		// Catalogs of a lockfile TEXT (shared by at/worktree). A malformed lockfile
		// degrades to "no lockfile catalogs" — the inline catalogs still resolve; do
		// not fail the whole snapshot.
		const lockfileCatalogsFromText = (text: string | null): Effect.Effect<CatalogSet, CatalogAssemblyError> =>
			text === null
				? Effect.succeed(CatalogSet.empty())
				: parseYaml(text).pipe(
						Effect.map((parsed) =>
							CatalogSet.fromLockfileCatalogs((parsed as { catalogs?: unknown } | null)?.catalogs),
						),
						Effect.orElseSucceed(() => CatalogSet.empty()),
					);

		const at = (ref: string, options?: PointInTimeOptions) =>
			Effect.gen(function* () {
				const root = yield* resolveRoot(options?.cwd);
				const key = `${root}::${ref}`;
				const hit = cache.get(key);
				if (hit) return hit;

				const wsYaml = yield* reader.show(root, ref, "pnpm-workspace.yaml");
				const manifest = Option.isSome(wsYaml)
					? yield* workspaceManifestFromYaml(wsYaml.value)
					: { catalog: undefined, catalogs: undefined, configDependencies: undefined, packages: undefined };
				const inline = CatalogSet.fromCatalogs(
					inlineCatalogs({ catalog: manifest.catalog, catalogs: manifest.catalogs }),
				);
				const lockText = yield* reader.show(root, ref, "pnpm-lock.yaml");
				const lockCatalogs = yield* lockfileCatalogsFromText(Option.getOrNull(lockText));

				// Expand package globs at the ref through the shared core: literal dirs
				// pass through; each wildcard lists its parent via ls-tree; negations
				// remove matches. The root (".") is always included.
				const compiled = compileWorkspaceGlobs(manifest.packages ?? []);
				const dirs: string[] = ["."];
				for (const literal of compiled.literals) {
					if (!dirs.includes(literal)) dirs.push(literal);
				}
				for (const wildcard of compiled.wildcards) {
					const entries = yield* reader.lsTree(root, ref, wildcard.prefix);
					for (const entry of entries) {
						if (wildcard.matches(entry) && !dirs.includes(entry)) dirs.push(entry);
					}
				}
				const included = dirs.filter((dir) => dir === "." || !compiled.isExcluded(dir));

				const packages: PackageStateSnapshot[] = [];
				for (const dir of included) {
					const pkgPath = dir === "." ? "package.json" : `${dir}/package.json`;
					const text = yield* reader.show(root, ref, pkgPath);
					if (Option.isNone(text)) continue;
					const snap = packageSnapshotFromJson(text.value, dir);
					if (snap) packages.push(snap);
				}

				const snapshot = new WorkspaceStateSnapshot({
					packages,
					catalogs: CatalogSet.merge(lockCatalogs, inline),
				});
				cache.set(key, snapshot);
				return snapshot;
			}).pipe(Effect.withSpan("PointInTimeWorkspace.at", { attributes: { ref } }));

		const worktree = (options?: PointInTimeOptions) =>
			Effect.gen(function* () {
				const root = yield* resolveRoot(options?.cwd);
				const pkgs = yield* discovery.listPackages(root);
				const packages = pkgs.map(
					(p) =>
						new PackageStateSnapshot({
							name: p.name,
							version: p.version,
							relativePath: p.relativePath,
							dependencies: { ...p.dependencies },
							devDependencies: { ...p.devDependencies },
							peerDependencies: { ...p.peerDependencies },
							optionalDependencies: { ...p.optionalDependencies },
						}),
				);
				const manifest = yield* readWorkspaceManifest(root).pipe(
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
				);
				const inline = CatalogSet.fromCatalogs(
					inlineCatalogs({ catalog: manifest.catalog, catalogs: manifest.catalogs }),
				);
				const lockPath = path.join(root, "pnpm-lock.yaml");
				const lockText = yield* fs.readFileString(lockPath).pipe(Effect.orElseSucceed(() => null));
				const lockCatalogs = yield* lockfileCatalogsFromText(lockText);
				return new WorkspaceStateSnapshot({ packages, catalogs: CatalogSet.merge(lockCatalogs, inline) });
			}).pipe(Effect.withSpan("PointInTimeWorkspace.worktree"));

		return PointInTimeWorkspace.of({ at, worktree });
	}),
);
