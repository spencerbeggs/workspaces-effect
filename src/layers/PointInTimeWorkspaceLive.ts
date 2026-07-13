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
import { Cache, Data, Duration, Effect, Exit, Layer, Option } from "effect";
import { parse as parseYaml } from "yaml-effect";
import { CatalogSet } from "../schemas/CatalogSet.js";
import { PackageStateSnapshot, WorkspaceStateSnapshot } from "../schemas/WorkspaceStateSnapshot.js";
import type { PointInTimeOptions } from "../services/PointInTimeWorkspace.js";
import { PointInTimeWorkspace } from "../services/PointInTimeWorkspace.js";
import { WorkspaceDiscovery } from "../services/WorkspaceDiscovery.js";
import { WorkspaceRoot } from "../services/WorkspaceRoot.js";
import { inlineCatalogs } from "./catalog/assemble.js";
import { catalogSetFromPackageJson, parsePackageJsonWorkspaces } from "./catalog/package-json-workspaces.js";
import type { WorkspaceManifestData } from "./catalog/workspace-manifest.js";
import { workspaceManifestFromYaml } from "./catalog/workspace-manifest.js";
import { compileWorkspaceGlobs } from "./discovery/glob-core.js";
import { makeGitReader } from "./point-in-time/git.js";
import { readWorktreeCatalogState } from "./point-in-time/worktree-catalogs.js";

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
 * Catalogs of a lockfile text read at a ref. Malformed → empty set
 * (mirrors worktree-catalogs.ts; the at-ref side has no filesystem read,
 * so only the parse-degradation branch applies here).
 *
 * @internal
 */
const lockfileCatalogsAtRef = (text: Option.Option<string>): Effect.Effect<CatalogSet> =>
	Option.isNone(text)
		? Effect.succeed(CatalogSet.empty())
		: parseYaml(text.value).pipe(
				Effect.map((parsed) => CatalogSet.fromLockfileCatalogs((parsed as { catalogs?: unknown } | null)?.catalogs)),
				Effect.orElseSucceed(() => CatalogSet.empty()),
			);

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
 * Capacity of the per-layer at-ref snapshot cache. Refs are immutable, so
 * entries never expire — capacity is the only knob; least-recently-used
 * entries evict past it. Bounds memory for long-lived processes (an MCP
 * server accumulating refs) where the previous unbounded Map grew forever.
 *
 * @internal
 */
export const AT_CACHE_CAPACITY = 64;

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

		const resolveRoot = (cwd?: string) => workspaceRoot.find(cwd ?? process.cwd());

		const readAtRef = (root: string, ref: string) =>
			Effect.gen(function* () {
				const wsYaml = yield* reader.show(root, ref, "pnpm-workspace.yaml");

				// pnpm declares globs and catalogs in pnpm-workspace.yaml; npm and bun
				// declare them in the root package.json `workspaces` field. Without this
				// fallback a bun repo yields manifest.packages === undefined at a ref,
				// so dirs collapses to ["."] and the snapshot holds only the root package.
				const rootPkgJson = Option.isSome(wsYaml)
					? Option.none<string>()
					: yield* reader.show(root, ref, "package.json");

				const manifest: WorkspaceManifestData = Option.isSome(wsYaml)
					? yield* workspaceManifestFromYaml(wsYaml.value)
					: Option.isSome(rootPkgJson)
						? yield* parsePackageJsonWorkspaces(rootPkgJson.value)
						: { catalog: undefined, catalogs: undefined, configDependencies: undefined, packages: undefined };

				const inline = Option.isSome(wsYaml)
					? CatalogSet.fromCatalogs(inlineCatalogs({ catalog: manifest.catalog, catalogs: manifest.catalogs }))
					: Option.isSome(rootPkgJson)
						? yield* catalogSetFromPackageJson(rootPkgJson.value)
						: CatalogSet.empty();

				const lockText = yield* reader.show(root, ref, "pnpm-lock.yaml");
				const lockCatalogs = yield* lockfileCatalogsAtRef(lockText);

				// Expand package globs at the ref through the shared core: literal dirs
				// pass through; each wildcard lists its parent via ls-tree; negations
				// remove matches. The root (".") is always included.
				const compiled = compileWorkspaceGlobs(manifest.packages ?? []);
				const dirs: string[] = ["."];
				for (const literal of compiled.literals) {
					if (!dirs.includes(literal)) dirs.push(literal);
				}
				for (const wildcard of compiled.wildcards) {
					// `git ls-tree --name-only <ref> ""` is fatal ("empty string is not
					// a valid pathspec"); "." is the git-documented substitute and lists
					// top-level entries as bare names (e.g. "pkg-a"), which is exactly
					// the candidate form a prefix-"" wildcard's predicate expects --
					// matching WorkspaceDiscoveryLive's `fs.readDirectory(root)` behavior
					// for the same root-level pattern.
					const entries = yield* reader.lsTree(root, ref, wildcard.prefix === "" ? "." : wildcard.prefix);
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

				return new WorkspaceStateSnapshot({
					packages,
					catalogs: CatalogSet.merge(lockCatalogs, inline),
				});
			});

		// effect Cache gives the capacity bound AND deduplication of concurrent
		// in-flight lookups for the same (root, ref) — the reason it was chosen
		// over the repo's Request/RequestResolver pattern, which exists for
		// request BATCHING (DependencyGraph, LockfileReader), not bounded caching.
		//
		// Cache.make applies a single fixed TTL to both success AND failure exits
		// (verified against the installed effect@3.21.4: internal/cache.js
		// lookupValueOf calls `this.timeToLive(exit)` unconditionally), so a plain
		// `Cache.make` with `timeToLive: Duration.infinity` would memoize failures
		// forever and break retry behavior the old Map never had a problem with
		// (it only cached on the success path). Using `Cache.makeWith` with an
		// exit-dependent TTL -- infinity on success, zero on failure -- restores
		// that: failed lookups are evicted immediately so the next `at()` call
		// retries instead of replaying a stale error.
		const cache = yield* Cache.makeWith({
			capacity: AT_CACHE_CAPACITY,
			lookup: (key: { readonly root: string; readonly ref: string }) => readAtRef(key.root, key.ref),
			timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
		});

		const at = (ref: string, options?: PointInTimeOptions) =>
			Effect.gen(function* () {
				const root = yield* resolveRoot(options?.cwd);
				return yield* cache.get(Data.struct({ root, ref }));
			}).pipe(Effect.withSpan("PointInTimeWorkspace.at", { attributes: { ref } }));

		const worktree = (options?: PointInTimeOptions) =>
			Effect.gen(function* () {
				const root = yield* resolveRoot(options?.cwd);
				// A worktree snapshot means "the live state now". WorkspaceDiscovery
				// caches listPackages per root for the layer lifetime, so a snapshot
				// taken after manifests changed on disk would otherwise serve the
				// pre-change manifests (and diff as a no-op against the base ref).
				yield* discovery.refresh();
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
				const state = yield* readWorktreeCatalogState(root).pipe(
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
				);
				return new WorkspaceStateSnapshot({ packages, catalogs: state.merged });
			}).pipe(Effect.withSpan("PointInTimeWorkspace.worktree"));

		return PointInTimeWorkspace.of({ at, worktree });
	}),
);
