import { Data } from "effect";

/**
 * Base constant for {@link CatalogResolutionError}.
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
export const CatalogResolutionErrorBase = Data.TaggedError("CatalogResolutionError");

/**
 * Raised when a `catalog:`/`workspace:` specifier in a manifest cannot be resolved
 * (unknown catalog, catalog misconfiguration, or unresolvable workspace reference).
 *
 * @public
 */
export class CatalogResolutionError extends CatalogResolutionErrorBase<{
	readonly field: string;
	readonly dependency: string;
	readonly specifier: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Cannot resolve ${this.field}.${this.dependency} ("${this.specifier}"): ${this.reason}`;
	}
}
