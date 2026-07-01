import { Data } from "effect";

/**
 * Base constant for {@link LockfileReadError}.
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
export const LockfileReadErrorBase = Data.TaggedError("LockfileReadError");

/**
 * Emitted when a lockfile cannot be read from disk.
 *
 * @remarks
 * Raised by {@link LockfileReader} when the expected lockfile for the detected
 * package manager (e.g., `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
 * `bun.lock`) does not exist or cannot be read due to filesystem permissions.
 *
 * Fields:
 * - `lockfilePath` — absolute path to the lockfile that could not be read.
 * - `reason` — human-readable explanation (e.g., "file not found", "permission denied").
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileReadError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.read("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileReadError", (e) =>
 *     Effect.logWarning(`No lockfile at ${e.lockfilePath}: ${e.reason}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileReadError extends LockfileReadErrorBase<{
	readonly lockfilePath: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Failed to read lockfile at "${this.lockfilePath}": ${this.reason}`;
	}
}
