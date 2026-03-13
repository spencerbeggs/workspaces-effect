/**
 * PublishabilityDetector service — determines which packages are
 * publishable and where they publish to.
 */

import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspacePackage } from "../schemas/core.js";
import type { PublishTarget } from "../schemas/publish.js";

export class PublishabilityDetector extends Context.Tag("@spencerbeggs/workspaces-effect/PublishabilityDetector")<
	PublishabilityDetector,
	{
		readonly detect: (pkg: WorkspacePackage, root: string) => Effect.Effect<ReadonlyArray<PublishTarget>>;
	}
>() {}
