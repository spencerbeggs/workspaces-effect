import { Data } from "effect";

/**
 * Base constant for {@link PackageManagerDetectionError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageManagerDetectionErrorBase = Data.TaggedError("PackageManagerDetectionError");

/**
 * Emitted when the package manager type cannot be determined.
 *
 * @remarks
 * Raised by {@link PackageManagerDetector} when heuristics (lockfile presence,
 * `packageManager` field in root package.json) fail to identify a single
 * package manager for the workspace.
 *
 * Fields:
 * - `searchPath` — the workspace root path that was inspected.
 * - `reason` — human-readable explanation of the detection failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageManagerDetectionError } from "workspaces-effect";
 * import { PackageManagerDetector, PackageManagerDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* PackageManagerDetector;
 *   return yield* detector.detect("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("PackageManagerDetectionError", (e) =>
 *     Effect.succeed(`Could not detect PM at ${e.searchPath}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageManagerDetectionError extends PackageManagerDetectionErrorBase<{
	readonly searchPath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot detect package manager at "${this.searchPath}": ${this.reason}`;
	}
}
