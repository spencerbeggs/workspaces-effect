/**
 * Effect-TS library for monorepo workspace tooling.
 * Provides composable services for workspace discovery, dependency graph
 * analysis, and change detection across npm, pnpm, yarn Berry, and Bun.
 *
 * @packageDocumentation
 */

// ── Errors ───────────────────────────────────────────────────────────
export {
	CyclicDependencyError,
	DependencyResolutionError,
	PackageJsonParseError,
	PackageManagerDetectionError,
	PackageNotFoundError,
	WorkspaceDiscoveryError,
	WorkspaceRootNotFoundError,
} from "./errors/index.js";
// ── Layers ──────────────────────────────────────────────────────────
export { DependencyGraphLive } from "./layers/DependencyGraphLive.js";
export { DiscoveryLive } from "./layers/DiscoveryLive.js";
export { PackageManagerDetectorLive } from "./layers/PackageManagerDetectorLive.js";
export { TopologicalSorterLive } from "./layers/TopologicalSorterLive.js";
export { WorkspaceDiscoveryLive } from "./layers/WorkspaceDiscoveryLive.js";
export { WorkspaceRootLive } from "./layers/WorkspaceRootLive.js";
export type {
	PackageJsonType,
	PackageManagerType,
	PackageNameType,
	WorkspacePathType,
} from "./schemas/core.js";
// ── Schemas ──────────────────────────────────────────────────────────
export {
	PackageJsonSchema,
	PackageManager,
	PackageName,
	WorkspaceInfo,
	WorkspacePackage,
	WorkspacePath,
} from "./schemas/core.js";
export { DependencyGraph } from "./services/DependencyGraph.js";
export type { DetectedPackageManager } from "./services/PackageManagerDetector.js";
export { PackageManagerDetector } from "./services/PackageManagerDetector.js";
export { TopologicalSorter } from "./services/TopologicalSorter.js";
export { WorkspaceDiscovery } from "./services/WorkspaceDiscovery.js";
// ── Services ─────────────────────────────────────────────────────────
export { WorkspaceRoot } from "./services/WorkspaceRoot.js";
