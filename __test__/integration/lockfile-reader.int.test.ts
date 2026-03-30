/**
 * Integration tests for LockfileReader against real fixture lockfiles.
 *
 * Uses actual FileSystem reads (NodeFileSystem.layer) against the generated
 * fixture workspaces. Only WorkspaceRoot and PackageManagerDetector are mocked.
 */

import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { bunFixture, npmFixture, pnpmFixture, yarnFixture } from "../utils/fixtures.js";
import { makeLockfileLayer } from "../utils/layers.js";

// ── Helper to run effects against a lockfile layer ───────────────────

const runWithLayer = <A>(
	pm: "pnpm" | "npm" | "yarn" | "bun",
	fixturePath: string,
	program: Effect.Effect<A, any, LockfileReader>,
) => Effect.runPromise(program.pipe(Effect.provide(makeLockfileLayer(pm, fixturePath))));

// ── pnpm ─────────────────────────────────────────────────────────────

describe("LockfileReader integration: pnpm", () => {
	describe("v1", () => {
		const fixturePath = pnpmFixture("v1");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("pnpm");
			expect(result.lockfileVersion).toBe("9.0");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});

		it("has pmSpecific.catalogs.default", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.pmSpecific).toBeDefined();
			expect(result.pmSpecific?._tag).toBe("pnpm");
			if (result.pmSpecific?._tag === "pnpm") {
				expect(result.pmSpecific.catalogs).toBeDefined();
				expect(result.pmSpecific.catalogs?.default).toBeDefined();
			}
		});
	});

	describe("v2", () => {
		const fixturePath = pnpmFixture("v2");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("pnpm");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("zod");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});

		it("has pmSpecific.catalogs.silk with specifier/version entries", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.pmSpecific).toBeDefined();
			if (result.pmSpecific?._tag === "pnpm") {
				expect(result.pmSpecific.catalogs?.silk).toBeDefined();
				const silk = result.pmSpecific.catalogs?.silk;
				if (silk) {
					// Each entry should have { specifier, version }
					for (const value of Object.values(silk)) {
						expect(value).toHaveProperty("specifier");
						expect(value).toHaveProperty("version");
					}
				}
			}
		});
	});

	describe("v3", () => {
		const fixturePath = pnpmFixture("v3");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("pnpm");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"pnpm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("lodash");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});
});

// ── bun ──────────────────────────────────────────────────────────────

describe("LockfileReader integration: bun", () => {
	describe("v1", () => {
		const fixturePath = bunFixture("v1");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("bun");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("chalk");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});

	describe("v2", () => {
		const fixturePath = bunFixture("v2");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("bun");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("zod");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});

		it("has pmSpecific.catalogs (named) and pmSpecific.catalog (default)", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.pmSpecific).toBeDefined();
			if (result.pmSpecific?._tag === "bun") {
				expect(result.pmSpecific.catalog).toBeDefined();
				expect(result.pmSpecific.catalogs).toBeDefined();
			}
		});
	});

	describe("v3", () => {
		const fixturePath = bunFixture("v3");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("bun");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"bun",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});
});

// ── npm ──────────────────────────────────────────────────────────────

describe("LockfileReader integration: npm", () => {
	describe("v1", () => {
		const fixturePath = npmFixture("v1");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("npm");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});

	describe("v2", () => {
		const fixturePath = npmFixture("v2");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("npm");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"npm",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});
});

// ── yarn ─────────────────────────────────────────────────────────────

describe("LockfileReader integration: yarn", () => {
	describe("v1", () => {
		const fixturePath = yarnFixture("v1");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("yarn");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});

	describe("v2", () => {
		const fixturePath = yarnFixture("v2");

		it("parses lockfile data", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.readLockfile();
				}),
			);
			expect(result.packageManager).toBe("yarn");
			expect(result).toMatchSnapshot();
		});

		it("returns workspace dependencies", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.workspaceDependencies();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("resolves a known package version", async () => {
			const result = await runWithLayer(
				"yarn",
				fixturePath,
				Effect.gen(function* () {
					const reader = yield* LockfileReader;
					return yield* reader.resolvedVersion("typescript");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
		});
	});
});
