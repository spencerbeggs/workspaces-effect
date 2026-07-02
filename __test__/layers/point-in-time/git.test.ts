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
				"cat-file -e HEAD:package.json": { exitCode: 0 },
				"show HEAD:package.json": { exitCode: 0, stdout: '{"name":"pkg-a"}' },
			});
			const reader = makeGitReader(executor);
			const result = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json"));
			expect(result).toEqual(Option.some('{"name":"pkg-a"}'));
		});

		it("returns Option.none when the probe reports the path missing (exit 1, no stderr parsing)", async () => {
			const executor = mockExecutor({
				"cat-file -e abc123:packages/removed/package.json": { exitCode: 1 },
			});
			const reader = makeGitReader(executor);
			const result = await Effect.runPromise(reader.show("/repo", "abc123", "packages/removed/package.json"));
			expect(result).toEqual(Option.none());
		});

		it("falls back to stderr classification for ambiguous probe failures", async () => {
			const executor = mockExecutor({
				"cat-file -e abc123:x/package.json": { exitCode: 128, stderr: "fatal: bad object abc123:x/package.json" },
			});
			const reader = makeGitReader(executor);
			const result = await Effect.runPromise(reader.show("/repo", "abc123", "x/package.json"));
			expect(result).toEqual(Option.none());
		});

		it("classifies the exists-on-disk-but-not-in shape as an absent path", async () => {
			const executor = mockExecutor({
				"cat-file -e HEAD:packages/new/package.json": {
					exitCode: 128,
					stderr: "fatal: path 'packages/new/package.json' exists on disk, but not in 'HEAD'",
				},
			});
			const reader = makeGitReader(executor);
			const result = await Effect.runPromise(reader.show("/repo", "HEAD", "packages/new/package.json"));
			expect(result).toEqual(Option.none());
		});

		it("fails with GitReadError when the probe fails for a non-missing reason", async () => {
			const executor = mockExecutor({
				"cat-file -e HEAD:package.json": { exitCode: 128, stderr: "fatal: not a git repository" },
			});
			const reader = makeGitReader(executor);
			const error = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json").pipe(Effect.flip));
			expect(error).toBeInstanceOf(GitReadError);
			expect(error.reason).toContain("not a git repository");
		});

		it("fails with GitReadError when show itself fails after a successful probe", async () => {
			const executor = mockExecutor({
				"cat-file -e HEAD:package.json": { exitCode: 0 },
				"show HEAD:package.json": { exitCode: 128, stderr: "fatal: unable to read object" },
			});
			const reader = makeGitReader(executor);
			const error = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json").pipe(Effect.flip));
			expect(error).toBeInstanceOf(GitReadError);
		});

		it("maps an executor spawn failure into GitReadError", async () => {
			const failing = CommandExecutor.makeExecutor(() => Effect.fail(new Error("spawn ENOENT") as never));
			const reader = makeGitReader(failing);
			const error = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json").pipe(Effect.flip));
			expect(error).toBeInstanceOf(GitReadError);
			expect(error.cwd).toBe("/repo");
			expect(error.reason).toContain("spawn ENOENT");
		});

		it("times out a stalled git command with GitReadError", async () => {
			const encoder = new TextEncoder();
			const stalled = CommandExecutor.makeExecutor(() =>
				Effect.succeed({
					[CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
					pid: CommandExecutor.ProcessId(1),
					exitCode: Effect.never,
					isRunning: Effect.succeed(true),
					kill: () => Effect.void,
					stderr: Stream.make(encoder.encode("")),
					stdin: Sink.drain,
					stdout: Stream.make(encoder.encode("")),
					toJSON: () => ({}),
				} as unknown as CommandExecutor.Process),
			);
			const reader = makeGitReader(stalled, { timeout: "50 millis" });
			const error = await Effect.runPromise(reader.show("/repo", "HEAD", "package.json").pipe(Effect.flip));
			expect(error).toBeInstanceOf(GitReadError);
			expect(error.reason).toContain("timed out");
		});
	});

	describe("lsTree", () => {
		it("splits and trims stdout into a name list", async () => {
			const executor = mockExecutor({
				"ls-tree --name-only HEAD packages/": { exitCode: 0, stdout: "packages/a \r\n packages/b\r\n" },
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
			expect(result.command).toBe("git ls-tree --name-only deadbeef packages/");
		});
	});
});
