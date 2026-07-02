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
	/** name → version map for workspace: resolution. */
	get versions(): Record<string, string> {
		const map: Record<string, string> = {};
		for (const pkg of this.packages) map[pkg.name] = pkg.version;
		return map;
	}

	/** Find a package snapshot by name. */
	package(name: string): Option.Option<PackageStateSnapshot> {
		const found = this.packages.find((p) => p.name === name);
		return found ? Option.some(found) : Option.none();
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
