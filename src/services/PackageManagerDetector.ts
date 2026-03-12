/**
 * PackageManagerDetector service — detects the package manager type and version.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageManagerDetectionError } from "../errors/index.js";
import type { PackageManagerType } from "../schemas/core.js";

/** Result of package manager detection. */
export interface DetectedPackageManager {
	readonly type: PackageManagerType;
	readonly version: string | undefined;
}

/**
 * Service for detecting the package manager used by a workspace.
 *
 * Detection priority:
 * 1. pnpm — pnpm-workspace.yaml exists
 * 2. bun — bun.lock/bun.lockb exists AND packageManager starts with bun\@
 * 3. yarn — yarn.lock exists AND packageManager starts with yarn\@
 * 4. npm — fallback if package.json has workspaces field
 */
export class PackageManagerDetector extends Context.Tag("@spencerbeggs/workspaces-effect/PackageManagerDetector")<
	PackageManagerDetector,
	{
		/** Detect the package manager at the given root path. */
		readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionError>;
	}
>() {}
