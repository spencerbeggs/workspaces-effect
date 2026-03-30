/**
 * Shared mock filesystem factory for unit tests.
 */

import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect } from "effect";

const enoent = (path: string) =>
	new SystemError({
		reason: "NotFound",
		module: "FileSystem",
		method: "readFileString",
		pathOrDescriptor: path,
		syscall: "open",
	});

/**
 * Create a mock FileSystem layer for testing.
 * `files` maps absolute paths to file contents (string) or existence markers (true).
 * `dirs` maps absolute paths to arrays of directory entry names.
 */
export const mockFs = (files: Record<string, string | true>, dirs: Record<string, string[]> = {}) =>
	FileSystem.layerNoop({
		exists: (path) => Effect.succeed(path in files || path in dirs),
		readFileString: (path) => {
			const content = files[path];
			if (content === undefined) {
				return Effect.fail(enoent(path));
			}
			return Effect.succeed(typeof content === "string" ? content : "");
		},
		readDirectory: (path) => {
			const entries = dirs[path];
			if (entries === undefined) {
				return Effect.fail(enoent(path));
			}
			return Effect.succeed(entries);
		},
	});
