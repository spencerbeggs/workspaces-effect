/**
 * Live implementation of ChangeDetector service.
 *
 * Uses Effect platform Command API for git operations.
 * CommandExecutor is resolved at layer construction time so that
 * service methods have R = never (matching the service interface).
 */

import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Layer } from "effect";
import { ChangeDetectionError, GitNotAvailableError } from "../errors/index.js";
import type { WorkspacePackage } from "../schemas/core.js";
import type { ChangeDetectionOptions } from "../services/ChangeDetector.js";
import { ChangeDetector } from "../services/ChangeDetector.js";
import { DependencyGraph } from "../services/DependencyGraph.js";
import { PackageResolver } from "../services/PackageResolver.js";

/**
 * Create git helper functions that use a resolved CommandExecutor.
 */
const makeGitHelpers = (executor: CommandExecutor.CommandExecutor) => {
	/** Run a git command and return trimmed stdout. */
	const runGit = (cwd: string, ...args: ReadonlyArray<string>) =>
		Effect.scoped(executor.string(Command.make("git", ...args).pipe(Command.workingDirectory(cwd)))).pipe(
			Effect.map((s) => s.trim()),
			Effect.mapError(
				(e) =>
					new ChangeDetectionError({
						operation: `git ${args.join(" ")}`,
						reason: String(e),
					}),
			),
		);

	/** Run a git command and return stdout as non-empty lines. */
	const runGitLines = (cwd: string, ...args: ReadonlyArray<string>) =>
		runGit(cwd, ...args).pipe(
			Effect.map((output) =>
				output
					.split("\n")
					.map((l) => l.trim())
					.filter((l) => l.length > 0),
			),
		);

	/** Check git availability. */
	const checkGit = (cwd: string) =>
		Effect.scoped(
			executor.string(Command.make("git", "rev-parse", "--git-dir").pipe(Command.workingDirectory(cwd))),
		).pipe(
			Effect.mapError(
				() =>
					new GitNotAvailableError({
						reason: "not a git repository or git is not installed",
					}),
			),
		);

	return { runGit, runGitLines, checkGit };
};

/**
 * Live layer for ChangeDetector.
 *
 * Depends on PackageResolver, DependencyGraph, and CommandExecutor.
 * CommandExecutor is resolved at construction time.
 */
export const ChangeDetectorLive = Layer.effect(
	ChangeDetector,
	Effect.gen(function* () {
		const resolver = yield* PackageResolver;
		const graph = yield* DependencyGraph;
		const executor = yield* CommandExecutor.CommandExecutor;
		const { runGitLines, checkGit } = makeGitHelpers(executor);

		/** Derive cwd from the first package path. */
		const getCwd = () =>
			Effect.gen(function* () {
				const paths = yield* resolver.packagePaths();
				return paths.length > 0 ? paths[0].path.replace(/\/$/, "") : process.cwd();
			});

		return {
			changedFiles: (options: ChangeDetectionOptions) =>
				Effect.gen(function* () {
					const cwd = yield* getCwd();
					yield* checkGit(cwd);

					const committedFiles = yield* runGitLines(cwd, "diff", "--name-only", `${options.base}...${options.head}`);

					if (!options.includeUncommitted) {
						yield* Effect.logInfo("Changed files detected").pipe(
							Effect.annotateLogs("workspace.files.count", committedFiles.length),
						);
						return committedFiles;
					}

					const unstagedFiles = yield* runGitLines(cwd, "diff", "--name-only");
					const stagedFiles = yield* runGitLines(cwd, "diff", "--name-only", "--cached");
					const untrackedFiles = yield* runGitLines(cwd, "ls-files", "--others", "--exclude-standard");

					const allFiles = new Set([...committedFiles, ...unstagedFiles, ...stagedFiles, ...untrackedFiles]);
					const sorted = Array.from(allFiles).sort();
					yield* Effect.logInfo("Changed files detected").pipe(
						Effect.annotateLogs("workspace.files.count", sorted.length),
					);
					return sorted;
				}).pipe(
					Effect.withSpan("ChangeDetector.changedFiles", {
						attributes: {
							"workspace.base": options.base,
							"workspace.head": options.head,
						},
					}),
				),

			changedPackages: (options: ChangeDetectionOptions) =>
				Effect.gen(function* () {
					const cwd = yield* getCwd();
					yield* checkGit(cwd);

					const committedFiles = yield* runGitLines(cwd, "diff", "--name-only", `${options.base}...${options.head}`);

					let files = committedFiles;
					if (options.includeUncommitted) {
						const unstaged = yield* runGitLines(cwd, "diff", "--name-only");
						const staged = yield* runGitLines(cwd, "diff", "--name-only", "--cached");
						const untracked = yield* runGitLines(cwd, "ls-files", "--others", "--exclude-standard");
						files = [...new Set([...files, ...unstaged, ...staged, ...untracked])];
					}

					const fileMap = yield* resolver.resolveFiles(files);

					const seen = new Set<string>();
					const packages: WorkspacePackage[] = [];
					for (const pkg of fileMap.values()) {
						if (!seen.has(pkg.name)) {
							seen.add(pkg.name);
							packages.push(pkg);
						}
					}
					const sorted = packages.sort((a, b) => a.name.localeCompare(b.name));
					yield* Effect.logInfo("Changed packages detected").pipe(
						Effect.annotateLogs("workspace.packages.count", sorted.length),
					);
					return sorted;
				}).pipe(Effect.withSpan("ChangeDetector.changedPackages")),

			affectedPackages: (options: ChangeDetectionOptions) =>
				Effect.gen(function* () {
					const cwd = yield* getCwd();
					yield* checkGit(cwd);

					const committedFiles = yield* runGitLines(cwd, "diff", "--name-only", `${options.base}...${options.head}`);

					let files = committedFiles;
					if (options.includeUncommitted) {
						const unstaged = yield* runGitLines(cwd, "diff", "--name-only");
						const staged = yield* runGitLines(cwd, "diff", "--name-only", "--cached");
						const untracked = yield* runGitLines(cwd, "ls-files", "--others", "--exclude-standard");
						files = [...new Set([...files, ...unstaged, ...staged, ...untracked])];
					}

					const fileMap = yield* resolver.resolveFiles(files);

					// Get directly changed packages
					const changedNames = new Set<string>();
					for (const pkg of fileMap.values()) {
						changedNames.add(pkg.name);
					}

					// Collect transitive dependents via BFS
					const affected = new Set(changedNames);
					const queue = [...changedNames];

					while (queue.length > 0) {
						const current = queue.shift() as string;
						const dependents = yield* graph
							.dependentsOf(current)
							.pipe(Effect.catchTag("PackageNotFoundError", () => Effect.succeed([] as ReadonlyArray<string>)));
						for (const dep of dependents) {
							if (!affected.has(dep)) {
								affected.add(dep);
								queue.push(dep);
							}
						}
					}

					// Resolve names back to WorkspacePackage objects
					const paths = yield* resolver.packagePaths();
					const packageMap = new Map(paths.map((p) => [p.package.name, p.package]));

					const result = Array.from(affected)
						.map((name) => packageMap.get(name))
						.filter((pkg): pkg is WorkspacePackage => pkg !== undefined)
						.sort((a, b) => a.name.localeCompare(b.name));
					yield* Effect.logInfo("Affected packages detected").pipe(
						Effect.annotateLogs("workspace.packages.count", result.length),
					);
					return result;
				}).pipe(Effect.withSpan("ChangeDetector.affectedPackages")),
		};
	}),
);
