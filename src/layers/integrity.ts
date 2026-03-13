import type { FileSystem, Path } from "@effect/platform";
import { Effect, Exit } from "effect";
import { Range, SemVer } from "semver-effect";
import { LockfileIntegrityError } from "../errors/index.js";
import type { LockfileData } from "../schemas/lockfile.js";
import { LockfileIntegrity } from "../schemas/lockfile.js";
import { isWorkspaceSpecifier } from "./parsers/shared.js";

const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

type DepType = (typeof DEP_TYPES)[number];

interface PackageJsonDeps {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

export const checkLockfileIntegrity = (
	lockfileData: LockfileData,
	root: string,
	fs: FileSystem.FileSystem,
	path: Path.Path,
): Effect.Effect<LockfileIntegrity, LockfileIntegrityError> =>
	Effect.gen(function* () {
		const workspacePackages = lockfileData.packages.filter((p) => p.isWorkspace);

		// Read package.json for each workspace package
		const packageJsons = yield* Effect.forEach(
			workspacePackages,
			(pkg) =>
				Effect.gen(function* () {
					const pkgJsonPath = path.join(root, pkg.name, "package.json");
					const content = yield* fs.readFileString(pkgJsonPath);
					const parsed = JSON.parse(content) as PackageJsonDeps;
					return [pkg.name, parsed] as const;
				}),
			{ concurrency: "unbounded" },
		).pipe(
			Effect.mapError(
				(e) =>
					new LockfileIntegrityError({
						reason: `Failed to read workspace package.json: ${e}`,
						cause: e,
					}),
			),
		);

		// Check workspace presence
		const lockfileWsNames = new Set(workspacePackages.map((p) => p.name));
		const pkgJsonNames = new Set(packageJsons.map(([name]) => name));
		const missingWorkspaces = [...pkgJsonNames].filter((n) => !lockfileWsNames.has(n));
		const extraWorkspaces = [...lockfileWsNames].filter((n) => !pkgJsonNames.has(n));

		// Check constraint satisfaction
		const unsatisfied = yield* checkConstraints(lockfileData, packageJsons);

		return new LockfileIntegrity({
			valid: missingWorkspaces.length === 0 && extraWorkspaces.length === 0 && unsatisfied.length === 0,
			missingWorkspaces,
			extraWorkspaces,
			unsatisfiedConstraints: unsatisfied,
		});
	});

const checkConstraints = (
	lockfileData: LockfileData,
	packageJsons: ReadonlyArray<readonly [string, PackageJsonDeps]>,
) =>
	Effect.gen(function* () {
		const resolvedIndex = new Map(lockfileData.packages.map((p) => [p.name, p.version] as const));

		const unsatisfied: Array<{
			workspace: string;
			dependency: string;
			constraint: string;
			resolved: string;
			depType: DepType;
		}> = [];

		for (const [wsName, deps] of packageJsons) {
			for (const depType of DEP_TYPES) {
				const depMap = deps[depType];
				if (!depMap) continue;

				for (const [depName, constraint] of Object.entries(depMap)) {
					if (isWorkspaceSpecifier(constraint)) {
						yield* Effect.logTrace("Skipping workspace specifier").pipe(
							Effect.annotateLogs({
								"workspace.package": depName,
								constraint,
							}),
						);
						continue;
					}

					const resolved = resolvedIndex.get(depName);
					if (!resolved) continue;

					const rangeExit = yield* Effect.exit(Range.fromString(constraint));
					const versionExit = yield* Effect.exit(SemVer.fromString(resolved));

					if (Exit.isFailure(rangeExit) || Exit.isFailure(versionExit)) {
						yield* Effect.logTrace("Skipping unparseable constraint").pipe(
							Effect.annotateLogs({
								"workspace.package": depName,
								constraint,
								resolved,
							}),
						);
						continue;
					}

					if (!Range.satisfies(versionExit.value, rangeExit.value)) {
						unsatisfied.push({
							workspace: wsName,
							dependency: depName,
							constraint,
							resolved,
							depType,
						});
					}
				}
			}
		}

		return unsatisfied;
	});
