/**
 * Pure workspace-glob compilation shared by live discovery
 * (`WorkspaceDiscoveryLive`) and at-ref discovery
 * (`PointInTimeWorkspaceLive.at`). Both producers MUST route pattern
 * interpretation through here so their semantics cannot drift.
 *
 * One-level wildcards only: a trailing `/**` is normalized to `/*` (the
 * pre-existing issue #62 limitation lives here and nowhere else).
 *
 * @packageDocumentation
 * @internal
 */

/**
 * A wildcard workspace pattern compiled to an enumeration prefix plus a
 * candidate predicate. Candidates are POSIX-style paths relative to the
 * workspace root (e.g. `"packages/a"`).
 *
 * @internal
 */
export interface CompiledWildcard {
	/** The original pattern text, for error messages. */
	readonly source: string;
	/** Parent directory to enumerate, `""` for root, otherwise ends with `/`. */
	readonly prefix: string;
	/** Full-candidate match (anchored; `*` = `[^/]*`, `?` = `[^/]`). */
	readonly matches: (candidate: string) => boolean;
}

/**
 * The compiled form of a `packages:` pattern list.
 *
 * @internal
 */
export interface CompiledWorkspaceGlobs {
	readonly literals: ReadonlyArray<string>;
	readonly wildcards: ReadonlyArray<CompiledWildcard>;
	/** True when a candidate dir is removed by a `!` negation pattern. */
	readonly isExcluded: (dir: string) => boolean;
}

const normalize = (pattern: string): string => pattern.replace(/\/\*\*$/, "/*");

const toRegex = (glob: string): RegExp =>
	new RegExp(
		`^${glob
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, "[^/]")}$`,
	);

/**
 * Compile a workspace `packages:` pattern list into literals, wildcards, and
 * an exclusion predicate.
 *
 * @internal
 */
export const compileWorkspaceGlobs = (patterns: ReadonlyArray<string>): CompiledWorkspaceGlobs => {
	const literals: string[] = [];
	const wildcards: CompiledWildcard[] = [];
	const excludedLiterals = new Set<string>();
	const excludedRegexes: RegExp[] = [];

	for (const raw of patterns) {
		const negated = raw.startsWith("!");
		const pattern = normalize(negated ? raw.slice(1) : raw);
		const isWildcard = pattern.includes("*") || pattern.includes("?");

		if (negated) {
			if (isWildcard) excludedRegexes.push(toRegex(pattern));
			else excludedLiterals.add(pattern);
			continue;
		}
		if (!isWildcard) {
			if (!literals.includes(pattern)) literals.push(pattern);
			continue;
		}
		const prefix = pattern.includes("/") ? pattern.slice(0, pattern.lastIndexOf("/") + 1) : "";
		const regex = toRegex(pattern);
		wildcards.push({ source: raw, prefix, matches: (candidate) => regex.test(candidate) });
	}

	const isExcluded = (dir: string): boolean =>
		excludedLiterals.has(dir) || excludedRegexes.some((regex) => regex.test(dir));

	return { literals, wildcards, isExcluded };
};
