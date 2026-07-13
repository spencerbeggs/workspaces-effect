import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readWorktreeCatalogState } from "../../../src/layers/point-in-time/worktree-catalogs.js";

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "wt-cat-"));
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n  - packages/*\nconfigDependencies:\n  some-plugin: 1.0.0+sha512-abc\ncatalogs:\n  silk:\n    effect: ^3.21.0\n`,
	);
	writeFileSync(
		join(root, "pnpm-lock.yaml"),
		`lockfileVersion: '9.0'\ncatalogs:\n  silk:\n    effect:\n      specifier: ^3.20.0\n      version: 3.20.0\n    yaml:\n      specifier: ^2.5.0\n      version: 2.5.0\n`,
	);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
const read = (dir: string) => readWorktreeCatalogState(dir).pipe(Effect.provide(NodeContext.layer));

describe("readWorktreeCatalogState", () => {
	it("merges lockfile-then-inline with inline winning per dependency", async () => {
		const state = await run(read(root));
		expect(state.merged.toCatalogs()).toEqual({ silk: { effect: "^3.21.0", yaml: "^2.5.0" } });
	});

	it("exposes inline and lockfile sets separately for overlay composition", async () => {
		const state = await run(read(root));
		expect(state.inline.toCatalogs()).toEqual({ silk: { effect: "^3.21.0" } });
		expect(state.lockfile.toCatalogs()).toEqual({ silk: { effect: "^3.20.0", yaml: "^2.5.0" } });
	});

	it("surfaces configDependencies from the manifest", async () => {
		const state = await run(read(root));
		expect(state.configDependencies).toEqual({ "some-plugin": "1.0.0+sha512-abc" });
	});

	it("treats a missing lockfile as empty catalogs, not an error", async () => {
		const bare = mkdtempSync(join(tmpdir(), "wt-cat-bare-"));
		writeFileSync(join(bare, "pnpm-workspace.yaml"), `packages:\n  - .\n`);
		const state = await run(read(bare));
		expect(state.lockfile.toCatalogs()).toEqual({});
		rmSync(bare, { recursive: true, force: true });
	});

	it("treats a malformed lockfile as empty catalogs, not an error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wt-cat-bad-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), `packages:\n  - .\n`);
		writeFileSync(join(dir, "pnpm-lock.yaml"), "{{{ not yaml");
		const state = await run(read(dir));
		expect(state.lockfile.toCatalogs()).toEqual({});
		rmSync(dir, { recursive: true, force: true });
	});

	it("propagates a non-NotFound lockfile read failure as CatalogAssemblyError", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wt-cat-perm-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), `packages:\n  - .\n`);
		writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
		chmodSync(join(dir, "pnpm-lock.yaml"), 0o000);
		const error = await run(read(dir).pipe(Effect.flip));
		expect(error._tag).toBe("CatalogAssemblyError");
		expect(error.source).toBe("lockfile");
		chmodSync(join(dir, "pnpm-lock.yaml"), 0o644);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("package.json catalogs (bun/npm)", () => {
	let pkgJsonRoot: string;

	beforeAll(() => {
		pkgJsonRoot = mkdtempSync(join(tmpdir(), "wc-pkgjson-"));
		writeFileSync(
			join(pkgJsonRoot, "package.json"),
			JSON.stringify({
				name: "root",
				workspaces: {
					packages: ["packages/*"],
					catalog: { react: "^19.0.0" },
					catalogs: { silk: { effect: "^3.21.4" } },
				},
			}),
		);
	});

	afterAll(() => {
		rmSync(pkgJsonRoot, { recursive: true, force: true });
	});

	it("reads catalogs from the workspaces field when there is no pnpm-workspace.yaml", async () => {
		const state = await run(read(pkgJsonRoot));

		expect(state.merged.entries.default).toEqual({ react: "^19.0.0" });
		expect(state.merged.entries.silk).toEqual({ effect: "^3.21.4" });
		expect(state.lockfile.entries).toEqual({});
	});
});
