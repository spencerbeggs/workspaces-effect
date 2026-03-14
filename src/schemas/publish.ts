/**
 * Schema for package publish targets.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A single publish target for a workspace package.
 *
 * @remarks
 * Represents the resolved publishing configuration for a workspace package,
 * combining defaults with any overrides from the package's `publishConfig`
 * field. Used to determine where and how each package should be published.
 *
 * Fields:
 * - `name` — the package name (non-empty string).
 * - `registry` — the target registry URL (e.g., `"https://registry.npmjs.org"`).
 * - `directory` — the directory to publish (empty string means the package root).
 * - `access` — `"public"` or `"restricted"` (scoped package visibility).
 * - `provenance` — whether to publish with provenance attestation (defaults to `false`).
 *
 * @example Creating a PublishTarget
 * ```typescript
 * import { PublishTarget } from "workspaces-effect";
 *
 * const target = new PublishTarget({
 *   name: "@my-org/utils",
 *   registry: "https://registry.npmjs.org",
 *   directory: "dist/npm",
 *   access: "public",
 * });
 * ```
 *
 * @public
 */
export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
	name: Schema.NonEmptyString,
	registry: Schema.NonEmptyString,
	directory: Schema.String,
	access: Schema.Literal("public", "restricted"),
	provenance: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
