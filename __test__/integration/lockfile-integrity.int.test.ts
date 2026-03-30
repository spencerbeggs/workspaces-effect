/**
 * Integration tests for LockfileReader.checkIntegrity() against real fixture lockfiles.
 *
 * Uses actual FileSystem reads (NodeFileSystem.layer) against the generated
 * fixture workspaces. WorkspaceRoot and PackageManagerDetector are mocked to
 * point at fixtures; all other services use live implementations.
 *
 * Each parser populates `ResolvedPackage.relativePath` with the workspace-relative
 * filesystem path, so the integrity check resolves package.json correctly for all
 * package managers. Results are captured with Effect.runPromiseExit and snapshotted
 * for regression detection.
 */

import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { LockfileReader } from "../../src/services/LockfileReader.js";
import { bunFixture, npmFixture, pnpmFixture, yarnFixture } from "../utils/fixtures.js";
import { makeLockfileLayer } from "../utils/layers.js";

// ── Helper to run checkIntegrity and return the Exit (success or failure) ──

const runIntegrityExit = (pm: "pnpm" | "npm" | "yarn" | "bun", fixturePath: string) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const reader = yield* LockfileReader;
			return yield* reader.checkIntegrity();
		}).pipe(Effect.provide(makeLockfileLayer(pm, fixturePath))),
	);

// ── Serialise an Exit for snapshotting ───────────────────────────────
//
// Converts an Exit into a plain object so Vitest can diff it cleanly.
// For failures, strips absolute paths, line numbers, and stack frames so
// the snapshot is stable across machines and after refactors.

const stripVolatile = (s: string): string =>
	s
		// Remove stack frames (lines starting with "    at ")
		.replace(/\n\s+at .+/g, "")
		// Replace absolute fixture paths in error messages (covers .json paths too)
		.replace(/\/[^\s')]+\/fixtures\/[^\s')]+/g, "<fixture-path>")
		// Replace remaining absolute source file paths (.ts/.js/.cjs/.mjs)
		.replace(/\/[^\s:)']+\.(ts|js|cjs|mjs)/g, "<source-path>");

const serialiseExit = <A, E>(exit: Exit.Exit<A, E>) => {
	if (Exit.isSuccess(exit)) {
		return { _tag: "Success", value: exit.value };
	}
	// Failure: surface the error type and message without volatile details
	const raw = String(exit.cause);
	return { _tag: "Failure", cause: stripVolatile(raw) };
};

// ── pnpm ─────────────────────────────────────────────────────────────

describe("LockfileReader.checkIntegrity integration: pnpm", () => {
	describe("v1", () => {
		it("returns integrity result (snapshot)", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v1"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});

		it("succeeds with a LockfileIntegrity value", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v1"));
			expect(Exit.isSuccess(exit)).toBe(true);
		});

		it("integrity result has expected shape", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v1"));
			if (Exit.isSuccess(exit)) {
				const result = exit.value;
				expect(typeof result.valid).toBe("boolean");
				expect(Array.isArray(result.missingWorkspaces)).toBe(true);
				expect(Array.isArray(result.extraWorkspaces)).toBe(true);
				expect(Array.isArray(result.unsatisfiedConstraints)).toBe(true);
			}
		});
	});

	describe("v2", () => {
		it("returns integrity result (snapshot)", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v2"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});

		it("succeeds with a LockfileIntegrity value", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v2"));
			expect(Exit.isSuccess(exit)).toBe(true);
		});
	});

	describe("v3", () => {
		it("returns integrity result (snapshot)", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v3"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});

		it("succeeds with a LockfileIntegrity value", async () => {
			const exit = await runIntegrityExit("pnpm", pnpmFixture("v3"));
			expect(Exit.isSuccess(exit)).toBe(true);
		});
	});
});

// ── bun ──────────────────────────────────────────────────────────────

describe("LockfileReader.checkIntegrity integration: bun", () => {
	describe("v1", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("bun", bunFixture("v1"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("bun", bunFixture("v2"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});

	describe("v3", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("bun", bunFixture("v3"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});
});

// ── npm ──────────────────────────────────────────────────────────────

describe("LockfileReader.checkIntegrity integration: npm", () => {
	describe("v1", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("npm", npmFixture("v1"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("npm", npmFixture("v2"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});
});

// ── yarn ─────────────────────────────────────────────────────────────

describe("LockfileReader.checkIntegrity integration: yarn", () => {
	describe("v1", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("yarn", yarnFixture("v1"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		it("returns exit result (snapshot)", async () => {
			const exit = await runIntegrityExit("yarn", yarnFixture("v2"));
			expect(serialiseExit(exit)).toMatchSnapshot();
		});
	});
});
