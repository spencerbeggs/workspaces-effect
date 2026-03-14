import type { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { LockfileData, ResolvedPackage } from "../schemas/lockfile.js";
import { checkLockfileIntegrity } from "./integrity.js";

// Helper: mock FileSystem that returns package.json content
const mockFs = (files: Record<string, string>): FileSystem.FileSystem =>
	({
		readFileString: (path: string) => {
			const content = files[path];
			if (content === undefined) {
				return Effect.fail(new Error(`ENOENT: ${path}`));
			}
			return Effect.succeed(content);
		},
	}) as unknown as FileSystem.FileSystem;

const mockPath: Path.Path = {
	join: (...parts: string[]) => parts.join("/"),
} as unknown as Path.Path;

describe("checkLockfileIntegrity", () => {
	it("returns valid when lockfile matches package.json", async () => {
		const lockfileData = new LockfileData({
			packageManager: "npm",
			lockfileVersion: "3",
			packages: [
				new ResolvedPackage({
					name: "@my/app",
					version: "1.0.0",
					isWorkspace: true,
				}),
				new ResolvedPackage({
					name: "lodash",
					version: "4.17.21",
					isWorkspace: false,
				}),
			],
			workspaceDependencies: [],
		});

		const fs = mockFs({
			"/project/@my/app/package.json": JSON.stringify({
				name: "@my/app",
				dependencies: { lodash: "^4.17.0" },
			}),
		});

		const result = await Effect.runPromise(checkLockfileIntegrity(lockfileData, "/project", fs, mockPath));
		expect(result.valid).toBe(true);
		expect(result.unsatisfiedConstraints).toHaveLength(0);
	});

	it("detects unsatisfied version constraints", async () => {
		const lockfileData = new LockfileData({
			packageManager: "npm",
			lockfileVersion: "3",
			packages: [
				new ResolvedPackage({
					name: "@my/app",
					version: "1.0.0",
					isWorkspace: true,
				}),
				new ResolvedPackage({
					name: "lodash",
					version: "5.0.0",
					isWorkspace: false,
				}),
			],
			workspaceDependencies: [],
		});

		const fs = mockFs({
			"/project/@my/app/package.json": JSON.stringify({
				name: "@my/app",
				dependencies: { lodash: "^4.17.0" },
			}),
		});

		const result = await Effect.runPromise(checkLockfileIntegrity(lockfileData, "/project", fs, mockPath));
		expect(result.valid).toBe(false);
		expect(result.unsatisfiedConstraints).toHaveLength(1);
		expect(result.unsatisfiedConstraints[0]?.dependency).toBe("lodash");
	});

	it("skips workspace specifiers", async () => {
		const lockfileData = new LockfileData({
			packageManager: "pnpm",
			lockfileVersion: "9.0",
			packages: [
				new ResolvedPackage({
					name: "@my/app",
					version: "1.0.0",
					isWorkspace: true,
				}),
				new ResolvedPackage({
					name: "@my/lib",
					version: "1.0.0",
					isWorkspace: true,
				}),
			],
			workspaceDependencies: [],
		});

		const fs = mockFs({
			"/project/@my/app/package.json": JSON.stringify({
				name: "@my/app",
				dependencies: { "@my/lib": "workspace:*" },
			}),
			"/project/@my/lib/package.json": JSON.stringify({
				name: "@my/lib",
			}),
		});

		const result = await Effect.runPromise(checkLockfileIntegrity(lockfileData, "/project", fs, mockPath));
		expect(result.valid).toBe(true);
	});

	it("skips unparseable constraints", async () => {
		const lockfileData = new LockfileData({
			packageManager: "npm",
			lockfileVersion: "3",
			packages: [
				new ResolvedPackage({
					name: "@my/app",
					version: "1.0.0",
					isWorkspace: true,
				}),
				new ResolvedPackage({
					name: "my-dep",
					version: "1.0.0",
					isWorkspace: false,
				}),
			],
			workspaceDependencies: [],
		});

		const fs = mockFs({
			"/project/@my/app/package.json": JSON.stringify({
				name: "@my/app",
				dependencies: {
					"my-dep": "github:user/repo#main",
				},
			}),
		});

		const result = await Effect.runPromise(checkLockfileIntegrity(lockfileData, "/project", fs, mockPath));
		// Should skip unparseable, not fail
		expect(result.valid).toBe(true);
	});
});
