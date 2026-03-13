/**
 * LockfileReader service — reads and queries lockfile data.
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { LockfileIntegrityError } from "../errors/index.js";
import type { LockfileData, LockfileIntegrity, ResolvedPackage, WorkspaceDependency } from "../schemas/lockfile.js";

export class LockfileReader extends Context.Tag("@spencerbeggs/workspaces-effect/LockfileReader")<
	LockfileReader,
	{
		readonly readLockfile: () => Effect.Effect<LockfileData>;
		readonly resolvedVersion: (packageName: string) => Effect.Effect<Option.Option<ResolvedPackage>>;
		readonly workspaceDependencies: () => Effect.Effect<ReadonlyArray<WorkspaceDependency>>;
		readonly checkIntegrity: () => Effect.Effect<LockfileIntegrity, LockfileIntegrityError>;
	}
>() {}
