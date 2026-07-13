import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseBunLockfile } from "../../src/layers/parsers/bun.js";

// JSONC with trailing commas and comments
const MINIMAL_BUN_LOCK = `{
  // Bun lockfile v0
  "lockfileVersion": 0,
  "workspaces": {
    "": {
      "name": "my-monorepo",
      "devDependencies": {
        "typescript": "^5.3.0",
      },
    },
    "packages/api": {
      "name": "@my-monorepo/api",
      "version": "1.0.0",
      "dependencies": {
        "@my-monorepo/common": "packages/common",
        "hono": "^4.0.0",
      },
    },
    "packages/common": {
      "name": "@my-monorepo/common",
      "version": "1.0.0",
      "dependencies": {
        "zod": "^3.22.0",
      },
    },
    "packages/core": {
      "name": "@my-monorepo/core",
      "version": "1.0.0",
      "dependencies": {
        "lodash": "^4.17.21",
        "react": "catalog:",
      },
    },
  },
  "packages": {
    "hono": ["hono@4.6.14", "", {}, "sha512-abc"],
    "lodash": ["lodash@4.17.21", "", {}, "sha512-jkl"],
    "react": ["react@19.0.0", "", {}, "sha512-mno"],
    "zod": ["zod@3.23.8", "", {}, "sha512-def"],
    "typescript": ["typescript@5.3.3", "", {}, "sha512-ghi"],
  },
  "catalog": {
    "react": "^19.0.0",
  },
  "overrides": {
    "lodash": "^4.17.23",
  },
}`;

describe("parseBunLockfile", () => {
	it("parses JSONC with comments and trailing commas", async () => {
		const result = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));
		expect(result.packageManager).toBe("bun");
		expect(result.lockfileVersion).toBe("0");
	});

	it("extracts workspace packages", async () => {
		const result = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));
		const ws = result.packages.filter((p) => p.isWorkspace);
		const names = ws.map((p) => p.name);
		expect(names).toContain("@my-monorepo/api");
		expect(names).toContain("@my-monorepo/common");
	});

	it("parses package tuples for resolved versions", async () => {
		const result = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));
		const hono = result.packages.find((p) => p.name === "hono");
		expect(hono).toBeDefined();
		expect(hono?.version).toBe("4.6.14");
		expect(hono?.integrity).toBe("sha512-abc");
	});

	it("extracts workspace dependencies", async () => {
		const result = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));
		expect(result.workspaceDependencies).toContainEqual(
			expect.objectContaining({
				to: "@my-monorepo/common",
				depType: "dependencies",
			}),
		);
	});

	it("extracts overrides into pmSpecific", async () => {
		const result = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));
		expect(result.pmSpecific?._tag).toBe("bun");
		if (result.pmSpecific?._tag === "bun") {
			expect(result.pmSpecific.overrides?.lodash).toBe("^4.17.23");
		}
	});

	it("fails on invalid JSONC", async () => {
		const result = await Effect.runPromiseExit(parseBunLockfile("{invalid content", "/bad"));
		expect(result._tag).toBe("Failure");
	});

	it("fails with LockfileParseError on structurally invalid bun.lock", async () => {
		const result = await Effect.runPromiseExit(parseBunLockfile('{"lockfileVersion": "wrong"}', "/bad"));
		expect(result._tag).toBe("Failure");
	});

	it("handles bun.lock with no workspaces field", async () => {
		const NO_WS = `{ "lockfileVersion": 0, "packages": { "zod": ["zod@3.23.8", "", {}, "sha512-abc"] } }`;
		const result = await Effect.runPromise(parseBunLockfile(NO_WS, "/project/bun.lock"));
		expect(result.packageManager).toBe("bun");
		expect(result.packages.find((p) => p.name === "zod")).toBeDefined();
	});

	it("handles bun.lock with no packages field", async () => {
		const NO_PKGS = `{ "lockfileVersion": 0, "workspaces": { "": { "name": "root" } } }`;
		const result = await Effect.runPromise(parseBunLockfile(NO_PKGS, "/project/bun.lock"));
		expect(result.packageManager).toBe("bun");
		expect(result.packages).toHaveLength(0);
	});

	it("uses wsPath as name fallback when workspace entry has no name", async () => {
		const NO_NAME = `{ "lockfileVersion": 0, "workspaces": { "": { "name": "root" }, "packages/lib": { "version": "1.0.0" } } }`;
		const result = await Effect.runPromise(parseBunLockfile(NO_NAME, "/project/bun.lock"));
		const lib = result.packages.find((p) => p.name === "packages/lib");
		expect(lib).toBeDefined();
		expect(lib?.isWorkspace).toBe(true);
	});

	it("uses 0.0.0 version fallback when workspace entry has no version", async () => {
		const NO_VER = `{ "lockfileVersion": 0, "workspaces": { "": { "name": "root" }, "packages/lib": { "name": "@my/lib" } } }`;
		const result = await Effect.runPromise(parseBunLockfile(NO_VER, "/project/bun.lock"));
		const lib = result.packages.find((p) => p.name === "@my/lib");
		expect(lib?.version).toBe("0.0.0");
	});

	it("skips package tuples with unscoped name at index 0 (atIdx <= 0)", async () => {
		// A tuple whose id string has no '@' would be skipped
		const EDGE = `{ "lockfileVersion": 0, "packages": { "bare": ["barepackage", "", {}, "sha512-abc"] } }`;
		const result = await Effect.runPromise(parseBunLockfile(EDGE, "/project/bun.lock"));
		expect(result.packageManager).toBe("bun");
	});
});

describe("importers", () => {
	it("records each workspace's declared dependencies with their specifiers", async () => {
		const data = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));

		const importer = data.importers.find((i) => i.path === "packages/core");
		expect(importer).toBeDefined();
		expect(importer?.dependencies.some((d) => d.name === "lodash" && d.depType === "dependencies")).toBe(true);
	});

	it("preserves a catalog: specifier verbatim", async () => {
		const data = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));

		const all = data.importers.flatMap((i) => i.dependencies);
		const catalogDep = all.find((d) => d.specifier.startsWith("catalog:"));
		expect(catalogDep).toBeDefined();
	});

	it("keeps the root importer under the path '.'", async () => {
		const data = await Effect.runPromise(parseBunLockfile(MINIMAL_BUN_LOCK, "/project/bun.lock"));

		const root = data.importers.find((i) => i.path === ".");
		expect(root).toBeDefined();
		expect(root?.dependencies.some((d) => d.name === "typescript" && d.depType === "devDependencies")).toBe(true);
	});
});
