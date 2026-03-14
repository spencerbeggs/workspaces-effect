/**
 * LockfileReader service — reads and queries lockfile data.
 *
 * @packageDocumentation
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { LockfileIntegrityError } from "../errors/LockfileIntegrityError.js";
import type { LockfileData, LockfileIntegrity, ResolvedPackage, WorkspaceDependency } from "../schemas/lockfile.js";

/**
 * Service for reading and querying package manager lockfile data.
 *
 * Provides a unified interface over all four lockfile formats (npm
 * `package-lock.json`, pnpm `pnpm-lock.yaml`, yarn `yarn.lock`, bun `bun.lock`).
 * The correct parser is selected automatically based on the detected package manager.
 *
 * @remarks
 * LockfileReader is part of the Configuration and Lockfiles service group. It
 * abstracts over the substantial format differences between lockfiles, exposing
 * a consistent query API regardless of the underlying package manager.
 *
 * The live layer (`LockfileReaderLive`) depends on `WorkspaceRoot` and
 * `PackageManagerDetector`. It requires `FileSystem` and `Path` from
 * `@effect/platform`. Use `WorkspacesLive` or `WorkspacesFullLive` to get all
 * wiring handled automatically.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/LockfileReader`. The lockfile is parsed lazily
 * on first access and cached internally. The parsing strategy is determined by
 * the `PackageManagerType` from `PackageManagerDetector`.
 *
 * @example Reading lockfile data
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { LockfileReader, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const lockfile = yield* reader.readLockfile();
 *   console.log(`Package manager: ${lockfile.packageManager}`);
 *   console.log(`Total packages: ${lockfile.packages.length}`);
 *
 *   const react = yield* reader.resolvedVersion("react");
 *   console.log("React version:", react);
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileReader extends Context.Tag("@spencerbeggs/workspaces-effect/LockfileReader")<
	LockfileReader,
	{
		/**
		 * Read and parse the workspace lockfile.
		 *
		 * Detects the lockfile format from the package manager type and parses it
		 * into a normalized {@link LockfileData} structure.
		 *
		 * @returns An Effect that succeeds with the parsed {@link LockfileData}.
		 */
		readonly readLockfile: () => Effect.Effect<LockfileData>;

		/**
		 * Look up the resolved version of a package in the lockfile.
		 *
		 * @param packageName - The npm package name to look up (e.g., `"react"`).
		 * @returns An Effect that succeeds with `Option.some(resolvedPackage)` if the
		 *   package is found in the lockfile, or `Option.none()` if it is not present.
		 */
		readonly resolvedVersion: (packageName: string) => Effect.Effect<Option.Option<ResolvedPackage>>;

		/**
		 * Get all workspace-to-workspace dependency links from the lockfile.
		 *
		 * @returns An Effect that succeeds with a readonly array of
		 *   {@link WorkspaceDependency} records representing inter-workspace
		 *   dependency relationships as declared in the lockfile.
		 */
		readonly workspaceDependencies: () => Effect.Effect<ReadonlyArray<WorkspaceDependency>>;

		/**
		 * Verify lockfile integrity against the current `package.json` files.
		 *
		 * Checks that all workspace dependencies in `package.json` are properly
		 * reflected in the lockfile.
		 *
		 * @returns An Effect that succeeds with a {@link LockfileIntegrity} report, or
		 *   fails with {@link LockfileIntegrityError} if critical integrity violations
		 *   are detected.
		 */
		readonly checkIntegrity: () => Effect.Effect<LockfileIntegrity, LockfileIntegrityError>;
	}
>() {}
