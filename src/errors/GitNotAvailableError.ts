import { Data } from "effect";

/**
 * Base constant for {@link GitNotAvailableError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const GitNotAvailableErrorBase = Data.TaggedError("GitNotAvailableError");

/**
 * Emitted when git is not installed or the directory is not a git repository.
 *
 * @remarks
 * Raised by {@link ChangeDetector} as a precondition check before any git
 * operations. This indicates that change detection is unavailable entirely,
 * as opposed to {@link ChangeDetectionError} which indicates a specific
 * git operation failed.
 *
 * Fields:
 * - `reason` — human-readable explanation (e.g., "git not found in PATH"
 *   or "not a git repository").
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { GitNotAvailableError } from "workspaces-effect";
 * import { ChangeDetector, ChangeDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   return yield* detector.changedPackages("main");
 * }).pipe(
 *   Effect.catchTag("GitNotAvailableError", (e) =>
 *     Effect.logWarning(`Git unavailable: ${e.reason}`).pipe(
 *       Effect.map(() => [])
 *     )
 *   )
 * );
 * ```
 *
 * @public
 */
export class GitNotAvailableError extends GitNotAvailableErrorBase<{
	readonly reason: string;
}> {
	get message(): string {
		return `Git is not available: ${this.reason}`;
	}
}
