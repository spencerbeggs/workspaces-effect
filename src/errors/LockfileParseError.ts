import { Data } from "effect";

/**
 * Base constant for {@link LockfileParseError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const LockfileParseErrorBase = Data.TaggedError("LockfileParseError");

/**
 * Emitted when a lockfile exists but cannot be parsed.
 *
 * @remarks
 * Raised by {@link LockfileReader} when the lockfile is successfully read from
 * disk but its contents cannot be parsed into the expected format. Each package
 * manager has a different lockfile format (YAML for pnpm, JSON for npm/bun,
 * custom format for yarn Berry).
 *
 * Fields:
 * - `lockfilePath` — absolute path to the lockfile that failed to parse.
 * - `format` — the package manager format that was attempted (`"pnpm"`, `"npm"`, `"yarn"`, or `"bun"`).
 * - `cause` — the underlying parse error.
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { LockfileParseError } from "workspaces-effect";
 * import { LockfileReader, LockfileReaderLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   return yield* reader.read("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("LockfileParseError", (e) =>
 *     Effect.logError(`Cannot parse ${e.format} lockfile at ${e.lockfilePath}`)
 *   )
 * );
 * ```
 *
 * @public
 */
export class LockfileParseError extends LockfileParseErrorBase<{
	readonly lockfilePath: string;
	readonly format: "pnpm" | "npm" | "yarn" | "bun";
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse ${this.format} lockfile at "${this.lockfilePath}"`;
	}
}
