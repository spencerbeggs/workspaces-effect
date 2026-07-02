import { describe, expect, it } from "vitest";
import { GitReadError } from "../../src/errors/GitReadError.js";

describe("GitReadError", () => {
	it("carries command, cwd, reason and formats message", () => {
		const err = new GitReadError({ command: "git show HEAD:package.json", cwd: "/repo", reason: "bad object" });
		expect(err._tag).toBe("GitReadError");
		expect(err.message).toBe("git read failed in /repo: git show HEAD:package.json\nbad object");
	});
});
