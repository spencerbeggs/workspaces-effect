import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PointInTimeWorkspaceLive } from "../../src/layers/PointInTimeWorkspaceLive.js";
import { WorkspaceDiscoveryLive } from "../../src/layers/WorkspaceDiscoveryLive.js";
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
		`packages:\n  - packages/*\ncatalogs:\n  silk:\n    effect: ^3.20.0\n`,
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
	git("init", "-b", "main");
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "base");
	baseSha = git("rev-parse", "HEAD");
	// Working-tree mutation: bump the catalog, bump the package version.
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n  - packages/*\ncatalogs:\n  silk:\n    effect: ^3.21.0\n`,
	);
	writeFileSync(
		join(root, "packages", "a", "package.json"),
		JSON.stringify({ name: "@fixture/a", version: "1.1.0", dependencies: { effect: "catalog:silk" } }),
	);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RootStub = Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed(root) } as never);
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
				return yield* pit.at(baseSha, root);
			}),
		);
		expect(Option.getOrNull(snap.package("@fixture/a"))?.version).toBe("1.0.0");
		expect(Option.getOrNull(snap.resolve("effect", "catalog:silk"))).toBe("^3.20.0");
	});

	it("worktree() reads the live state", async () => {
		const snap = await run(
			Effect.gen(function* () {
				const pit = yield* PointInTimeWorkspace;
				return yield* pit.worktree(root);
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
				return yield* pit.at(baseSha, root);
			}),
		);
		expect(Option.isNone(snap.package("@fixture/b"))).toBe(true);
	});
});
