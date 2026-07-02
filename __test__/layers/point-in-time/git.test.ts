/**
 * Tests for the internal `makeGitReader` git object reader.
 */

import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Option, Sink, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { GitReadError } from "../../../src/errors/GitReadError.js";
import { makeGitReader } from "../../../src/layers/point-in-time/git.js";

// ── Mock CommandExecutor ─────────────────────────────────────────────

/**
 * Create a fake `CommandExecutor` that returns pre-recorded
 * `{ exitCode, stdout, stderr }` responses keyed by the joined git args
 * (e.g. "show HEAD:package.json").
 */
const mockExecutor = (responses: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>) => {
	const encoder = new TextEncoder();

	return CommandExecutor.makeExecutor((command) => {
		const flat = Command.flatten(command);
		const std = flat[0];
		const args = Array.from(std.args);
		const key = args.join(" ");

		const response = responses[key] ?? {};
		const exitCode = response.exitCode ?? 0;
		const stdout = response.stdout ?? "";
		const stderr = response.stderr ?? "";

		return Effect.succeed({
			[CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
			pid: CommandExecutor.ProcessId(1),
			exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
			isRunning: Effect.succeed(false),
			kill: () => Effect.void,
			stderr: Stream.make(encoder.encode(stderr)),
			stdin: Sink.drain,
			stdout: Stream.make(encoder.encode(stdout)),
			toJSON: () => ({}),
		} as unknown as CommandExecutor.Process);
	});
};

describe("makeGitReader", () => {
	describe("show", () => {
		it("returns Option.some with file content when the path exists at the ref", async () => {
			const executor = mockExecutor({
				"show HEAD:package.json": { exitCode: 0, stdout: '{"name":"pkg-a"}' },
			});
			const reader = makeGitReader(executor);

			const result = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json"));

			expect(result).toEqual(Option.some('{"name":"pkg-a"}'));
		});

		it("returns Option.none when the path does not exist at the ref", async () => {
			const executor = mockExecutor({
				"show abc123:packages/removed/package.json": {
					exitCode: 128,
					stderr: "fatal: path 'packages/removed/package.json' does not exist in 'abc123'",
				},
			});
			const reader = makeGitReader(executor);

			const result = await Effect.runPromise(reader.show("/repo", "abc123", "packages/removed/package.json"));

			expect(result).toEqual(Option.none());
		});

		it("fails with GitReadError on other git failures", async () => {
			const executor = mockExecutor({
				"show HEAD:package.json": { exitCode: 128, stderr: "fatal: not a git repository" },
			});
			const reader = makeGitReader(executor);

			const result = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json").pipe(Effect.flip));

			expect(result).toBeInstanceOf(GitReadError);
			expect(result.cwd).toBe("/repo");
			expect(result.reason).toContain("not a git repository");
		});
	});

	describe("lsTree", () => {
		it("splits and trims stdout into a name list", async () => {
			const executor = mockExecutor({
				"ls-tree --name-only HEAD packages/": { exitCode: 0, stdout: "packages/a\npackages/b\n" },
			});
			const reader = makeGitReader(executor);

			const result = await Effect.runPromise(reader.lsTree("/repo", "HEAD", "packages/"));

			expect(result).toEqual(["packages/a", "packages/b"]);
		});

		it("fails with GitReadError on git failure", async () => {
			const executor = mockExecutor({
				"ls-tree --name-only deadbeef packages/": { exitCode: 128, stderr: "fatal: bad object deadbeef" },
			});
			const reader = makeGitReader(executor);

			const result = await Effect.runPromise(reader.lsTree("/repo", "deadbeef", "packages/").pipe(Effect.flip));

			expect(result).toBeInstanceOf(GitReadError);
			expect(result.reason).toContain("bad object deadbeef");
		});
	});
});
