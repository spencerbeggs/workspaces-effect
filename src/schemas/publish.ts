/**
 * Schema for package publish targets.
 */

import { Schema } from "effect";

/** A single publish target for a workspace package. */
export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
	name: Schema.NonEmptyString,
	registry: Schema.NonEmptyString,
	directory: Schema.String,
	access: Schema.Literal("public", "restricted"),
	provenance: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
