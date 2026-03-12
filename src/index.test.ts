import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	PackageJsonParseError,
	PackageJsonSchema,
	PackageManager,
	PackageManagerDetector,
	PackageNotFoundError,
	WorkspaceDiscovery,
	WorkspaceInfo,
	WorkspacePackage,
	WorkspaceRoot,
	WorkspaceRootNotFoundError,
} from "./index.js";

// ── Schema Tests ─────────────────────────────────────────────────────

describe("PackageManager schema", () => {
	it("accepts valid package managers", () => {
		for (const pm of ["npm", "pnpm", "yarn", "bun"] as const) {
			expect(Schema.decodeUnknownSync(PackageManager)(pm)).toBe(pm);
		}
	});

	it("rejects invalid package managers", () => {
		expect(() => Schema.decodeUnknownSync(PackageManager)("deno")).toThrow();
	});
});

describe("PackageJsonSchema", () => {
	it("decodes a minimal package.json", () => {
		const input = { name: "my-pkg", version: "1.0.0" };
		const result = Schema.decodeUnknownSync(PackageJsonSchema)(input);
		expect(result.name).toBe("my-pkg");
		expect(result.version).toBe("1.0.0");
	});

	it("decodes workspaces as array", () => {
		const input = { workspaces: ["packages/*"] };
		const result = Schema.decodeUnknownSync(PackageJsonSchema)(input);
		expect(result.workspaces).toEqual(["packages/*"]);
	});

	it("decodes workspaces as object", () => {
		const input = { workspaces: { packages: ["packages/*"] } };
		const result = Schema.decodeUnknownSync(PackageJsonSchema)(input);
		expect(result.workspaces).toEqual({ packages: ["packages/*"] });
	});

	it("decodes dependencies maps", () => {
		const input = {
			name: "root",
			dependencies: { effect: "^3.0.0" },
			devDependencies: { vitest: "^3.0.0" },
		};
		const result = Schema.decodeUnknownSync(PackageJsonSchema)(input);
		expect(result.dependencies).toEqual({ effect: "^3.0.0" });
	});
});

describe("WorkspacePackage schema class", () => {
	it("creates a workspace package with defaults", () => {
		const pkg = new WorkspacePackage({
			name: "@scope/my-pkg",
			version: "1.0.0",
			path: "/workspaces/my-pkg",
			relativePath: "packages/my-pkg",
		});
		expect(pkg.name).toBe("@scope/my-pkg");
		expect(pkg.private).toBe(false);
		expect(pkg.dependencies).toEqual({});
	});

	it("creates a workspace package with all fields", () => {
		const pkg = new WorkspacePackage({
			name: "pkg-a",
			version: "2.0.0",
			path: "/root/packages/pkg-a",
			relativePath: "packages/pkg-a",
			private: true,
			dependencies: { "pkg-b": "workspace:*" },
			devDependencies: { vitest: "^3.0.0" },
		});
		expect(pkg.private).toBe(true);
		expect(pkg.dependencies).toEqual({ "pkg-b": "workspace:*" });
	});
});

describe("WorkspaceInfo schema class", () => {
	it("creates workspace info", () => {
		const info = new WorkspaceInfo({
			root: "/workspaces/my-monorepo",
			packageManager: "pnpm",
			packageManagerVersion: "10.32.1",
			patterns: ["packages/*", "apps/*"],
		});
		expect(info.packageManager).toBe("pnpm");
		expect(info.patterns).toHaveLength(2);
	});
});

// ── Error Tests ──────────────────────────────────────────────────────

describe("WorkspaceRootNotFoundError", () => {
	it("has correct _tag", () => {
		const err = new WorkspaceRootNotFoundError({
			searchPath: "/some/path",
			reason: "no package.json found",
		});
		expect(err._tag).toBe("WorkspaceRootNotFoundError");
		expect(err.message).toContain("/some/path");
		expect(err.message).toContain("no package.json found");
	});

	it("is catchable with catchTag", async () => {
		const program = Effect.fail(
			new WorkspaceRootNotFoundError({
				searchPath: "/test",
				reason: "test",
			}),
		).pipe(Effect.catchTag("WorkspaceRootNotFoundError", (e) => Effect.succeed(`caught: ${e.searchPath}`)));
		const result = await Effect.runPromise(program);
		expect(result).toBe("caught: /test");
	});
});

describe("PackageNotFoundError", () => {
	it("includes available count in message", () => {
		const err = new PackageNotFoundError({
			name: "@scope/missing",
			available: ["pkg-a", "pkg-b", "pkg-c"],
		});
		expect(err.message).toContain("3 packages available");
	});
});

describe("PackageJsonParseError", () => {
	it("includes file path and cause", () => {
		const err = new PackageJsonParseError({
			filePath: "/root/packages/bad/package.json",
			cause: new SyntaxError("Unexpected token"),
		});
		expect(err._tag).toBe("PackageJsonParseError");
		expect(err.message).toContain("/root/packages/bad/package.json");
	});
});

// ── Service Tag Tests ────────────────────────────────────────────────

describe("Service tags", () => {
	it("WorkspaceRoot tag is accessible", () => {
		const program = Effect.gen(function* () {
			const root = yield* WorkspaceRoot;
			return yield* root.find("/test");
		});

		// Verify the program has the correct type requirements
		// (it requires WorkspaceRoot in its environment)
		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends WorkspaceRoot ? true : never = true;
		expect(_check).toBe(true);
	});

	it("PackageManagerDetector tag is accessible", () => {
		const program = Effect.gen(function* () {
			const detector = yield* PackageManagerDetector;
			return yield* detector.detect("/test");
		});

		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends PackageManagerDetector ? true : never = true;
		expect(_check).toBe(true);
	});

	it("WorkspaceDiscovery tag is accessible", () => {
		const program = Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			return yield* discovery.listPackages();
		});

		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends WorkspaceDiscovery ? true : never = true;
		expect(_check).toBe(true);
	});

	it("services compose in Effect.gen with Layer.succeed", async () => {
		const { Layer } = await import("effect");

		const testRoot = Layer.succeed(WorkspaceRoot, {
			find: () => Effect.succeed("/mock/root"),
		});

		const testDetector = Layer.succeed(PackageManagerDetector, {
			detect: () => Effect.succeed({ type: "pnpm" as const, version: "10.0.0" }),
		});

		const testDiscovery = Layer.succeed(WorkspaceDiscovery, {
			listPackages: () => Effect.succeed([]),
			getPackage: (name: string) => Effect.fail(new PackageNotFoundError({ name, available: [] })),
		});

		const testLayer = Layer.mergeAll(testRoot, testDetector, testDiscovery);

		const program = Effect.gen(function* () {
			const root = yield* WorkspaceRoot;
			const rootPath = yield* root.find("/test");

			const detector = yield* PackageManagerDetector;
			const pm = yield* detector.detect(rootPath);

			const discovery = yield* WorkspaceDiscovery;
			const packages = yield* discovery.listPackages();

			return { rootPath, pm, packages };
		});

		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
		expect(result.rootPath).toBe("/mock/root");
		expect(result.pm.type).toBe("pnpm");
		expect(result.packages).toEqual([]);
	});
});
