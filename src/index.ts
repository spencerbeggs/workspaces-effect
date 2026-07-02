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

export type { Catalog, Catalogs } from "@pnpm/catalogs.types";
// ── Errors ───────────────────────────────────────────────────────────
export { CatalogAssemblyError, CatalogAssemblyErrorBase } from "./errors/CatalogAssemblyError.js";
export { CatalogResolutionError, CatalogResolutionErrorBase } from "./errors/CatalogResolutionError.js";
export { ChangeDetectionError, ChangeDetectionErrorBase } from "./errors/ChangeDetectionError.js";
export { CyclicDependencyError, CyclicDependencyErrorBase } from "./errors/CyclicDependencyError.js";
export { DependencyResolutionError, DependencyResolutionErrorBase } from "./errors/DependencyResolutionError.js";
export { GitNotAvailableError, GitNotAvailableErrorBase } from "./errors/GitNotAvailableError.js";
export { GitReadError, GitReadErrorBase } from "./errors/GitReadError.js";
export { LockfileIntegrityError, LockfileIntegrityErrorBase } from "./errors/LockfileIntegrityError.js";
export { LockfileParseError, LockfileParseErrorBase } from "./errors/LockfileParseError.js";
export { LockfileReadError, LockfileReadErrorBase } from "./errors/LockfileReadError.js";
export { PackageJsonParseError, PackageJsonParseErrorBase } from "./errors/PackageJsonParseError.js";
export {
	PackageManagerDetectionError,
	PackageManagerDetectionErrorBase,
} from "./errors/PackageManagerDetectionError.js";
export { PackageNotFoundError, PackageNotFoundErrorBase } from "./errors/PackageNotFoundError.js";
export { WorkspaceDiscoveryError, WorkspaceDiscoveryErrorBase } from "./errors/WorkspaceDiscoveryError.js";
export { WorkspaceRootNotFoundError, WorkspaceRootNotFoundErrorBase } from "./errors/WorkspaceRootNotFoundError.js";
export type { CatalogResolverLiveLayer } from "./layers/CatalogResolverLive.js";
export { CatalogResolverLive } from "./layers/CatalogResolverLive.js";
export { ChangeDetectorLive } from "./layers/ChangeDetectorLive.js";
export type { ManifestLike } from "./layers/catalog/resolve.js";
export type { WorkspaceManifestCatalogs, WorkspaceManifestData } from "./layers/catalog/workspace-manifest.js";
export { workspaceManifestFromYaml } from "./layers/catalog/workspace-manifest.js";
export { DependencyGraphLive } from "./layers/DependencyGraphLive.js";
export type { LockfileReaderLiveLayer } from "./layers/LockfileReaderLive.js";
export { LockfileReaderLive } from "./layers/LockfileReaderLive.js";
export { PackageManagerDetectorLive } from "./layers/PackageManagerDetectorLive.js";
export { PackageResolverLive } from "./layers/PackageResolverLive.js";
export { PublishabilityDetectorLive } from "./layers/PublishabilityDetectorLive.js";
export { TopologicalSorterLive } from "./layers/TopologicalSorterLive.js";
export { WorkspaceDiscoveryLive } from "./layers/WorkspaceDiscoveryLive.js";
// ── Layers ──────────────────────────────────────────────────────────
export { WorkspaceRootLive } from "./layers/WorkspaceRootLive.js";
export { WorkspacesFullLive, WorkspacesLive } from "./layers/WorkspacesLive.js";
// ── Schemas ──────────────────────────────────────────────────────────
export { CatalogSet } from "./schemas/CatalogSet.js";
export type {
	DependencyDiff,
	PackageJsonType,
	PackageManagerType,
	PackageNameType,
	PublishConfigType,
	WorkspacePathType,
} from "./schemas/core.js";
export {
	PackageJsonSchema,
	PackageManager,
	PackageName,
	PublishConfig,
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
export type { CatalogResolverError } from "./services/CatalogResolver.js";
export { CatalogResolver } from "./services/CatalogResolver.js";
export { ChangeDetectionOptions, ChangeDetector } from "./services/ChangeDetector.js";
export { DependencyGraph } from "./services/DependencyGraph.js";
export type { LockfileInitError } from "./services/LockfileReader.js";
export { LockfileReader } from "./services/LockfileReader.js";
export type { DetectedPackageManager } from "./services/PackageManagerDetector.js";
export { PackageManagerDetector } from "./services/PackageManagerDetector.js";
export { PackageResolver } from "./services/PackageResolver.js";
export { PublishabilityDetector } from "./services/PublishabilityDetector.js";
export { TopologicalSorter } from "./services/TopologicalSorter.js";
export { WorkspaceDiscovery } from "./services/WorkspaceDiscovery.js";
// ── Services ─────────────────────────────────────────────────────────
export { WorkspaceRoot } from "./services/WorkspaceRoot.js";
// ── Sync API ────────────────────────────────────────────────────────
export { findWorkspaceRootSync, getWorkspacePackagesSync } from "./sync.js";
// ── Utils ────────────────────────────────────────────────────────────
export {
	dependencyDiff,
	dependencyVersion,
	hasAnyDependencyOn,
	hasDependency,
	hasDevDependency,
	hasOptionalDependency,
	hasPeerDependency,
	matchesDependency,
	readPackageJson,
} from "./utils/workspace-package.js";

// ── Wire cross-cutting static methods (avoids circular imports) ─────────

import { WorkspacePackage as _WP } from "./schemas/core.js";
import {
	dependencyDiff as _dependencyDiff,
	dependencyVersion as _dependencyVersion,
	hasAnyDependencyOn as _hasAnyDependencyOn,
	hasDependency as _hasDependency,
	hasDevDependency as _hasDevDependency,
	hasOptionalDependency as _hasOptionalDependency,
	hasPeerDependency as _hasPeerDependency,
	matchesDependency as _matchesDependency,
	readPackageJson as _readPackageJson,
} from "./utils/workspace-package.js";

// WorkspacePackage statics
_WP.hasDependency = _hasDependency;
_WP.hasDevDependency = _hasDevDependency;
_WP.hasPeerDependency = _hasPeerDependency;
_WP.hasOptionalDependency = _hasOptionalDependency;
_WP.hasAnyDependencyOn = _hasAnyDependencyOn;
_WP.dependencyVersion = _dependencyVersion;
_WP.matchesDependency = _matchesDependency;
_WP.dependencyDiff = _dependencyDiff;
_WP.readPackageJson = _readPackageJson;
