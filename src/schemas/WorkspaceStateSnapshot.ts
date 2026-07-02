import { Option, Schema } from "effect";
import { resolveWorkspaceProtocol } from "../layers/catalog/resolve.js";
import { CatalogSet } from "./CatalogSet.js";

const DepRecord = Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
	default: () => ({}),
});

/**
 * One workspace package as it existed at a point in time.
 *
 * @public
 */
export class PackageStateSnapshot extends Schema.Class<PackageStateSnapshot>("PackageStateSnapshot")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	relativePath: Schema.String,
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalDependencies: DepRecord,
}) {}

/**
 * The full workspace state at a point in time: every package plus that
 * moment's assembled catalogs. `resolve` answers "what did this specifier
 * mean HERE" — catalog: against this snapshot's catalogs, workspace:
 * against this snapshot's package versions.
 *
 * @public
 */
export class WorkspaceStateSnapshot extends Schema.Class<WorkspaceStateSnapshot>("WorkspaceStateSnapshot")({
	packages: Schema.Array(PackageStateSnapshot),
	catalogs: CatalogSet,
}) {
	// Lazily built, instance-cached indexes. Snapshots are immutable value
	// objects, so computing once is safe; private fields sit outside the
	// schema's declared fields and never encode.
	#versions: Record<string, string> | undefined;
	#byName: Map<string, PackageStateSnapshot> | undefined;

	/**
	 * name → version map for workspace: resolution. Stable reference.
	 *
	 * @remarks
	 * The returned record is this instance's memo, built once and reused by
	 * every subsequent `resolve` call. Treat it as
	 * read-only -- mutating it corrupts resolution for the lifetime of this
	 * snapshot.
	 */
	get versions(): Record<string, string> {
		if (this.#versions === undefined) {
			const map: Record<string, string> = {};
			for (const pkg of this.packages) map[pkg.name] = pkg.version;
			this.#versions = map;
		}
		return this.#versions;
	}

	/** Find a package snapshot by name (O(1) after the first call). */
	package(name: string): Option.Option<PackageStateSnapshot> {
		if (this.#byName === undefined) {
			this.#byName = new Map(this.packages.map((pkg) => [pkg.name, pkg]));
		}
		const found = this.#byName.get(name);
		return found === undefined ? Option.none() : Option.some(found);
	}

	/**
	 * Resolve a catalog:/workspace: specifier against THIS snapshot.
	 * `Option.none` for plain specifiers and unresolvable references.
	 */
	resolve(dependency: string, specifier: string): Option.Option<string> {
		if (specifier.startsWith("workspace:")) {
			const version = this.versions[dependency];
			return version === undefined ? Option.none() : Option.some(resolveWorkspaceProtocol(specifier, version));
		}
		return this.catalogs.resolveSpecifier(dependency, specifier);
	}
}
