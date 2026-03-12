/**
 * Effect-TS library for monorepo workspace tooling.
 * Provides composable services for workspace discovery, dependency graph
 * analysis, and change detection across npm, pnpm, yarn Berry, and Bun.
 *
 * @packageDocumentation
 */

// ── Errors ───────────────────────────────────────────────────────────
export {
	PackageJsonParseError,
	PackageManagerDetectionError,
	PackageNotFoundError,
	WorkspaceDiscoveryError,
	WorkspaceRootNotFoundError,
} from "./errors/index.js";
// ── Layers ──────────────────────────────────────────────────────────
export { PackageManagerDetectorLive } from "./layers/PackageManagerDetectorLive.js";
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
export type { DetectedPackageManager } from "./services/PackageManagerDetector.js";
export { PackageManagerDetector } from "./services/PackageManagerDetector.js";
export { WorkspaceDiscovery } from "./services/WorkspaceDiscovery.js";
// ── Services ─────────────────────────────────────────────────────────
export { WorkspaceRoot } from "./services/WorkspaceRoot.js";
