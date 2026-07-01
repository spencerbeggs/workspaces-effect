import { Data } from "effect";

/**
 * Base constant for {@link CatalogAssemblyError}.
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
export const CatalogAssemblyErrorBase = Data.TaggedError("CatalogAssemblyError");

/**
 * Raised when assembling the workspace catalog set fails irrecoverably
 * (e.g. `pnpm-workspace.yaml` unreadable/malformed, default catalog defined twice).
 * Per-config-dependency hook failures do NOT raise this — they are logged and skipped.
 *
 * @public
 */
export class CatalogAssemblyError extends CatalogAssemblyErrorBase<{
	readonly source: "manifest" | "config-dependency" | "lockfile";
	readonly reason: string;
}> {
	get message(): string {
		return `Catalog assembly failed (${this.source}): ${this.reason}`;
	}
}
