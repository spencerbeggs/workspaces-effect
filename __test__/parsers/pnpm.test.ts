import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parsePnpmLockfile } from "../../src/layers/parsers/pnpm.js";

const MINIMAL_PNPM_LOCK = `
lockfileVersion: "9.0"

importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3

  packages/core:
    dependencies:
      "@my-monorepo/utils":
        specifier: "workspace:*"
        version: link:../utils
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

  packages/utils:
    dependencies:
      chalk:
        specifier: ^5.0.0
        version: 5.3.0

packages:
  chalk@5.3.0:
    resolution:
      integrity: sha512-abc123
  lodash@4.17.21:
    resolution:
      integrity: sha512-def456
  typescript@5.3.3:
    resolution:
      integrity: sha512-ghi789
`;

describe("parsePnpmLockfile", () => {
	it("parses lockfile version", async () => {
		const result = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));
		expect(result.packageManager).toBe("pnpm");
		expect(result.lockfileVersion).toBe("9.0");
	});

	it("extracts resolved packages", async () => {
		const result = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));
		const names = result.packages.map((p) => p.name);
		expect(names).toContain("chalk");
		expect(names).toContain("lodash");
		expect(names).toContain("typescript");
	});

	it("marks workspace packages", async () => {
		const result = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));
		const nonWorkspaces = result.packages.filter((p) => !p.isWorkspace);
		expect(nonWorkspaces.length).toBeGreaterThan(0);
	});

	it("extracts workspace dependencies", async () => {
		const result = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));
		const wsDeps = result.workspaceDependencies;
		expect(wsDeps).toContainEqual(
			expect.objectContaining({
				from: expect.any(String),
				to: "@my-monorepo/utils",
				depType: "dependencies",
			}),
		);
	});

	it("fails with LockfileParseError on malformed YAML", async () => {
		const result = await Effect.runPromiseExit(parsePnpmLockfile("{{invalid yaml", "/bad/path"));
		expect(result._tag).toBe("Failure");
	});

	it("extracts pnpm catalogs into pmSpecific", async () => {
		const content = `lockfileVersion: "9.0"
catalogs:
  default:
    lodash: ^4.17.21
    chalk: ^5.0.0
importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3
packages:
  typescript@5.3.3:
    resolution:
      integrity: sha512-abc
`;
		const result = await Effect.runPromise(parsePnpmLockfile(content, "/project/pnpm-lock.yaml"));
		expect(result.pmSpecific).toBeDefined();
		expect(result.pmSpecific?._tag).toBe("pnpm");
		if (result.pmSpecific?._tag === "pnpm") {
			expect(result.pmSpecific.catalogs).toBeDefined();
			expect(result.pmSpecific.catalogs?.default?.lodash).toBe("^4.17.21");
		}
	});

	it("fails with LockfileParseError on structurally invalid pnpm-lock.yaml", async () => {
		// Valid YAML but missing required 'importers' field
		const result = await Effect.runPromiseExit(
			parsePnpmLockfile("lockfileVersion: '9.0'\n", "/project/pnpm-lock.yaml"),
		);
		expect(result._tag).toBe("Failure");
	});

	it("parses catalogs with { specifier, version } objects", async () => {
		const lockfile = `
lockfileVersion: "9.0"

catalogs:
  default:
    chalk:
      specifier: ^5.3.0
      version: 5.6.2
  silk:
    "@effect/platform":
      specifier: ">=0.78.0"
      version: 0.96.0
    effect:
      specifier: ">=3.14.0"
      version: 3.21.0

importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.3.0
        version: 5.3.3

packages:
  typescript@5.3.3:
    resolution:
      integrity: sha512-abc
`;
		const result = await Effect.runPromise(parsePnpmLockfile(lockfile, "/test/pnpm-lock.yaml"));
		expect(result.pmSpecific?._tag).toBe("pnpm");
		if (result.pmSpecific?._tag === "pnpm") {
			expect(result.pmSpecific.catalogs?.silk).toBeDefined();
			expect(result.pmSpecific.catalogs?.silk?.["@effect/platform"]).toEqual({
				specifier: ">=0.78.0",
				version: "0.96.0",
			});
			expect(result.pmSpecific.catalogs?.default?.chalk).toEqual({
				specifier: "^5.3.0",
				version: "5.6.2",
			});
		}
	});
});

describe("importers", () => {
	it("retains the specifier and the resolved version per importer and section", async () => {
		const data = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));

		const core = data.importers.find((i) => i.path === "packages/core");
		expect(core).toBeDefined();

		const lodash = core?.dependencies.find((d) => d.name === "lodash");
		expect(lodash).toEqual(
			expect.objectContaining({
				name: "lodash",
				specifier: "^4.17.21",
				version: "4.17.21",
				depType: "dependencies",
			}),
		);
	});

	it("keeps the root importer under the path '.'", async () => {
		const data = await Effect.runPromise(parsePnpmLockfile(MINIMAL_PNPM_LOCK, "/project/pnpm-lock.yaml"));

		expect(data.importers.some((i) => i.path === ".")).toBe(true);
	});
});
