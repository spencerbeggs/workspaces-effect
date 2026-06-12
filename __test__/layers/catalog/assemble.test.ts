import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { assembleCatalogs } from "../../../src/layers/catalog/assemble.js";

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(e.pipe(Effect.provide(NodeContext.layer)));

describe("assembleCatalogs", () => {
	it("unions inline + config-dependency-injected + lockfile, hooks authoritative", async () => {
		const dir = mkdtempSync(join(tmpdir(), "asm-"));
		writeFileSync(join(dir, "pnpm-workspace.yaml"), ["catalog:", "  inline-pkg: ^1.0.0"].join("\n"));
		const out = await run(
			assembleCatalogs({
				workspaceRoot: dir,
				lockfileCatalogs: { locked: { lp: "^4" } },
				injectedCatalogs: { silkPeers: { effect: ">=3" } },
			}),
		);
		expect(out.default).toEqual({ "inline-pkg": "^1.0.0" });
		expect(out.locked).toEqual({ lp: "^4" });
		expect(out.silkPeers).toEqual({ effect: ">=3" });
		rmSync(dir, { recursive: true, force: true });
	});
});
