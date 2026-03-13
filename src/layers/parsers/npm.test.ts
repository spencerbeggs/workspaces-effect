import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseNpmLockfile } from "./npm.js";

const MINIMAL_NPM_LOCK = JSON.stringify({
	name: "my-monorepo",
	version: "1.0.0",
	lockfileVersion: 3,
	requires: true,
	packages: {
		"": {
			name: "my-monorepo",
			version: "1.0.0",
			workspaces: ["packages/*"],
			devDependencies: { typescript: "^5.3.0" },
		},
		"packages/app": {
			name: "@my-monorepo/app",
			version: "1.0.0",
			dependencies: {
				"@my-monorepo/lib": "*",
				express: "^4.18.0",
			},
		},
		"packages/lib": {
			name: "@my-monorepo/lib",
			version: "1.0.0",
			dependencies: { zod: "^3.22.0" },
		},
		"node_modules/@my-monorepo/app": {
			resolved: "packages/app",
			link: true,
		},
		"node_modules/@my-monorepo/lib": {
			resolved: "packages/lib",
			link: true,
		},
		"node_modules/express": {
			version: "4.21.2",
			integrity: "sha512-abc",
		},
		"node_modules/zod": {
			version: "3.23.8",
			integrity: "sha512-def",
		},
		"node_modules/typescript": {
			version: "5.3.3",
			integrity: "sha512-ghi",
			dev: true,
		},
	},
});

describe("parseNpmLockfile", () => {
	it("parses lockfile version", async () => {
		const result = await Effect.runPromise(parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"));
		expect(result.packageManager).toBe("npm");
		expect(result.lockfileVersion).toBe("3");
	});

	it("extracts resolved packages from node_modules", async () => {
		const result = await Effect.runPromise(parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"));
		const names = result.packages.map((p) => p.name);
		expect(names).toContain("express");
		expect(names).toContain("zod");
	});

	it("identifies workspace packages via link entries", async () => {
		const result = await Effect.runPromise(parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"));
		const ws = result.packages.filter((p) => p.isWorkspace);
		const wsNames = ws.map((p) => p.name);
		expect(wsNames).toContain("@my-monorepo/app");
		expect(wsNames).toContain("@my-monorepo/lib");
	});

	it("extracts workspace dependencies", async () => {
		const result = await Effect.runPromise(parseNpmLockfile(MINIMAL_NPM_LOCK, "/project/package-lock.json"));
		expect(result.workspaceDependencies).toContainEqual(
			expect.objectContaining({
				to: "@my-monorepo/lib",
				depType: "dependencies",
			}),
		);
	});

	it("fails with LockfileParseError on invalid JSON", async () => {
		const result = await Effect.runPromiseExit(parseNpmLockfile("{invalid", "/bad/path"));
		expect(result._tag).toBe("Failure");
	});
});
