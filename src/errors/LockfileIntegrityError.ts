import { Data } from "effect";

/**
 * Base constant for {@link LockfileIntegrityError}.
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
export const LockfileIntegrityErrorBase = Data.TaggedError("LockfileIntegrityError");

/**
 * Emitted when integrity checking cannot complete.
 *
 * @remarks
 * Raised by {@link LockfileReader} during integrity validation when the
 * comparison between the lockfile's resolved packages and the workspace's
 * declared dependencies encounters an unrecoverable error. Note that
 * integrity *mismatches* (missing workspaces, unsatisfied constraints) are
 * reported via {@link LockfileIntegrity} — this error indicates the check
 * itself could not run.
 *
 * Fields:
 * - `reason` — human-readable explanation of why the integrity check failed.
 * - `cause` — the underlying error that prevented the check.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileIntegrityError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.checkIntegrity("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileIntegrityError", (e) =>
 *     Effect.logError(`Integrity check failed: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileIntegrityError extends LockfileIntegrityErrorBase<{
	readonly reason: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Integrity check failed: ${this.reason}`;
	}
}
