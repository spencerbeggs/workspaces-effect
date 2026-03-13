/**
 * Lockfile schema definitions for Phase 4.
 */

import { Schema } from "effect";
import { PackageManager } from "./core.js";

const DepType = Schema.Literal("dependencies", "devDependencies", "peerDependencies", "optionalDependencies");

export class ResolvedPackage extends Schema.Class<ResolvedPackage>("ResolvedPackage")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	integrity: Schema.optional(Schema.String),
	isWorkspace: Schema.Boolean,
	dependencies: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
}) {}

export class WorkspaceDependency extends Schema.Class<WorkspaceDependency>("WorkspaceDependency")({
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	depType: DepType,
	constraint: Schema.String,
}) {}

export class PnpmExtension extends Schema.Class<PnpmExtension>("PnpmExtension")({
	_tag: Schema.Literal("pnpm"),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({ key: Schema.String, value: Schema.String }),
		}),
	),
	overrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	settings: Schema.optional(
		Schema.Struct({
			autoInstallPeers: Schema.optional(Schema.Boolean),
			excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
		}),
	),
}) {}

export class BunExtension extends Schema.Class<BunExtension>("BunExtension")({
	_tag: Schema.Literal("bun"),
	catalog: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	catalogs: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
		}),
	),
	overrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class LockfileData extends Schema.Class<LockfileData>("LockfileData")({
	packageManager: PackageManager,
	lockfileVersion: Schema.String,
	packages: Schema.Array(ResolvedPackage),
	workspaceDependencies: Schema.Array(WorkspaceDependency),
	pmSpecific: Schema.optional(Schema.Union(PnpmExtension, BunExtension)),
}) {}

export class LockfileIntegrity extends Schema.Class<LockfileIntegrity>("LockfileIntegrity")({
	valid: Schema.Boolean,
	missingWorkspaces: Schema.Array(Schema.String),
	extraWorkspaces: Schema.Array(Schema.String),
	unsatisfiedConstraints: Schema.Array(
		Schema.Struct({
			workspace: Schema.String,
			dependency: Schema.String,
			constraint: Schema.String,
			resolved: Schema.String,
			depType: DepType,
		}),
	),
}) {}
