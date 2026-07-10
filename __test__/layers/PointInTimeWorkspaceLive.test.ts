import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogAssemblyError } from "../../src/errors/CatalogAssemblyError.js";
import type { GitReadError } from "../../src/errors/GitReadError.js";
import type { WorkspaceDiscoveryError } from "../../src/errors/WorkspaceDiscoveryError.js";
import type { WorkspaceRootNotFoundError } from "../../src/errors/WorkspaceRootNotFoundError.js";
import { PointInTimeWorkspaceLive } from "../../src/layers/PointInTimeWorkspaceLive.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
import type { WorkspaceStateSnapshot } from "../../src/schemas/WorkspaceStateSnapshot.js";
import { PointInTimeWorkspace } from "../../src/services/PointInTimeWorkspace.js";
import { WorkspaceRoot } from "../../src/services/WorkspaceRoot.js";

let root: string;
let baseSha: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pit-ws-"));
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-root", version: "0.0.0" }));
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n  - packages/*\n  - "!packages/excluded-pkg"\ncatalogs:\n  silk:\n    effect: ^3.20.0\n`,
	);
	writeFileSync(
		join(root, "pnpm-lock.yaml"),
		`lockfileVersion: '9.0'\ncatalogs:\n  silk:\n    effect:\n      specifier: ^3.20.0\n      version: 3.20.0\n`,
	);
	mkdirSync(join(root, "packages", "a"), { recursive: true });
	writeFileSync(
		join(root, "packages", "a", "package.json"),
		JSON.stringify({ name: "@fixture/a", version: "1.0.0", dependencies: { effect: "catalog:silk" } }),
	);
	mkdirSync(join(root, "packages", "excluded-pkg"), { recursive: true });
	writeFileSync(
		join(root, "packages", "excluded-pkg", "package.json"),
		JSON.stringify({ name: "@fixture/excluded", version: "1.0.0" }),
	);
	mkdirSync(join(root, "packages", "no-manifest"), { recursive: true });
	writeFileSync(join(root, "packages", "no-manifest", "README.md"), "no package.json here\n");
	git("init", "-b", "main");
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "base");
	baseSha = git("rev-parse", "HEAD");
	// Working-tree mutation: bump the catalog, bump the package version.
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n  - packages/*\n  - "!packages/excluded-pkg"\ncatalogs:\n  silk:\n    effect: ^3.21.0\n`,
	);
	writeFileSync(
		join(root, "packages", "a", "package.json"),
		JSON.stringify({ name: "@fixture/a", version: "1.1.0", dependencies: { effect: "catalog:silk" } }),
	);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let findArgs: string[] = [];
const RootStub = Layer.succeed(WorkspaceRoot, {
	find: (cwd: string) => {
		findArgs.push(cwd);
		return Effect.succeed(root);
	},
} as never);
const live = PointInTimeWorkspaceLive.pipe(
	Layer.provide(Layer.mergeAll(RootStub, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStub)))),
	Layer.provide(NodeContext.layer),
);
const run = <A, E>(effect: Effect.Effect<A, E, PointInTimeWorkspace>) =>
	Effect.runPromise(effect.pipe(Effect.provide(live)) as Effect.Effect<A, E, never>);

describe("PointInTimeWorkspaceLive", () => {
	it("at(ref) reads packages and catalogs as of the ref", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at(baseSha, { cwd: root });
			}),
		);
		expect(Option.getOrNull(snap.package("@fixture/a"))?.version).toBe("1.0.0");
		expect(Option.getOrNull(snap.resolve("effect", "catalog:silk"))).toBe("^3.20.0");
	});

	it("worktree() reads the live state", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.worktree({ cwd: root });
			}),
		);
		expect(Option.getOrNull(snap.package("@fixture/a"))?.version).toBe("1.1.0");
		expect(Option.getOrNull(snap.resolve("effect", "catalog:silk"))).toBe("^3.21.0");
	});

	it("at(ref) tolerates packages absent at the ref", async () => {
		mkdirSync(join(root, "packages", "b"), { recursive: true });
		writeFileSync(
			join(root, "packages", "b", "package.json"),
			JSON.stringify({ name: "@fixture/b", version: "0.1.0" }),
		);
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at(baseSha, { cwd: root });
			}),
		);
		expect(Option.isNone(snap.package("@fixture/b"))).toBe(true);
	});

	it("at() resolves the workspace root by walking up from options.cwd", async () => {
		findArgs = [];
		const nested = join(root, "packages", "a");
		await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at(baseSha, { cwd: nested });
			}),
		);
		expect(findArgs[0]).toBe(nested);
	});

	it("worktree() resolves the workspace root by walking up from options.cwd", async () => {
		findArgs = [];
		const nested = join(root, "packages", "a");
		await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.worktree({ cwd: nested });
			}),
		);
		expect(findArgs[0]).toBe(nested);
	});

	it("narrows error unions per method (type-level)", async () => {
		await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				// Compile-time contract: worktree's channel has no GitReadError,
				// at's channel has no WorkspaceDiscoveryError.
				const _wt: Effect.Effect<
					WorkspaceStateSnapshot,
					CatalogAssemblyError | WorkspaceRootNotFoundError | WorkspaceDiscoveryError
				> = pit.worktree();
				const _at: Effect.Effect<
					WorkspaceStateSnapshot,
					GitReadError | CatalogAssemblyError | WorkspaceRootNotFoundError
				> = pit.at(baseSha);
				void _wt;
				void _at;
				return yield* pit.at(baseSha);
			}),
		);
	});

	it("at(ref) honors negation patterns like live discovery", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at(baseSha);
			}),
		);
		expect(Option.isNone(snap.package("@fixture/excluded"))).toBe(true);
		expect(Option.isSome(snap.package("@fixture/a"))).toBe(true);
	});

	it("at(ref) skips a directory listed in the tree whose package.json is absent at the ref", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at(baseSha);
			}),
		);
		expect(snap.packages.map((p) => p.relativePath)).not.toContain("packages/no-manifest");
	});

	it("worktree() honors negation patterns (producer parity)", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.worktree();
			}),
		);
		expect(Option.isNone(snap.package("@fixture/excluded"))).toBe(true);
	});

	it("at(ref) returns the identical cached snapshot instance on repeat calls", async () => {
		const [first, second] = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return [yield* pit.at(baseSha), yield* pit.at(baseSha)] as const;
			}),
		);
		expect(second).toBe(first);
	});

	it("missing-path verdicts are locale-independent (LC_ALL pinned to C)", async () => {
		const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
		process.env.LANG = "de_DE.UTF-8";
		process.env.LC_ALL = "de_DE.UTF-8";
		try {
			// Use a fresh layer instance so this test performs a live read rather
			// than being served from the per-(root, ref) snapshot cache.
			const freshLive = PointInTimeWorkspaceLive.pipe(
				Layer.provide(Layer.mergeAll(RootStub, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStub)))),
				Layer.provide(NodeContext.layer),
			);
			const freshRun = <A, E>(effect: Effect.Effect<A, E, PointInTimeWorkspace>) =>
				Effect.runPromise(effect.pipe(Effect.provide(freshLive)) as Effect.Effect<A, E, never>);
			const snap = await freshRun(
				Effect.gen(function* () {
					const pit = yield* PointInTimeWorkspace;
					return yield* pit.at(baseSha);
				}),
			);
			// The no-manifest dir resolves to a skip, not an error, regardless of
			// the parent process locale -- the reader pins LC_ALL=C on the child.
			expect(snap.packages.map((p) => p.relativePath)).not.toContain("packages/no-manifest");
		} finally {
			if (saved.LANG === undefined) delete process.env.LANG;
			else process.env.LANG = saved.LANG;
			if (saved.LC_ALL === undefined) delete process.env.LC_ALL;
			else process.env.LC_ALL = saved.LC_ALL;
		}
	});
});

describe("relativePath producer parity", () => {
	let parityRoot: string;

	beforeAll(() => {
		parityRoot = mkdtempSync(join(tmpdir(), "pit-parity-"));
		writeFileSync(join(parityRoot, "package.json"), JSON.stringify({ name: "parity-root", version: "0.0.0" }));
		writeFileSync(join(parityRoot, "pnpm-workspace.yaml"), `packages:\n  - packages/*\n`);
		mkdirSync(join(parityRoot, "packages", "a"), { recursive: true });
		writeFileSync(
			join(parityRoot, "packages", "a", "package.json"),
			JSON.stringify({ name: "@parity/a", version: "1.0.0" }),
		);
		const g = (...args: string[]) => execFileSync("git", args, { cwd: parityRoot, encoding: "utf8" });
		g("init", "-b", "main");
		g("add", "-A");
		g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "parity base");
	});
	afterAll(() => rmSync(parityRoot, { recursive: true, force: true }));

	it("at(HEAD) and worktree() agree on relativePath for every package, root included", async () => {
		const RootStubP = Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(parityRoot) } as never);
		const liveP = PointInTimeWorkspaceLive.pipe(
			Layer.provide(Layer.mergeAll(RootStubP, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStubP)))),
			Layer.provide(NodeContext.layer),
		);
		const [atPaths, wtPaths] = await Effect.runPromise(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				const atSnap = yield* pit.at("HEAD");
				const wtSnap = yield* pit.worktree();
				const paths = (s: typeof atSnap) => s.packages.map((p) => `${p.name}=${p.relativePath}`).sort();
				return [paths(atSnap), paths(wtSnap)] as const;
			}).pipe(Effect.provide(liveP)) as Effect.Effect<readonly [string[], string[]], unknown, never>,
		);
		expect(wtPaths).toEqual(atPaths);
		expect(atPaths).toContain("parity-root=.");
	});
});

describe("worktree freshness", () => {
	let freshRoot: string;

	beforeAll(() => {
		freshRoot = mkdtempSync(join(tmpdir(), "pit-fresh-"));
		writeFileSync(join(freshRoot, "package.json"), JSON.stringify({ name: "fresh-root", version: "0.0.0" }));
		writeFileSync(join(freshRoot, "pnpm-workspace.yaml"), `packages:\n  - packages/*\n`);
		mkdirSync(join(freshRoot, "packages", "a"), { recursive: true });
		writeFileSync(
			join(freshRoot, "packages", "a", "package.json"),
			JSON.stringify({ name: "@fresh/a", version: "1.0.0", dependencies: { "std-env": "^4.1.0" } }),
		);
		const g = (...args: string[]) => execFileSync("git", args, { cwd: freshRoot, encoding: "utf8" });
		g("init", "-b", "main");
		g("add", "-A");
		g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "fresh base");
	});
	afterAll(() => rmSync(freshRoot, { recursive: true, force: true }));

	it("worktree() reflects manifest edits made after an earlier read of the same layer", async () => {
		// Regression: WorkspaceDiscoveryLive caches listPackages per root for the
		// layer lifetime, so a worktree() snapshot taken after files changed used
		// to serve the manifests from BEFORE the change (the silk-update-action
		// "DepsRegen: wrote 0 changeset(s)" bug). worktree() means "live state
		// now" -- it must re-read the working tree on every call.
		const RootStubF = Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(freshRoot) } as never);
		const liveF = PointInTimeWorkspaceLive.pipe(
			Layer.provide(Layer.mergeAll(RootStubF, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStubF)))),
			Layer.provide(NodeContext.layer),
		);
		const [before, after] = await Effect.runPromise(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				const first = yield* pit.worktree();
				// Mutate the manifest on disk between the two reads.
				writeFileSync(
					join(freshRoot, "packages", "a", "package.json"),
					JSON.stringify({ name: "@fresh/a", version: "1.0.0", dependencies: { "std-env": "^4.2.0" } }),
				);
				const second = yield* pit.worktree();
				return [first, second] as const;
			}).pipe(Effect.provide(liveF)) as Effect.Effect<
				readonly [WorkspaceStateSnapshot, WorkspaceStateSnapshot],
				unknown,
				never
			>,
		);
		expect(Option.getOrNull(before.package("@fresh/a"))?.dependencies["std-env"]).toBe("^4.1.0");
		expect(Option.getOrNull(after.package("@fresh/a"))?.dependencies["std-env"]).toBe("^4.2.0");
	});
});

describe("root-level wildcard parity", () => {
	let wildcardRoot: string;

	beforeAll(() => {
		wildcardRoot = mkdtempSync(join(tmpdir(), "pit-root-wildcard-"));
		writeFileSync(join(wildcardRoot, "package.json"), JSON.stringify({ name: "wildcard-root", version: "0.0.0" }));
		// Root-level wildcard: compileWorkspaceGlobs produces prefix: "" for a
		// pattern with no "/", which previously drove
		// `git ls-tree --name-only <ref> ""` -- fatal ("empty string is not a
		// valid pathspec"). See src/layers/PointInTimeWorkspaceLive.ts at().
		writeFileSync(join(wildcardRoot, "pnpm-workspace.yaml"), `packages:\n  - "pkg-*"\n`);
		mkdirSync(join(wildcardRoot, "pkg-a"), { recursive: true });
		writeFileSync(
			join(wildcardRoot, "pkg-a", "package.json"),
			JSON.stringify({ name: "@wildcard/a", version: "1.0.0" }),
		);
		const g = (...args: string[]) => execFileSync("git", args, { cwd: wildcardRoot, encoding: "utf8" });
		g("init", "-b", "main");
		g("add", "-A");
		g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "wildcard base");
	});
	afterAll(() => rmSync(wildcardRoot, { recursive: true, force: true }));

	it('at(HEAD) discovers a root-level wildcard pattern (pkg-*) via ls-tree "."', async () => {
		const RootStubW = Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(wildcardRoot) } as never);
		const liveW = PointInTimeWorkspaceLive.pipe(
			Layer.provide(Layer.mergeAll(RootStubW, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStubW)))),
			Layer.provide(NodeContext.layer),
		);
		const snap = await Effect.runPromise(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.at("HEAD");
			}).pipe(Effect.provide(liveW)) as Effect.Effect<WorkspaceStateSnapshot, unknown, never>,
		);
		expect(Option.isSome(snap.package("@wildcard/a"))).toBe(true);
	});

	it("worktree() discovers the same root-level wildcard pattern (producer parity)", async () => {
		const RootStubW = Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(wildcardRoot) } as never);
		const liveW = PointInTimeWorkspaceLive.pipe(
			Layer.provide(Layer.mergeAll(RootStubW, WorkspaceDiscoveryLive.pipe(Layer.provide(RootStubW)))),
			Layer.provide(NodeContext.layer),
		);
		const snap = await Effect.runPromise(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.worktree();
			}).pipe(Effect.provide(liveW)) as Effect.Effect<WorkspaceStateSnapshot, unknown, never>,
		);
		expect(Option.isSome(snap.package("@wildcard/a"))).toBe(true);
	});
});
