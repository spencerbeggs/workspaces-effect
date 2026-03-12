/**
 * Core schema definitions for workspace types.
 */

import { Schema } from "effect";

// ── Branded Primitives ───────────────────────────────────────────────

/** Supported package managers. */
export const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun");
export type PackageManagerType = Schema.Schema.Type<typeof PackageManager>;

/** Branded package name (non-empty string). */
export const PackageName = Schema.NonEmptyString.pipe(Schema.brand("PackageName"));
export type PackageNameType = Schema.Schema.Type<typeof PackageName>;

/** Branded workspace path. */
export const WorkspacePath = Schema.NonEmptyString.pipe(Schema.brand("WorkspacePath"));
export type WorkspacePathType = Schema.Schema.Type<typeof WorkspacePath>;

// ── Package.json Schema ──────────────────────────────────────────────

/** The `workspaces` field in package.json (array or object form). */
const WorkspaceField = Schema.Union(
	Schema.Array(Schema.String),
	Schema.Struct({ packages: Schema.Array(Schema.String) }),
);

/** Minimal package.json schema for workspace discovery. */
export const PackageJsonSchema = Schema.Struct({
	name: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	private: Schema.optional(Schema.Boolean),
	workspaces: Schema.optional(WorkspaceField),
	dependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	devDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	peerDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	packageManager: Schema.optional(Schema.String),
});

export type PackageJsonType = Schema.Schema.Type<typeof PackageJsonSchema>;

// ── Workspace Data Types ─────────────────────────────────────────────

/** A single workspace package. */
export class WorkspacePackage extends Schema.Class<WorkspacePackage>("WorkspacePackage")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	path: Schema.NonEmptyString,
	relativePath: Schema.String,
	private: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	dependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
	devDependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
}) {}

/** Top-level workspace info for a monorepo. */
export class WorkspaceInfo extends Schema.Class<WorkspaceInfo>("WorkspaceInfo")({
	root: Schema.NonEmptyString,
	packageManager: PackageManager,
	packageManagerVersion: Schema.optional(Schema.String),
	patterns: Schema.Array(Schema.String),
}) {}
