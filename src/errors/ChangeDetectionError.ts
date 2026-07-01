import { Data } from "effect";

/**
 * Base constant for {@link ChangeDetectionError}.
 *
 * @remarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file. Tagged
 * `@public` because it appears in the `extends` clause of a `@public`
 * subclass; consumers should construct and catch the subclass, not this
 * base directly.
 *
 * @public
 */
export const ChangeDetectionErrorBase = Data.TaggedError("ChangeDetectionError");

/**
 * Emitted when a git operation fails during change detection.
 *
 * @remarks
 * Raised by {@link ChangeDetector} when a specific git command (diff, log,
 * merge-base, etc.) fails after git availability has already been confirmed.
 * The `operation` field identifies which command failed.
 *
 * Fields:
 * - `operation` — the git operation that failed (e.g., "diff", "merge-base").
 * - `reason` — human-readable explanation of the failure.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { ChangeDetectionError } from "workspaces-effect";
 * import { ChangeDetector, ChangeDetectorLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   return yield* detector.changedPackages("main");
 * }).pipe(
 *   Effect.catchTag("ChangeDetectionError", (e) =>
 *     Effect.logError(`Git ${e.operation} failed: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class ChangeDetectionError extends ChangeDetectionErrorBase<{
	readonly operation: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Change detection failed during "${this.operation}": ${this.reason}`;
	}
}
