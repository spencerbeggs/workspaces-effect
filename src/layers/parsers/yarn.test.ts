import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseYarnLockfile } from "./yarn.js";

const MINIMAL_YARN_LOCK = `\
__metadata:
  version: 8
  cacheKey: 10c0

"my-monorepo@workspace:.":
  version: 0.0.0-use.local
  resolution: "my-monorepo@workspace:."
  dependencies:
    "@my-monorepo/web": "workspace:*"
    "@my-monorepo/shared": "workspace:*"
  devDependencies:
    typescript: "npm:^5.3.0"
  languageName: unknown
  linkType: soft

"@my-monorepo/web@workspace:packages/web":
  version: 0.0.0-use.local
  resolution: "@my-monorepo/web@workspace:packages/web"
  dependencies:
    "@my-monorepo/shared": "workspace:*"
    react: "npm:^18.2.0"
  languageName: unknown
  linkType: soft

"@my-monorepo/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@my-monorepo/shared@workspace:packages/shared"
  dependencies:
    date-fns: "npm:^3.0.0"
  languageName: unknown
  linkType: soft

"react@npm:^18.2.0":
  version: 18.3.1
  resolution: "react@npm:18.3.1"
  checksum: abc123
  languageName: node
  linkType: hard

"date-fns@npm:^3.0.0":
  version: 3.6.0
  resolution: "date-fns@npm:3.6.0"
  checksum: def456
  languageName: node
  linkType: hard

"typescript@npm:^5.3.0":
  version: 5.3.3
  resolution: "typescript@npm:5.3.3"
  checksum: ghi789
  languageName: node
  linkType: hard
`;

describe("parseYarnLockfile", () => {
	it("parses lockfile version from metadata", async () => {
		const result = await Effect.runPromise(parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"));
		expect(result.packageManager).toBe("yarn");
		expect(result.lockfileVersion).toBe("8");
	});

	it("identifies workspace packages by linkType soft", async () => {
		const result = await Effect.runPromise(parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"));
		const ws = result.packages.filter((p) => p.isWorkspace);
		const names = ws.map((p) => p.name);
		expect(names).toContain("@my-monorepo/web");
		expect(names).toContain("@my-monorepo/shared");
	});

	it("extracts resolved non-workspace packages", async () => {
		const result = await Effect.runPromise(parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"));
		const nonWs = result.packages.filter((p) => !p.isWorkspace);
		const names = nonWs.map((p) => p.name);
		expect(names).toContain("react");
		expect(names).toContain("date-fns");
	});

	it("extracts workspace dependencies", async () => {
		const result = await Effect.runPromise(parseYarnLockfile(MINIMAL_YARN_LOCK, "/project/yarn.lock"));
		expect(result.workspaceDependencies).toContainEqual(
			expect.objectContaining({
				to: "@my-monorepo/shared",
				depType: "dependencies",
			}),
		);
	});

	it("fails on malformed YAML", async () => {
		const result = await Effect.runPromiseExit(parseYarnLockfile("{{bad", "/bad"));
		expect(result._tag).toBe("Failure");
	});

	it("fails with LockfileParseError on yarn.lock entry that is not an object", async () => {
		// Valid YAML structure but an entry value is a scalar, not a struct
		const BAD_ENTRY = `\
__metadata:
  version: 8

"pkg@npm:1.0.0": "this is a string not an object"
`;
		const result = await Effect.runPromiseExit(parseYarnLockfile(BAD_ENTRY, "/bad"));
		expect(result._tag).toBe("Failure");
	});
});
