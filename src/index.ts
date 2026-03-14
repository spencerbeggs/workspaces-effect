/**
 * Effect-TS library for monorepo workspace tooling.
 *
 * Provides composable services for workspace discovery, dependency graph
 * analysis, change detection, lockfile parsing, and publishability detection
 * across npm, pnpm, yarn Berry, and Bun workspaces.
 *
 * @remarks
 * This library is built entirely on Effect and `@effect/platform` abstractions.
 * It exposes three categories of exports:
 *
 * - **Services** — `Context.Tag` definitions that describe the API contract
 *   (e.g. {@link WorkspaceRoot}, {@link DependencyGraph}).
 *
 * - **Layers** — Live implementations that satisfy those contracts
 *   (e.g. {@link WorkspaceRootLive}, {@link WorkspacesLive}).
 *
 * - **Schemas & Errors** — Effect `Schema.Class` data types and `Data.TaggedError`
 *   error types used across the API surface.
 *
 * Most consumers only need the two composite layers:
 *
 * - {@link WorkspacesLive} — all services except git-dependent ones
 *   (requires `FileSystem` + `Path`).
 * - {@link WorkspacesFullLive} — all services including git-dependent ones
 *   (additionally requires `CommandExecutor`).
 *
 * @example Quick start (Node.js)
 * ```typescript
 * import { Effect } from "effect";
 * import { NodeContext } from "@effect/platform-node";
 * import { DependencyGraph, WorkspacesLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const graph = yield* DependencyGraph;
 *   const deps = yield* graph.dependenciesOf("my-package");
 *   console.log("Dependencies:", deps);
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesLive),
 *     Effect.provide(NodeContext.layer),
 *   )
 * );
 * ```
 *
 * @example Quick start (Bun)
 * ```typescript
 * import { Effect } from "effect";
 * import { BunContext } from "@effect/platform-bun";
 * import { ChangeDetector, ChangeDetectionOptions, WorkspacesFullLive } from "workspaces-effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   const affected = yield* detector.affectedPackages(
 *     new ChangeDetectionOptions({ base: "main" })
 *   );
 *   console.log("Affected:", affected.map((p) => p.name));
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(WorkspacesFullLive),
 *     Effect.provide(BunContext.layer),
 *   )
 * );
 * ```
 *
 * @packageDocumentation
 */

// ── Errors ───────────────────────────────────────────────────────────
export {
	ChangeDetectionError,
	CyclicDependencyError,
	DependencyResolutionError,
	GitNotAvailableError,
	LockfileIntegrityError,
	LockfileParseError,
	LockfileReadError,
	PackageJsonParseError,
	PackageManagerDetectionError,
	PackageNotFoundError,
	WorkspaceDiscoveryError,
	WorkspaceRootNotFoundError,
} from "./errors/index.js";
export { ChangeDetectorLive } from "./layers/ChangeDetectorLive.js";
export { DependencyGraphLive } from "./layers/DependencyGraphLive.js";
export { LockfileReaderLive } from "./layers/LockfileReaderLive.js";
export { PackageManagerDetectorLive } from "./layers/PackageManagerDetectorLive.js";
export { PackageResolverLive } from "./layers/PackageResolverLive.js";
export { PublishabilityDetectorLive } from "./layers/PublishabilityDetectorLive.js";
export { TopologicalSorterLive } from "./layers/TopologicalSorterLive.js";
export { WorkspaceDiscoveryLive } from "./layers/WorkspaceDiscoveryLive.js";
// ── Layers ──────────────────────────────────────────────────────────
export { WorkspaceRootLive } from "./layers/WorkspaceRootLive.js";
export { WorkspacesFullLive, WorkspacesLive } from "./layers/WorkspacesLive.js";
export type {
	PackageJsonType,
	PackageManagerType,
	PackageNameType,
	PublishConfigType,
	WorkspacePathType,
} from "./schemas/core.js";
// ── Schemas ──────────────────────────────────────────────────────────
export {
	PackageJsonSchema,
	PackageManager,
	PackageName,
	PublishConfigSchema,
	WorkspaceInfo,
	WorkspacePackage,
	WorkspacePath,
} from "./schemas/core.js";
export {
	BunExtension,
	LockfileData,
	LockfileIntegrity,
	PnpmExtension,
	ResolvedPackage,
	WorkspaceDependency,
} from "./schemas/lockfile.js";
export { PublishTarget } from "./schemas/publish.js";
export { ChangeDetectionOptions, ChangeDetector } from "./services/ChangeDetector.js";
export { DependencyGraph } from "./services/DependencyGraph.js";
export { LockfileReader } from "./services/LockfileReader.js";
export type { DetectedPackageManager } from "./services/PackageManagerDetector.js";
export { PackageManagerDetector } from "./services/PackageManagerDetector.js";
export { PackageResolver } from "./services/PackageResolver.js";
export { PublishabilityDetector } from "./services/PublishabilityDetector.js";
export { TopologicalSorter } from "./services/TopologicalSorter.js";
export { WorkspaceDiscovery } from "./services/WorkspaceDiscovery.js";
// ── Services ─────────────────────────────────────────────────────────
export { WorkspaceRoot } from "./services/WorkspaceRoot.js";
