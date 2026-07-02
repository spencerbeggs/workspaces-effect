/**
 * Internal low-level git object reader over `CommandExecutor`.
 *
 * Not part of the public API -- consumed by the point-in-time workspace
 * service (Task A5) to read `package.json` contents and directory listings
 * at an arbitrary git ref without checking the ref out.
 *
 * @packageDocumentation
 * @internal
 */

import type { CommandExecutor } from "@effect/platform";
import { Command } from "@effect/platform";
import { Chunk, Duration, Effect, Option, Stream } from "effect";
import { GitReadError } from "../../errors/GitReadError.js";

/**
 * Stderr shapes that mean "the path is not present at this ref" rather than
 * "the git command failed."
 *
 * @privateRemarks
 * Callers validate the ref itself (typically via merge-base) before reading
 * files at it, so every one of these shapes -- even ones that could in
 * principle describe a bad ref, like `unknown revision` or `bad object` --
 * is treated as PATH_NOT_AT_REF for `show`. This mirrors silk-effects'
 * `runGitShow` decision: ambiguity between "bad ref" and "missing path" is
 * resolved in favor of `Option.none` because the ref is never in question
 * by the time `show` runs. As of the `cat-file -e` existence probe, this
 * regex is only consulted as a fallback for probe failures whose exit code
 * is neither 0 (exists) nor 1 (missing) -- the common "missing" case no
 * longer parses stderr prose at all.
 *
 * @internal
 */
const NOT_AT_REF = /exists on disk, but not in|does not exist|unknown revision|bad object/;

/**
 * Low-level git object reader for point-in-time workspace state.
 *
 * @internal
 */
export interface GitReader {
	/** Read a file's content at a git ref; `Option.none` if not present there. */
	readonly show: (cwd: string, ref: string, path: string) => Effect.Effect<Option.Option<string>, GitReadError>;
	/** List file paths under `prefix` at a git ref. */
	readonly lsTree: (cwd: string, ref: string, prefix: string) => Effect.Effect<ReadonlyArray<string>, GitReadError>;
}

/**
 * Create a {@link GitReader} bound to a resolved `CommandExecutor`.
 *
 * @internal
 */
export const makeGitReader = (
	executor: CommandExecutor.CommandExecutor,
	options?: { readonly timeout?: Duration.DurationInput },
): GitReader => {
	const timeout = Duration.decode(options?.timeout ?? "30 seconds");

	/** Run a git command (locale pinned to C) and collect exit code, stdout, stderr. */
	const run = (
		cwd: string,
		args: ReadonlyArray<string>,
	): Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, GitReadError> =>
		Effect.scoped(
			Effect.gen(function* () {
				const process = yield* executor.start(
					Command.make("git", ...args).pipe(Command.workingDirectory(cwd), Command.env({ LC_ALL: "C" })),
				);
				// Drain stdout/stderr concurrently with awaiting exitCode: a real child
				// process closes its output streams on exit, so collecting them only
				// AFTER `exitCode` resolves races the OS and can lose stdout entirely.
				const [exitCode, stdoutChunks, stderrChunks] = yield* Effect.all(
					[
						process.exitCode,
						Stream.runCollect(process.stdout.pipe(Stream.decodeText())),
						Stream.runCollect(process.stderr.pipe(Stream.decodeText())),
					],
					{ concurrency: "unbounded" },
				);
				return {
					exitCode,
					stdout: Chunk.join(stdoutChunks, ""),
					stderr: Chunk.join(stderrChunks, ""),
				};
			}),
		).pipe(
			Effect.mapError((error) => new GitReadError({ command: `git ${args.join(" ")}`, cwd, reason: String(error) })),
			Effect.timeoutFail({
				duration: timeout,
				onTimeout: () =>
					new GitReadError({
						command: `git ${args.join(" ")}`,
						cwd,
						reason: `timed out after ${Duration.format(timeout)}`,
					}),
			}),
		);

	const show: GitReader["show"] = (cwd, ref, path) =>
		run(cwd, ["cat-file", "-e", `${ref}:${path}`]).pipe(
			Effect.flatMap(({ exitCode, stderr }) => {
				// Existence probe: exit 0 = object exists, exit 1 = missing. No prose
				// parsing on the common path. Any other exit falls back to the
				// NOT_AT_REF stderr classification (ambiguous bad-ref shapes still
				// resolve to none -- see NOT_AT_REF's @privateRemarks).
				if (exitCode === 1) return Effect.succeed(Option.none<string>());
				if (exitCode !== 0) {
					if (NOT_AT_REF.test(stderr)) return Effect.succeed(Option.none<string>());
					return Effect.fail(
						new GitReadError({ command: `git cat-file -e ${ref}:${path}`, cwd, reason: stderr.trim() }),
					);
				}
				// Object exists: a show failure now is a genuine error, never a skip.
				return run(cwd, ["show", `${ref}:${path}`]).pipe(
					Effect.flatMap(({ exitCode: showExit, stdout, stderr: showStderr }) =>
						showExit === 0
							? Effect.succeed(Option.some(stdout))
							: Effect.fail(new GitReadError({ command: `git show ${ref}:${path}`, cwd, reason: showStderr.trim() })),
					),
				);
			}),
		);

	const lsTree: GitReader["lsTree"] = (cwd, ref, prefix) =>
		run(cwd, ["ls-tree", "--name-only", ref, prefix]).pipe(
			Effect.flatMap(({ exitCode, stdout, stderr }) =>
				exitCode === 0
					? Effect.succeed(
							stdout
								.split(/\r?\n/)
								.map((line) => line.trim())
								.filter((line) => line.length > 0),
						)
					: Effect.fail(
							new GitReadError({
								command: `git ls-tree --name-only ${ref} ${prefix}`,
								cwd,
								reason: stderr.trim(),
							}),
						),
			),
		);

	return { show, lsTree };
};
