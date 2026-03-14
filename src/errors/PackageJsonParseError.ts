import { Data } from "effect";

/**
 * Base constant for {@link PackageJsonParseError}.
 *
 * @privateRemarks
 * Exported for api-extractor DTS bundling — the `_base` symbol from
 * `Data.TaggedError` must be visible in the generated .d.ts file.
 *
 * @internal
 */
export const PackageJsonParseErrorBase = Data.TaggedError("PackageJsonParseError");

/**
 * Emitted when a package.json file cannot be parsed or validated.
 *
 * @remarks
 * Raised by {@link WorkspaceDiscovery} when a package.json file is found but
 * contains invalid JSON or does not conform to {@link PackageJsonSchema}. The
 * `cause` field preserves the underlying parse or schema validation error.
 *
 * Fields:
 * - `filePath` — absolute path to the package.json that failed to parse.
 * - `cause` — the underlying error (JSON syntax error or Schema decode failure).
 *
 * @example Catching the error
 * ```typescript
 * import { Effect } from "effect";
 * import type { PackageJsonParseError } from "workspaces-effect";
 * import { WorkspaceDiscovery, WorkspaceDiscoveryLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   return yield* discovery.discover("/workspace/root");
 * }).pipe(
 *   Effect.catchTag("PackageJsonParseError", (e) =>
 *     Effect.logError(`Bad package.json at ${e.filePath}`).pipe(
 *       Effect.map(() => [])
 *     )
 *   )
 * );
 * ```
 *
 * @public
 */
export class PackageJsonParseError extends PackageJsonParseErrorBase<{
	readonly filePath: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Failed to parse package.json at "${this.filePath}": ${String(this.cause)}`;
	}
}
