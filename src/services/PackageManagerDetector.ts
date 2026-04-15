/**
 * PackageManagerDetector service — detects the package manager type and version.
 *
 * @packageDocumentation
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageManagerDetectionError } from "../errors/PackageManagerDetectionError.js";
import type { PackageManagerType } from "../schemas/core.js";

/**
 * Result of package manager detection.
 *
 * @remarks
 * The `type` field identifies the package manager (`npm`, `pnpm`, `yarn`, or `bun`).
 * The `version` field is extracted from the `packageManager` field in the root
 * `package.json` (e.g., `"pnpm@9.15.4"` yields `"9.15.4"`). It may be `undefined`
 * when no `packageManager` field is present and detection fell back to lock file
 * heuristics.
 *
 * @public
 */
export interface DetectedPackageManager {
	/** The detected package manager type. */
	readonly type: PackageManagerType;
	/** The version string, or `undefined` if not specified in `packageManager`. */
	readonly version: string | undefined;
	/**
	 * The inferred runtime environment based on the detected package manager.
	 * `"bun"` when the PM is Bun; `"node"` for npm, pnpm, and yarn.
	 * Note: this reflects the package manager type, not the actual Node.js/Bun
	 * process — a Bun project using npm will still report `"node"`.
	 */
	readonly runtime: "node" | "bun";
}

/**
 * Service for detecting the package manager used by a workspace.
 *
 * Detection priority:
 * 1. pnpm — `pnpm-workspace.yaml` exists
 * 2. bun — `bun.lock`/`bun.lockb` exists AND `packageManager` starts with `bun@`
 * 3. yarn — `yarn.lock` exists AND `packageManager` starts with `yarn@`
 * 4. npm — fallback if `package.json` has a `workspaces` field
 *
 * @remarks
 * PackageManagerDetector is part of the Discovery service group. It is used by
 * downstream services (WorkspaceDiscovery, LockfileReader) to select the
 * correct parsing strategy for workspace configuration and lockfiles.
 *
 * The live layer (`PackageManagerDetectorLive`) requires `FileSystem` and `Path`
 * from `@effect/platform`.
 *
 * @privateRemarks
 * Uses the class-based `Context.Tag` pattern. The internal tag identifier is
 * `@spencerbeggs/workspaces-effect/PackageManagerDetector`. Dependencies are
 * resolved at layer construction time so that service methods have `R = never`.
 *
 * @example Detecting the package manager
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import type { DetectedPackageManager } from "workspaces-effect";
 * import { PackageManagerDetector, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* PackageManagerDetector;
 *   const pm: DetectedPackageManager = yield* detector.detect("/path/to/monorepo");
 *   console.log(`Package manager: ${pm.type}${pm.version ? `@${pm.version}` : ""}`);
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
export class PackageManagerDetector extends Context.Tag("@spencerbeggs/workspaces-effect/PackageManagerDetector")<
	PackageManagerDetector,
	{
		/**
		 * Detect the package manager at the given root path.
		 *
		 * Inspects lock files and `package.json` fields at the workspace root to
		 * determine which package manager is in use.
		 *
		 * @param root - Absolute path to the workspace root directory.
		 * @returns An Effect that succeeds with a {@link DetectedPackageManager}, or
		 *   fails with {@link PackageManagerDetectionError} if no supported package
		 *   manager can be identified.
		 */
		readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionError>;
	}
>() {}
