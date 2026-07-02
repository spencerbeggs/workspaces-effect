import { Data } from "effect";

/**
 * Base constant for {@link GitReadError}.
 *
 * @remarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @public
 */
export const GitReadErrorBase = Data.TaggedError("GitReadError");

/**
 * Raised when reading workspace state at a git ref fails irrecoverably
 * (git unavailable, unknown revision, command failure). A path that simply
 * does not exist at the ref is NOT an error — readers surface that as
 * `Option.none`.
 *
 * @public
 */
export class GitReadError extends GitReadErrorBase<{
	/** The git command that failed, including arguments. */
	readonly command: string;
	/** Working directory in which the command was invoked. */
	readonly cwd: string;
	/** Human-readable failure reason — typically captured stderr. */
	readonly reason: string;
}> {
	get message(): string {
		return `git read failed in ${this.cwd}: ${this.command}\n${this.reason}`;
	}
}
