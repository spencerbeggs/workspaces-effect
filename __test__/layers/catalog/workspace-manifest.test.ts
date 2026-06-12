import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readWorkspaceManifest } from "../../../src/layers/catalog/workspace-manifest.js";

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(e.pipe(Effect.provide(NodeContext.layer)));

describe("readWorkspaceManifest", () => {
	it("parses catalog, catalogs, and configDependencies", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wsm-"));
		writeFileSync(
			join(dir, "pnpm-workspace.yaml"),
			[
				"packages:",
				"  - packages/*",
				"catalog:",
				"  left-pad: ^1.3.0",
				"catalogs:",
				"  ui:",
				"    react: ^18.0.0",
				"configDependencies:",
				'  "@scope/pnpm-plugin-x": 1.0.0+sha512-abc',
			].join("\n"),
		);
		const out = await run(readWorkspaceManifest(dir));
		expect(out.catalog).toEqual({ "left-pad": "^1.3.0" });
		expect(out.catalogs).toEqual({ ui: { react: "^18.0.0" } });
		expect(out.configDependencies).toEqual({ "@scope/pnpm-plugin-x": "1.0.0+sha512-abc" });
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns empties when pnpm-workspace.yaml is absent", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wsm-"));
		const out = await run(readWorkspaceManifest(dir));
		expect(out).toEqual({ catalog: undefined, catalogs: undefined, configDependencies: undefined });
		rmSync(dir, { recursive: true, force: true });
	});
});
