import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ChangeDetectionError,
	ChangeDetectionOptions,
	ChangeDetector,
	DependencyResolutionError,
	GitNotAvailableError,
	LockfileIntegrityError,
	LockfileParseError,
	LockfileReadError,
	LockfileReader,
	PackageJsonParseError,
	PackageJsonSchema,
	PackageManager,
	PackageManagerDetector,
	PackageNotFoundError,
	PackageResolver,
	WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	WorkspaceInfo,
	WorkspacePackage,
	WorkspaceRoot,
	WorkspaceRootNotFoundError,
} from "../src/index.js";

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
	it("includes available count in message (plural)", () => {
		const err = new PackageNotFoundError({
			name: "@scope/missing",
			available: ["pkg-a", "pkg-b", "pkg-c"],
		});
		expect(err.message).toContain("3 packages available");
	});

	it("uses singular 'package' when exactly one is available", () => {
		const err = new PackageNotFoundError({
			name: "@scope/missing",
			available: ["pkg-a"],
		});
		expect(err.message).toContain("1 package available");
		expect(err.message).not.toContain("packages");
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

describe("GitNotAvailableError", () => {
	it("has correct _tag and message", () => {
		const err = new GitNotAvailableError({
			reason: "not a git repository",
		});
		expect(err._tag).toBe("GitNotAvailableError");
		expect(err.message).toContain("not a git repository");
	});
});

describe("ChangeDetectionError", () => {
	it("has correct _tag and message", () => {
		const err = new ChangeDetectionError({
			operation: "git diff",
			reason: "invalid ref",
		});
		expect(err._tag).toBe("ChangeDetectionError");
		expect(err.message).toContain("git diff");
		expect(err.message).toContain("invalid ref");
	});
});

describe("DependencyResolutionError", () => {
	it("has correct _tag and message", () => {
		const err = new DependencyResolutionError({
			packageName: "pkg-a",
			dependency: "lodash",
			reason: "not in workspace",
		});
		expect(err._tag).toBe("DependencyResolutionError");
		expect(err.message).toContain("lodash");
		expect(err.message).toContain("pkg-a");
	});
});

describe("LockfileReadError", () => {
	it("has correct _tag and message", () => {
		const err = new LockfileReadError({
			lockfilePath: "/project/pnpm-lock.yaml",
			reason: "file not found",
		});
		expect(err._tag).toBe("LockfileReadError");
		expect(err.message).toContain("/project/pnpm-lock.yaml");
		expect(err.message).toContain("file not found");
	});
});

describe("LockfileParseError", () => {
	it("has correct _tag and message", () => {
		const err = new LockfileParseError({
			lockfilePath: "/project/bun.lock",
			format: "bun",
			cause: new Error("unexpected token"),
		});
		expect(err._tag).toBe("LockfileParseError");
		expect(err.message).toContain("bun");
		expect(err.message).toContain("/project/bun.lock");
	});
});

describe("LockfileIntegrityError", () => {
	it("has correct _tag and message", () => {
		const err = new LockfileIntegrityError({
			reason: "mismatched workspace",
			cause: new Error("oops"),
		});
		expect(err._tag).toBe("LockfileIntegrityError");
		expect(err.message).toContain("mismatched workspace");
	});
});

describe("WorkspaceDiscoveryError", () => {
	it("has correct _tag and message", () => {
		const err = new WorkspaceDiscoveryError({
			root: "/projects/monorepo",
			reason: "no workspace patterns found",
		});
		expect(err._tag).toBe("WorkspaceDiscoveryError");
		expect(err.message).toContain("/projects/monorepo");
		expect(err.message).toContain("no workspace patterns found");
	});

	it("formats message as expected", () => {
		const err = new WorkspaceDiscoveryError({
			root: "/root",
			reason: "test reason",
		});
		expect(err.message).toBe('Workspace discovery failed at "/root": test reason');
	});
});

describe("LockfileReader tag", () => {
	it("is accessible in Effect.gen", () => {
		const program = Effect.gen(function* () {
			const reader = yield* LockfileReader;
			return yield* reader.readLockfile();
		});
		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends LockfileReader ? true : never = true;
		expect(_check).toBe(true);
	});
});

describe("ChangeDetectionOptions", () => {
	it("provides sensible defaults", () => {
		const opts = new ChangeDetectionOptions({});
		expect(opts.base).toBe("HEAD~1");
		expect(opts.head).toBe("HEAD");
		expect(opts.includeUncommitted).toBe(false);
	});

	it("accepts custom values", () => {
		const opts = new ChangeDetectionOptions({
			base: "main",
			head: "feature",
			includeUncommitted: true,
		});
		expect(opts.base).toBe("main");
		expect(opts.head).toBe("feature");
		expect(opts.includeUncommitted).toBe(true);
	});
});

// ── Phase 3 Service Tag Tests ───────────────────────────────────────

describe("PackageResolver tag", () => {
	it("is accessible in Effect.gen", () => {
		const program = Effect.gen(function* () {
			const resolver = yield* PackageResolver;
			return yield* resolver.resolveFile("/some/file.ts");
		});
		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends PackageResolver ? true : never = true;
		expect(_check).toBe(true);
	});

	it("composes with Layer.succeed mock", async () => {
		const { Layer } = await import("effect");

		const testResolver = Layer.succeed(PackageResolver, {
			resolveFile: () => Effect.succeed(Option.none()),
			resolveFiles: () => Effect.succeed(new Map()),
			packagePaths: () => Effect.succeed([]),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const resolver = yield* PackageResolver;
				return yield* resolver.resolveFile("/test/file.ts");
			}).pipe(Effect.provide(testResolver)),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});

describe("ChangeDetector tag", () => {
	it("is accessible in Effect.gen", () => {
		const program = Effect.gen(function* () {
			const detector = yield* ChangeDetector;
			return yield* detector.changedFiles(new ChangeDetectionOptions({}));
		});
		type _R = Effect.Effect.Context<typeof program>;
		const _check: _R extends ChangeDetector ? true : never = true;
		expect(_check).toBe(true);
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
			detect: () => Effect.succeed({ type: "pnpm" as const, version: "10.0.0", runtime: "node" as const }),
		});

		const testDiscovery = Layer.succeed(WorkspaceDiscovery, {
			listPackages: () => Effect.succeed([]),
			getPackage: (name: string) => Effect.fail(new PackageNotFoundError({ name, available: [] })),
			importerMap: () => Effect.succeed(new Map() as ReadonlyMap<string, WorkspacePackage>),
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
