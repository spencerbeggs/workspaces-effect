---
title: "Lockfile Schema Definitions"
module: core
category: reference
status: complete
completeness: 95
created: 2026-03-12
updated: 2026-03-12
last-synced: 2026-03-12
related:
  - architecture.md
  - phase4-configuration-lockfiles.md
  - bun-lockfile.md
  - effect-best-practices.md
authors:
  - C. Spencer Beggs
tags:
  - lockfile
  - schema
  - reference
  - phase4
---

## Lockfile Schema Definitions

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [pnpm-lock.yaml v9 Schema](#pnpm-lockyaml-v9-schema)
- [package-lock.json v3 Schema](#package-lockjson-v3-schema)
- [yarn.lock Berry Schema](#yarnlock-berry-schema)
- [bun.lock Schema](#bunlock-schema)
- [Unified Transformation Model](#unified-transformation-model)
- [Parsing Pipeline](#parsing-pipeline)
- [Rationale](#rationale)

<!-- /TOC -->

## Overview

This document defines the complete Effect Schema definitions for all four
lockfile formats supported by `workspaces-effect`. These schemas serve as
implementation blueprints for the Phase 4 `LockfileReader` service. Each
lockfile format has a "raw" schema for parsing the on-disk format, plus a
transformation function to the unified `LockfileData` model.

The four formats are:

1. **pnpm-lock.yaml** v9 -- YAML format with importers and packages maps
2. **package-lock.json** v3 -- JSON format with flat packages map
3. **yarn.lock** (Berry) -- YAML format with package identifier keys
4. **bun.lock** -- JSONC format with workspace map and tuple-encoded packages

## Current State

Schema definitions drafted 2026-03-12. Based on research from
`phase4-configuration-lockfiles.md`, `bun-lockfile.md`, sibling repo findings,
and official lockfile format documentation. Ready for implementation review.

## pnpm-lock.yaml v9 Schema

### Real-world structure

```yaml
lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
overrides:
  '@isaacs/brace-expansion': ^5.0.1
  lodash: ^4.17.23
pnpmfileChecksum: sha256-...
importers:
  .:
    dependencies:
      '@effect/platform':
        specifier: ^0.94.5
        version: 0.94.5(effect@3.19.19)
    devDependencies:
      '@savvy-web/changesets':
        specifier: ^0.4.2
        version: 0.4.2(hash)
    publishDirectory: dist/dev
  packages/ui:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.0.0
packages:
  '@ast-grep/napi-darwin-arm64@0.37.0':
    resolution: {integrity: sha512-...}
    engines: {node: '>= 10'}
    cpu: [arm64]
    os: [darwin]
  react@19.0.0:
    resolution: {integrity: sha512-...}
    engines: {node: '>= 16'}
```

### Schema definitions

```typescript
import { Schema } from "effect"

/**
 * Settings block in pnpm-lock.yaml.
 * Controls pnpm install behavior captured at lockfile generation time.
 */
const PnpmLockfileSettings = Schema.Struct({
 autoInstallPeers: Schema.optional(Schema.Boolean),
 excludeLinksFromLockfile: Schema.optional(Schema.Boolean),
})
type PnpmLockfileSettings = Schema.Schema.Type<typeof PnpmLockfileSettings>

/**
 * A single dependency entry within an importer.
 * `specifier` is what package.json declares (e.g., "^19.0.0", "catalog:").
 * `version` is the resolved version with optional peer suffix
 * (e.g., "19.0.0", "0.94.5(effect@3.19.19)").
 */
const PnpmImporterDependency = Schema.Struct({
 specifier: Schema.String,
 version: Schema.String,
})
type PnpmImporterDependency = Schema.Schema.Type<typeof PnpmImporterDependency>

/**
 * Dependency map: package name -> specifier + version.
 */
const PnpmDependencyMap = Schema.Record({
 key: Schema.String,
 value: PnpmImporterDependency,
})

/**
 * An importer represents a workspace package in pnpm-lock.yaml.
 * Keys in the parent `importers` map are relative paths from root
 * ("." for root, "packages/ui" for a workspace package).
 */
const PnpmImporter = Schema.Struct({
 dependencies: Schema.optional(PnpmDependencyMap),
 devDependencies: Schema.optional(PnpmDependencyMap),
 peerDependencies: Schema.optional(PnpmDependencyMap),
 optionalDependencies: Schema.optional(PnpmDependencyMap),
 publishDirectory: Schema.optional(Schema.String),
})
type PnpmImporter = Schema.Schema.Type<typeof PnpmImporter>

/**
 * Resolution info for a resolved package.
 * The `integrity` field contains an SRI hash (e.g., "sha512-...").
 * Some packages use `tarball` or `directory` instead of registry resolution.
 */
const PnpmPackageResolution = Schema.Struct({
 integrity: Schema.optional(Schema.String),
 tarball: Schema.optional(Schema.String),
 directory: Schema.optional(Schema.String),
})
type PnpmPackageResolution = Schema.Schema.Type<typeof PnpmPackageResolution>

/**
 * A resolved package entry in the `packages` map.
 * Keys are `name@version` identifiers (e.g., "react@19.0.0").
 *
 * pnpm v9 moved from nested `dependencies`/`peerDependencies` in the
 * packages map to encoding those in the importer version strings
 * (the parenthesized peer suffix). The packages map in v9 is simpler
 * than earlier versions.
 */
const PnpmPackageEntry = Schema.Struct({
 resolution: PnpmPackageResolution,
 engines: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 cpu: Schema.optional(Schema.Array(Schema.String)),
 os: Schema.optional(Schema.Array(Schema.String)),
 libc: Schema.optional(Schema.Array(Schema.String)),
 deprecated: Schema.optional(Schema.String),
 hasBin: Schema.optional(Schema.Boolean),
 requiresBuild: Schema.optional(Schema.Boolean),
 bundledDependencies: Schema.optional(Schema.Array(Schema.String)),
 peerDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 peerDependenciesMeta: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Struct({
    optional: Schema.optional(Schema.Boolean),
   }),
  }),
 ),
 dependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
})
type PnpmPackageEntry = Schema.Schema.Type<typeof PnpmPackageEntry>

/**
 * Top-level pnpm-lock.yaml v9 schema.
 *
 * Key structural elements:
 * - `lockfileVersion` is a string ("9.0") not a number
 * - `importers` contains workspace packages keyed by relative path
 * - `packages` contains resolved dependencies keyed by name@version
 * - `settings` captures pnpm install configuration
 * - `overrides` maps package names to forced version ranges
 * - `pnpmfileChecksum` is a SHA-256 hash of .pnpmfile.cjs if present
 */
const PnpmLockfileRaw = Schema.Struct({
 lockfileVersion: Schema.String,
 settings: Schema.optional(PnpmLockfileSettings),
 overrides: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 pnpmfileChecksum: Schema.optional(Schema.String),
 importers: Schema.Record({
  key: Schema.String,
  value: PnpmImporter,
 }),
 packages: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: PnpmPackageEntry,
  }),
 ),
 snapshots: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Unknown,
  }),
 ),
})
type PnpmLockfileRaw = Schema.Schema.Type<typeof PnpmLockfileRaw>
```

### Key parsing notes

- `lockfileVersion` is a **string** in YAML (`'9.0'`), not a number.
- Importer dependency versions may contain peer suffixes in parentheses:
  `0.94.5(effect@3.19.19)`. The base version must be extracted by splitting
  on `(`.
- Workspace inter-dependencies use `link:` prefix in the version field:
  `link:../packages/ui`. The specifier shows `workspace:*` or similar.
- The `snapshots` map (pnpm v9) contains flattened dependency resolution
  snapshots. It is not needed for basic lockfile queries but is included
  as `Schema.Unknown` for completeness.
- pnpm catalogs are encoded in the `specifier` field as `catalog:` or
  `catalog:<name>`. The resolved version is in the `version` field.

## package-lock.json v3 Schema

### Real-world structure

```json
{
  "name": "monorepo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "monorepo",
      "version": "1.0.0",
      "workspaces": ["packages/*"]
    },
    "node_modules/react": {
      "version": "19.0.0",
      "resolved": "https://registry.npmjs.org/react/-/react-19.0.0.tgz",
      "integrity": "sha512-...",
      "license": "MIT",
      "dependencies": {
        "loose-envify": "^1.1.0"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "packages/ui": {
      "version": "1.0.0",
      "license": "MIT",
      "dependencies": {
        "react": "^19.0.0"
      }
    },
    "node_modules/@scope/ui": {
      "resolved": "packages/ui",
      "link": true
    }
  }
}
```

### Schema definitions

```typescript
import { Schema } from "effect"

/**
 * A package entry in the npm `packages` flat map.
 *
 * Keys follow these patterns:
 * - `""` — root project
 * - `"node_modules/<name>"` — top-level installed package
 * - `"node_modules/<scope>/<name>"` — scoped package
 * - `"packages/<name>"` — workspace package source directory
 * - `"node_modules/<scope>/<name>"` with `link: true` — symlink to workspace
 *
 * Workspace packages appear twice: once at their source path (with full
 * metadata) and once as a symlink in node_modules (with `link: true`
 * and `resolved` pointing to the source path).
 */
const NpmPackageEntry = Schema.Struct({
 /** Package name (present on root entry and some workspace entries). */
 name: Schema.optional(Schema.String),
 /** Resolved version string. */
 version: Schema.optional(Schema.String),
 /** Registry URL for the resolved tarball. */
 resolved: Schema.optional(Schema.String),
 /** SRI integrity hash (e.g., "sha512-..."). */
 integrity: Schema.optional(Schema.String),
 /** Whether this entry is a symlink to a workspace package. */
 link: Schema.optional(Schema.Boolean),
 /** SPDX license identifier. */
 license: Schema.optional(Schema.String),
 /** Production dependencies. */
 dependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Development dependencies. */
 devDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Peer dependencies. */
 peerDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Peer dependency optional flags. */
 peerDependenciesMeta: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Struct({
    optional: Schema.optional(Schema.Boolean),
   }),
  }),
 ),
 /** Optional dependencies. */
 optionalDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Funding information. */
 funding: Schema.optional(Schema.Unknown),
 /** Whether this is a bundled dependency. */
 inBundle: Schema.optional(Schema.Boolean),
 /** Whether this is a dev-only dependency. */
 dev: Schema.optional(Schema.Boolean),
 /** Whether this is an optional dependency. */
 optional: Schema.optional(Schema.Boolean),
 /** Whether this package has an install script. */
 hasInstallScript: Schema.optional(Schema.Boolean),
 /** Engine constraints. */
 engines: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** OS constraints. */
 os: Schema.optional(Schema.Array(Schema.String)),
 /** CPU constraints. */
 cpu: Schema.optional(Schema.Array(Schema.String)),
 /** Workspace glob patterns (only on root entry). */
 workspaces: Schema.optional(
  Schema.Union(
   Schema.Array(Schema.String),
   Schema.Struct({ packages: Schema.Array(Schema.String) }),
  ),
 ),
 /** Executable binaries. */
 bin: Schema.optional(
  Schema.Union(
   Schema.String,
   Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
 ),
})
type NpmPackageEntry = Schema.Schema.Type<typeof NpmPackageEntry>

/**
 * Top-level package-lock.json v3 schema.
 *
 * npm v7+ uses lockfileVersion 3 (or 2 with backwards compat).
 * The `packages` map is the canonical data structure; the legacy
 * `dependencies` tree (lockfileVersion 1) is not included here.
 */
const NpmLockfileRaw = Schema.Struct({
 /** Root package name from package.json. */
 name: Schema.String,
 /** Root package version from package.json. */
 version: Schema.optional(Schema.String),
 /** Lockfile format version. Must be 3 (or 2 for compat mode). */
 lockfileVersion: Schema.Number,
 /** Whether `requires` reflects dependency relationships. */
 requires: Schema.optional(Schema.Boolean),
 /** Flat map of all packages keyed by location path. */
 packages: Schema.Record({
  key: Schema.String,
  value: NpmPackageEntry,
 }),
})
type NpmLockfileRaw = Schema.Schema.Type<typeof NpmLockfileRaw>
```

### Key parsing notes

- `lockfileVersion` is a **number** (3), unlike pnpm's string.
- The root project entry uses the empty string key `""`.
- Workspace packages appear at their source directory path (e.g.,
  `"packages/ui"`) with full metadata, and also as symlinks under
  `node_modules/` with `link: true`.
- To identify workspace packages: find entries at source paths that do NOT
  start with `node_modules/` and are NOT the root entry `""`.
- The `link: true` entries' `resolved` field points to the source directory.
- Inter-workspace dependencies: a workspace package's `dependencies` map
  references another workspace package by name; the corresponding
  `node_modules/<name>` entry will have `link: true`.

## yarn.lock Berry Schema

### Real-world structure

```yaml
__metadata:
  version: 8
  cacheKey: 10c0

"lodash@npm:^4.17.0, lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: d8e86a09ab0ae4406a3a1ae905a65d43d1ce1deca40d12512fbb2ec5b4fa170e17c5bf96a0b462a60be00e85de40ebc6f1b13398e25ca2f8c0da3551c1807cb5a
  bin:
    lodash: bin/lodash.js
  languageName: node
  linkType: hard

"@repo/ui@workspace:packages/ui":
  version: 0.0.0-use.local
  resolution: "@repo/ui@workspace:packages/ui"
  dependencies:
    react: "npm:^19.0.0"
  peerDependencies:
    react-dom: "*"
  peerDependenciesMeta:
    react-dom:
      optional: true
  languageName: unknown
  linkType: soft

"root-workspace@workspace:.":
  version: 0.0.0-use.local
  resolution: "root-workspace@workspace:."
  dependencies:
    "@repo/ui": "workspace:*"
    react: "npm:^19.0.0"
  dependenciesMeta:
    fsevents:
      optional: true
  languageName: unknown
  linkType: soft
```

### Schema definitions

```typescript
import { Schema } from "effect"

/**
 * Metadata block at the top of yarn.lock Berry format.
 *
 * The `__metadata` key is always the first entry in the lockfile.
 * - `version` is the lockfile schema version (integer; currently 8 for Yarn 4).
 * - `cacheKey` is an integer used for cache invalidation (currently 10).
 *
 * The presence of `__metadata` distinguishes Yarn Berry lockfiles from
 * Yarn Classic, which uses a non-standard format without this header.
 */
const YarnBerryMetadata = Schema.Struct({
 version: Schema.Number,
 cacheKey: Schema.optional(Schema.Number),
})
type YarnBerryMetadata = Schema.Schema.Type<typeof YarnBerryMetadata>

/**
 * A package entry in yarn.lock Berry format.
 *
 * Keys in the lockfile are package descriptors like:
 * - `"lodash@npm:^4.17.21"` -- npm registry package
 * - `"@repo/ui@workspace:packages/ui"` -- workspace package
 * - `"root-workspace@workspace:."` -- root workspace
 *
 * Multiple descriptors resolving to the same package share a single YAML
 * key joined with `, ` (comma-space). Standard YAML parsers read this as
 * a single string key; the consumer must split on `, ` to recover each
 * individual descriptor.
 *
 * Field names and semantics are derived from Yarn's `Project.ts`
 * `generateLockfile()` method.
 *
 * Workspace entries are identified by:
 * - `linkType: "soft"`
 * - `languageName: "unknown"`
 * - `version: "0.0.0-use.local"`
 * - `resolution` containing the `workspace:` protocol
 */
const YarnBerryPackageEntry = Schema.Struct({
 /**
  * Resolved version string.
  * For npm packages: the concrete version (e.g., "4.17.21").
  * For workspace packages: always "0.0.0-use.local".
  */
 version: Schema.String,
 /**
  * Locator string in the format `name@protocol:reference`.
  * Examples:
  * - `"lodash@npm:4.17.21"` (npm package)
  * - `"@repo/ui@workspace:packages/ui"` (workspace package)
  *
  * Unlike Yarn Classic, Berry has no separate `resolved` or `integrity`
  * fields. The `resolution` field serves as the canonical locator.
  */
 resolution: Schema.String,
 /**
  * Production dependencies as a map of package name to version range.
  * In Yarn 4, ranges include the `npm:` prefix (e.g., `"npm:^5.1.6"`).
  * Yarn 3 does not include the `npm:` prefix.
  */
 dependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Peer dependencies as a map of package name to version range. */
 peerDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /**
  * Metadata about dependencies (e.g., marking a dependency as optional).
  * Structure: `{ [depName]: { optional?: boolean } }`.
  */
 dependenciesMeta: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Struct({
    optional: Schema.optional(Schema.Boolean),
   }),
  }),
 ),
 /**
  * Metadata about peer dependencies (e.g., marking a peer as optional).
  * Structure: `{ [peerName]: { optional?: boolean } }`.
  */
 peerDependenciesMeta: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Struct({
    optional: Schema.optional(Schema.Boolean),
   }),
  }),
 ),
 /**
  * Map of binary names to file paths (e.g., `{ lodash: "bin/lodash.js" }`).
  */
 bin: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /**
  * Language name. Required for all entries.
  * - `"node"` for packages fetched from the npm registry
  * - `"unknown"` for workspace packages
  */
 languageName: Schema.String,
 /**
  * Link type. Required for all entries.
  * - `"hard"` for fetched packages (copied into cache)
  * - `"soft"` for workspace packages (symlinked)
  */
 linkType: Schema.Literal("hard", "soft"),
 /**
  * Hex hash checksum for integrity verification.
  * This is a plain hex string (NOT SRI format like `sha512-...`).
  * Absent for workspace packages (which are local, not fetched).
  */
 checksum: Schema.optional(Schema.String),
 /**
  * Environment constraints for conditional dependencies.
  * Uses Yarn's constraint syntax (e.g., `"os=linux & cpu=x64"`).
  */
 conditions: Schema.optional(Schema.String),
})
type YarnBerryPackageEntry = Schema.Schema.Type<typeof YarnBerryPackageEntry>

/**
 * Top-level yarn.lock Berry schema.
 *
 * The lockfile is valid YAML where:
 * - `__metadata` is a reserved key for lockfile metadata
 * - All other keys are package descriptors mapping to resolution entries
 *
 * Because the top level mixes `__metadata` with dynamic package keys,
 * we parse as a Record and extract `__metadata` separately during
 * transformation.
 *
 * Implementation note: After YAML parsing, split the result:
 * ```typescript
 * const { __metadata, ...packageEntries } = parsed
 * ```
 * Then decode `__metadata` with `YarnBerryMetadata` and each
 * package entry with `YarnBerryPackageEntry`.
 */
const YarnBerryLockfileRaw = Schema.Record({
 key: Schema.String,
 value: Schema.Unknown,
})
type YarnBerryLockfileRaw = Schema.Schema.Type<typeof YarnBerryLockfileRaw>
```

### Key parsing notes

- Yarn Berry's lockfile is valid YAML with a flat structure where every
  top-level key (except `__metadata`) is a package descriptor.
- **Detecting Berry vs. Classic**: The presence of `__metadata` at the top
  level indicates a Berry lockfile. Yarn Classic uses a non-standard format
  that is not valid YAML and has no `__metadata` header.
- **Comma-separated key splitting**: Multiple descriptors resolving to the
  same package are joined into a single YAML key with comma-space as the
  separator (e.g., `"lodash@npm:^4.17.0, lodash@npm:^4.17.21"`). Standard
  YAML parsers return this as one string key. The parser must split on the
  comma-space sequence to recover individual descriptors for dependency
  resolution.
- **`npm:` prefix in Yarn 4 dependency ranges**: Yarn 4 adds an `npm:`
  protocol prefix to dependency version ranges (e.g.,
  `typescript: "npm:^5.1.6"`). Yarn 3 lockfiles omit this prefix. The
  parser should handle both forms by stripping the `npm:` prefix when
  normalizing ranges.
- Workspace packages have `workspace:` protocol in their `resolution` string,
  `linkType: "soft"`, `languageName: "unknown"`, and
  `version: "0.0.0-use.local"`.
- npm packages have `npm:` protocol in their `resolution` string and
  `linkType: "hard"`.
- Inter-workspace dependencies use the `workspace:` protocol in dependency
  values (e.g., `"@repo/ui": "workspace:*"`).
- Unlike Yarn Classic, Berry has no `integrity` or `resolved` fields. The
  `resolution` field is the canonical locator, and `checksum` is a hex hash
  (not SRI format) used for integrity verification.
- The `__metadata` key must be filtered out before iterating package entries.
- Both `languageName` and `linkType` are required on every package entry.

### Two-phase parsing strategy

Because the top-level structure mixes metadata with package entries, parsing
requires two phases:

```typescript
const parseYarnBerryLockfile = (raw: Record<string, unknown>) =>
 Effect.gen(function* () {
  // Phase 1: Extract and validate metadata
  const metadataRaw = raw["__metadata"]
  const metadata = yield* Schema.decodeUnknown(YarnBerryMetadata)(
   metadataRaw,
  )

  // Phase 2: Validate each package entry, splitting comma-separated keys
  const packageEntries: Record<string, YarnBerryPackageEntry> = {}
  for (const [key, value] of Object.entries(raw)) {
   if (key === "__metadata") continue
   const entry = yield* Schema.decodeUnknown(YarnBerryPackageEntry)(
    value,
   )
   // Split comma-separated descriptors into individual entries
   const descriptors = key.split(", ")
   for (const descriptor of descriptors) {
    packageEntries[descriptor] = entry
   }
  }

  return { metadata, packages: packageEntries }
 })
```

## bun.lock Schema

### Real-world structure

Based on the `bun-lockfile.md` reference document and the official
`Bun.BunLockFile` TypeScript type.

```jsonc
{
  "lockfileVersion": 1,
  "configVersion": 0,
  "workspaces": {
    "": {
      "name": "my-monorepo",
      "devDependencies": {
        "prettier": "^3.2.5",
        "typescript": "5.5.4",
      },
    },
    "apps/docs": {
      "name": "docs",
      "version": "0.1.0",
      "dependencies": {
        "@repo/ui": "packages/ui",
        "next": "^15.1.0",
        "react": "^19.0.0",
      },
    },
    "packages/ui": {
      "name": "@repo/ui",
      "version": "0.0.0",
      "dependencies": {
        "react": "^19.0.0",
      },
    },
  },
  "packages": {
    "react": ["react@19.0.0", "", {}, "sha512-..."],
    "@repo/ui": [
      "@repo/ui@workspace:packages/ui",
      { "dependencies": { "react": "^19.0.0" } },
    ],
    "uWebSockets.js": [
      "uWebSockets.js@github:uNetworking/uWebSockets.js#6609a88",
      {},
      "uNetworking-uWebSockets.js-6609a88",
    ],
  },
  "overrides": {
    "lodash": "^4.17.23",
  },
}
```

### Schema definitions

```typescript
import { Schema } from "effect"

/**
 * A workspace entry in the `workspaces` map.
 * Keys are relative paths from repo root ("" for root workspace).
 * Values mirror the dependency fields from that workspace's package.json.
 */
const BunWorkspaceEntry = Schema.Struct({
 name: Schema.optional(Schema.String),
 version: Schema.optional(Schema.String),
 dependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 devDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 peerDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 optionalDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
})
type BunWorkspaceEntry = Schema.Schema.Type<typeof BunWorkspaceEntry>

/**
 * INFO object shared across package tuple types.
 * Contains resolved dependency maps and platform constraints.
 */
const BunPackageInfo = Schema.Struct({
 dependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 devDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 optionalDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 peerDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 optionalPeers: Schema.optional(Schema.Array(Schema.String)),
 os: Schema.optional(Schema.String),
 cpu: Schema.optional(Schema.String),
 bin: Schema.optional(
  Schema.Union(
   Schema.String,
   Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
 ),
 binDir: Schema.optional(Schema.String),
})
type BunPackageInfo = Schema.Schema.Type<typeof BunPackageInfo>

/**
 * Package tuple variants in bun.lock.
 *
 * Bun uses variable-length arrays (tuples) to encode package entries:
 *
 * | Type       | Tuple shape                          | Length |
 * | ---------- | ------------------------------------ | ------ |
 * | npm        | [identifier, registry, INFO, hash]   | 4      |
 * | workspace  | [identifier, INFO]                   | 2      |
 * | git/github | [identifier, INFO, bun-tag]          | 3      |
 *
 * The identifier (position 0) always follows `name@resolution` format.
 * - npm: `"react@19.0.0"`
 * - workspace: `"@repo/ui@workspace:packages/ui"`
 * - git: `"pkg@github:user/repo#hash"`
 *
 * We use Schema.Union of Schema.Tuple variants discriminated by length.
 */

/** npm package: [identifier, registry, info, integrity] */
const BunNpmPackageTuple = Schema.Tuple(
 Schema.String,
 Schema.String,
 Schema.Union(BunPackageInfo, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
 Schema.String,
)

/** workspace or symlink package: [identifier, info] */
const BunWorkspacePackageTuple = Schema.Tuple(
 Schema.String,
 Schema.Union(BunPackageInfo, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
)

/** git/github package: [identifier, info, bun-tag] */
const BunGitPackageTuple = Schema.Tuple(
 Schema.String,
 Schema.Union(BunPackageInfo, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
 Schema.String,
)

/**
 * Discriminated union of all bun package tuple types.
 *
 * Implementation note: Since Schema.Union tries each variant in order,
 * place the 4-element tuple first (npm) to avoid the 2-element tuple
 * (workspace) greedily matching the first two elements of a longer tuple.
 * In practice, arrays are decoded by exact length match, so ordering
 * matters primarily for clarity.
 *
 * An alternative approach is to decode as Schema.Array(Schema.Unknown)
 * and then discriminate by length in a transform:
 *
 * ```typescript
 * const BunPackageTuple = Schema.transform(
 *   Schema.Array(Schema.Unknown),
 *   BunPackageTupleDecoded,
 *   {
 *     decode: (arr) => {
 *       switch (arr.length) {
 *         case 4: return { _tag: "npm", ...decode4(arr) }
 *         case 3: return { _tag: "git", ...decode3(arr) }
 *         case 2: return { _tag: "workspace", ...decode2(arr) }
 *         default: throw new Error(`Unknown tuple length: ${arr.length}`)
 *       }
 *     },
 *     encode: (decoded) => { /* reverse */ }
 *   },
 * )
 * ```
 */
const BunPackageTuple = Schema.Union(
 BunNpmPackageTuple,
 BunGitPackageTuple,
 BunWorkspacePackageTuple,
)
type BunPackageTuple = Schema.Schema.Type<typeof BunPackageTuple>

/**
 * Top-level bun.lock schema.
 *
 * Key differences from other lockfile formats:
 * - JSONC format (JSON with trailing commas, comments)
 * - `workspaces` map is separate from `packages` (unlike pnpm/npm)
 * - `packages` uses compact tuple encoding (not objects)
 * - Supports catalogs (like pnpm) for centralized version management
 */
const BunLockfileRaw = Schema.Struct({
 /** Structural format version (0 or 1). */
 lockfileVersion: Schema.Number,
 /** Linker strategy: 0 = hoisted, 1 = isolated for workspaces. */
 configVersion: Schema.optional(Schema.Union(Schema.Literal(0), Schema.Literal(1))),
 /** Workspace packages keyed by relative path. */
 workspaces: Schema.Record({
  key: Schema.String,
  value: BunWorkspaceEntry,
 }),
 /** Resolved packages keyed by package name. */
 packages: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: BunPackageTuple,
  }),
 ),
 /** Default catalog for centralized version management. */
 catalog: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
 ),
 /** Named catalogs for centralized version management. */
 catalogs: Schema.optional(
  Schema.Record({
   key: Schema.String,
   value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
 ),
 /** Dependency version overrides. */
 overrides: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Patch file locations. */
 patchedDependencies: Schema.optional(
  Schema.Record({ key: Schema.String, value: Schema.String }),
 ),
 /** Packages allowed to run lifecycle scripts. */
 trustedDependencies: Schema.optional(Schema.Array(Schema.String)),
})
type BunLockfileRaw = Schema.Schema.Type<typeof BunLockfileRaw>
```

### Key parsing notes

- bun.lock is **JSONC** (JSON with trailing commas and comments). Requires
  a JSONC parser or preprocessing before `JSON.parse`.
- The root workspace uses `""` (empty string) as its key in the `workspaces`
  map, matching npm's convention.
- Inter-workspace dependencies are encoded as path values in the dependency
  maps (e.g., `"@repo/ui": "packages/ui"` where `packages/ui` matches a
  workspace key).
- Package tuples are discriminated by length. The transform-based approach
  (decoding as `Schema.Array(Schema.Unknown)` then switching on length) is
  more robust than the tuple union approach for real-world data.
- Workspace packages in the `packages` map use `workspace:` protocol in
  their identifier: `"@repo/ui@workspace:packages/ui"`.

## Unified Transformation Model

All four raw schemas transform to a shared `LockfileData` model that
provides a PM-agnostic view of the resolved dependency state.

### Unified schemas

These schemas are defined in `architecture.md` and `phase4-configuration-lockfiles.md`.
Reproduced here for completeness:

```typescript
import { Schema } from "effect"

/**
 * Brand for package manager type.
 * Reuses the existing PackageManager schema from the codebase.
 */
const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun")

/**
 * A resolved package in the unified model.
 * Normalized from PM-specific formats into a common shape.
 */
class ResolvedPackage extends Schema.Class<ResolvedPackage>(
 "ResolvedPackage",
)({
 /** Package name (e.g., "react", "@scope/ui"). */
 name: Schema.NonEmptyString,
 /** Resolved version (e.g., "19.0.0"). */
 version: Schema.String,
 /** SRI integrity hash (e.g., "sha512-..."). Not all formats provide this. */
 integrity: Schema.optional(Schema.String),
 /** Whether this is a workspace package (local, not from registry). */
 isWorkspace: Schema.Boolean,
 /** Direct dependencies: name -> version constraint. */
 dependencies: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: Schema.String }),
  { default: () => ({}) },
 ),
}) {}

/**
 * An inter-workspace dependency.
 * Represents one workspace package depending on another.
 */
class WorkspaceDependency extends Schema.Class<WorkspaceDependency>(
 "WorkspaceDependency",
)({
 /** Source workspace package name (the one that depends). */
 from: Schema.NonEmptyString,
 /** Target workspace package name (the one depended upon). */
 to: Schema.NonEmptyString,
 /** Dependency type. */
 depType: Schema.Literal(
  "dependencies",
  "devDependencies",
  "peerDependencies",
 ),
 /** Version constraint as declared in package.json. */
 constraint: Schema.String,
}) {}

/**
 * Unified lockfile data model.
 * PM-agnostic representation of the resolved dependency state.
 */
class LockfileData extends Schema.Class<LockfileData>(
 "LockfileData",
)({
 /** Package manager that produced this lockfile. */
 packageManager: PackageManager,
 /** Lockfile format version (normalized to string). */
 lockfileVersion: Schema.String,
 /** All resolved packages (both workspace and external). */
 packages: Schema.Array(ResolvedPackage),
 /** Workspace inter-dependencies extracted from the lockfile. */
 workspaceDependencies: Schema.Array(WorkspaceDependency),
}) {}
```

### Transformation: pnpm -> LockfileData

```typescript
const pnpmToLockfileData = (raw: PnpmLockfileRaw): LockfileData => {
 const packages: Array<ResolvedPackage> = []
 const workspaceDeps: Array<WorkspaceDependency> = []

 // 1. Extract workspace packages from importers
 //    Each importer key is a relative path (".", "packages/ui")
 //    We need the package.json name for each, which requires
 //    cross-referencing with WorkspaceDiscovery output.
 //    For lockfile-only parsing, use the importer key as identifier.

 // 2. Extract resolved packages from packages map
 for (const [key, entry] of Object.entries(raw.packages ?? {})) {
  // key format: "react@19.0.0" or "@scope/pkg@1.2.3"
  const atIndex = key.lastIndexOf("@")
  const name = key.slice(0, atIndex)
  const version = key.slice(atIndex + 1)

  packages.push(
   new ResolvedPackage({
    name,
    version,
    integrity: entry.resolution.integrity,
    isWorkspace: false,
    dependencies: entry.dependencies ?? {},
   }),
  )
 }

 // 3. Extract inter-workspace dependencies from importers
 //    Look for dependencies with "link:" prefix in version field
 for (const [importerPath, importer] of Object.entries(raw.importers)) {
  for (const depType of [
   "dependencies",
   "devDependencies",
   "peerDependencies",
  ] as const) {
   const deps = importer[depType]
   if (!deps) continue
   for (const [depName, { version }] of Object.entries(deps)) {
    if (version.startsWith("link:")) {
     workspaceDeps.push(
      new WorkspaceDependency({
       from: importerPath, // relative path, not package name
       to: depName,
       depType,
       constraint: version,
      }),
     )
    }
   }
  }
 }

 return new LockfileData({
  packageManager: "pnpm",
  lockfileVersion: raw.lockfileVersion,
  packages,
  workspaceDependencies: workspaceDeps,
 })
}
```

### Transformation: npm -> LockfileData

```typescript
const npmToLockfileData = (raw: NpmLockfileRaw): LockfileData => {
 const packages: Array<ResolvedPackage> = []
 const workspaceDeps: Array<WorkspaceDependency> = []

 // Build workspace path set for cross-referencing
 const workspacePaths = new Set<string>()
 const linkTargets = new Map<string, string>() // node_modules path -> source path

 for (const [key, entry] of Object.entries(raw.packages)) {
  if (key === "") continue // skip root

  // Identify workspace symlinks
  if (entry.link && entry.resolved) {
   linkTargets.set(key, entry.resolved)
   continue
  }

  // Identify workspace source entries (not under node_modules/)
  if (!key.startsWith("node_modules/")) {
   workspacePaths.add(key)
  }
 }

 // Extract packages
 for (const [key, entry] of Object.entries(raw.packages)) {
  if (key === "") continue
  if (entry.link) continue // skip symlinks, handled via source entry

  const isWorkspace = workspacePaths.has(key)
  const name = isWorkspace
   ? (entry.name ?? key.split("/").pop() ?? key)
   : key.replace(/^node_modules\//, "")

  packages.push(
   new ResolvedPackage({
    name,
    version: entry.version ?? "0.0.0",
    integrity: entry.integrity,
    isWorkspace,
    dependencies: entry.dependencies ?? {},
   }),
  )
 }

 // Extract inter-workspace dependencies
 // For each workspace package, check if its dependencies reference
 // another workspace package (via link entries in node_modules)
 for (const wsPath of workspacePaths) {
  const wsEntry = raw.packages[wsPath]
  if (!wsEntry) continue
  const wsName = wsEntry.name ?? wsPath

  for (const depType of [
   "dependencies",
   "devDependencies",
   "peerDependencies",
  ] as const) {
   const deps = wsEntry[depType]
   if (!deps) continue
   for (const [depName, constraint] of Object.entries(deps)) {
    // Check if this dependency resolves to a workspace link
    const nmPath = `node_modules/${depName}`
    if (linkTargets.has(nmPath)) {
     workspaceDeps.push(
      new WorkspaceDependency({
       from: wsName,
       to: depName,
       depType,
       constraint,
      }),
     )
    }
   }
  }
 }

 return new LockfileData({
  packageManager: "npm",
  lockfileVersion: String(raw.lockfileVersion),
  packages,
  workspaceDependencies: workspaceDeps,
 })
}
```

### Transformation: yarn Berry -> LockfileData

```typescript
const yarnBerryToLockfileData = (
 metadata: YarnBerryMetadata,
 packageEntries: Record<string, YarnBerryPackageEntry>,
): LockfileData => {
 const packages: Array<ResolvedPackage> = []
 const workspaceDeps: Array<WorkspaceDependency> = []

 // Build workspace set for cross-referencing
 const workspaceNames = new Set<string>()

 for (const [_key, entry] of Object.entries(packageEntries)) {
  const isWorkspace = entry.resolution.includes("@workspace:")
  if (isWorkspace) {
   // Extract name from resolution: "@repo/ui@workspace:packages/ui"
   const name = entry.resolution.split("@workspace:")[0]
   workspaceNames.add(name)
  }
 }

 for (const [_key, entry] of Object.entries(packageEntries)) {
  const isWorkspace = entry.resolution.includes("@workspace:")

  // Extract package name from resolution
  // npm: "react@npm:19.0.0" -> "react"
  // workspace: "@repo/ui@workspace:packages/ui" -> "@repo/ui"
  let name: string
  if (isWorkspace) {
   name = entry.resolution.split("@workspace:")[0]
  } else {
   // Handle scoped packages: "@scope/pkg@npm:1.0.0"
   const parts = entry.resolution.split("@npm:")
   name = parts[0]
  }

  packages.push(
   new ResolvedPackage({
    name,
    version: entry.version,
    integrity: undefined, // yarn uses checksum, not SRI
    isWorkspace,
    dependencies: stripProtocols(entry.dependencies ?? {}),
   }),
  )

  // Extract inter-workspace dependencies
  if (isWorkspace) {
   for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
   ] as const) {
    const deps = entry[depType]
    if (!deps) continue
    for (const [depName, constraint] of Object.entries(deps)) {
     if (
      constraint.startsWith("workspace:") ||
      workspaceNames.has(depName)
     ) {
      workspaceDeps.push(
       new WorkspaceDependency({
        from: name,
        to: depName,
        depType,
        constraint,
       }),
      )
     }
    }
   }
  }
 }

 return new LockfileData({
  packageManager: "yarn",
  lockfileVersion: String(metadata.version),
  packages,
  workspaceDependencies: workspaceDeps,
 })
}

/**
 * Strip protocol prefixes from yarn Berry dependency values.
 * "npm:^19.0.0" -> "^19.0.0"
 * "workspace:*" -> "*"
 */
const stripProtocols = (
 deps: Record<string, string>,
): Record<string, string> => {
 const result: Record<string, string> = {}
 for (const [key, value] of Object.entries(deps)) {
  const colonIndex = value.indexOf(":")
  result[key] = colonIndex >= 0 ? value.slice(colonIndex + 1) : value
 }
 return result
}
```

### Transformation: bun -> LockfileData

```typescript
const bunToLockfileData = (raw: BunLockfileRaw): LockfileData => {
 const packages: Array<ResolvedPackage> = []
 const workspaceDeps: Array<WorkspaceDependency> = []

 // Build workspace path-to-name mapping
 const wsPathToName = new Map<string, string>()
 for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
  if (wsEntry.name) {
   wsPathToName.set(wsPath, wsEntry.name)
  }
 }

 // Extract packages from the packages map (tuple format)
 for (const [key, tuple] of Object.entries(raw.packages ?? {})) {
  const identifier = tuple[0] // always position 0

  const isWorkspace = identifier.includes("@workspace:")
  let name: string
  let version: string

  if (isWorkspace) {
   // "@repo/ui@workspace:packages/ui"
   name = identifier.split("@workspace:")[0]
   version =
    raw.workspaces[identifier.split("@workspace:")[1]]?.version ??
    "0.0.0"
  } else {
   // "react@19.0.0" or "@scope/pkg@1.2.3"
   const atIndex = identifier.lastIndexOf("@")
   name = identifier.slice(0, atIndex)
   version = identifier.slice(atIndex + 1)
  }

  // Integrity is position 3 for npm tuples (length 4)
  const integrity = tuple.length === 4 ? (tuple[3] as string) : undefined

  // INFO is position 2 for npm (after registry), position 1 otherwise
  const info =
   tuple.length === 4 ? tuple[2] : tuple.length >= 2 ? tuple[1] : {}
  const deps =
   typeof info === "object" && info !== null
    ? ((info as Record<string, unknown>).dependencies as
      | Record<string, string>
      | undefined) ?? {}
    : {}

  packages.push(
   new ResolvedPackage({
    name,
    version,
    integrity,
    isWorkspace,
    dependencies: deps,
   }),
  )
 }

 // Extract inter-workspace dependencies from the workspaces map
 for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
  const wsName = wsEntry.name ?? wsPath

  for (const depType of [
   "dependencies",
   "devDependencies",
   "peerDependencies",
  ] as const) {
   const deps = wsEntry[depType]
   if (!deps) continue
   for (const [depName, constraint] of Object.entries(deps)) {
    // Inter-workspace dep if the constraint matches a workspace path
    // or uses workspace: protocol
    if (
     wsPathToName.has(constraint) ||
     constraint.startsWith("workspace:")
    ) {
     workspaceDeps.push(
      new WorkspaceDependency({
       from: wsName,
       to: depName,
       depType,
       constraint,
      }),
     )
    }
   }
  }
 }

 return new LockfileData({
  packageManager: "bun",
  lockfileVersion: String(raw.lockfileVersion),
  packages,
  workspaceDependencies: workspaceDeps,
 })
}
```

### Transformation summary

| PM | Workspace packages | Inter-workspace deps | Resolved versions | Integrity |
| -- | ------------------ | -------------------- | ----------------- | --------- |
| pnpm | `importers` keys are relative paths; cross-ref with WorkspaceDiscovery for names | `link:` prefix in importer dependency versions | `packages` map keys: `name@version` | `resolution.integrity` |
| npm | Entries NOT under `node_modules/` and NOT root `""` | `link: true` entries in `node_modules/` | `version` field on each entry | `integrity` field |
| yarn | Entries with `@workspace:` in resolution | `workspace:` protocol in dependency values | `version` field on each entry | `checksum` (not SRI) |
| bun | Entries with `@workspace:` in identifier | Path values in `workspaces` dependency maps matching workspace keys | Extracted from identifier `name@version` | Position 3 of npm tuples |

## Parsing Pipeline

The parsing pipeline follows a consistent Effect pattern across all four
formats:

```text
Read file -> Parse format (YAML/JSON/JSONC) -> Validate raw schema -> Transform to unified model
```

### Format-specific file reader

```typescript
import { Effect, Schema } from "effect"

/**
 * Lockfile format discriminant.
 * Determined by PackageManagerDetector output.
 */
type LockfileFormat = "pnpm-yaml" | "npm-json" | "yarn-yaml" | "bun-jsonc"

/**
 * Step 1: Read the lockfile content from disk.
 */
const readLockfileContent = (
 path: string,
) =>
 Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(path).pipe(
   Effect.mapError(
    () =>
     new LockfileReadError({
      lockfilePath: path,
      reason: "File not found or not readable",
     }),
   ),
  )
 })

/**
 * Step 2: Parse raw content to a JS object.
 * Each format uses a different parser.
 */
const parseRawContent = (
 content: string,
 format: LockfileFormat,
 path: string,
) =>
 Effect.try({
  try: () => {
   switch (format) {
    case "pnpm-yaml":
    case "yarn-yaml":
     // Uses 'yaml' package
     return yamlParse(content)
    case "npm-json":
     return JSON.parse(content) as unknown
    case "bun-jsonc":
     // Uses 'jsonc-parser' package
     return jsoncParse(content)
   }
  },
  catch: (cause) =>
   new LockfileParseError({
    lockfilePath: path,
    format,
    cause,
   }),
 })

/**
 * Step 3: Validate against PM-specific raw schema.
 */
const validateRawSchema = <A, I>(
 raw: unknown,
 schema: Schema.Schema<A, I>,
 path: string,
 format: string,
) =>
 Schema.decodeUnknown(schema)(raw).pipe(
  Effect.mapError(
   (cause) =>
    new LockfileParseError({
     lockfilePath: path,
     format,
     cause,
    }),
  ),
 )
```

### Full pipeline composition

```typescript
/**
 * Complete lockfile parsing pipeline.
 *
 * Read -> Parse -> Validate -> Transform
 *
 * Returns a unified LockfileData regardless of the source PM format.
 */
const parseLockfile = (
 path: string,
 format: LockfileFormat,
): Effect.Effect<
 LockfileData,
 LockfileReadError | LockfileParseError,
 FileSystem.FileSystem
> =>
 Effect.gen(function* () {
  // Step 1: Read file content
  const content = yield* readLockfileContent(path)

  // Step 2: Parse format-specific content to JS object
  const raw = yield* parseRawContent(content, format, path)

  // Step 3 & 4: Validate schema and transform to unified model
  switch (format) {
   case "pnpm-yaml": {
    const validated = yield* validateRawSchema(
     raw,
     PnpmLockfileRaw,
     path,
     "pnpm",
    )
    return pnpmToLockfileData(validated)
   }
   case "npm-json": {
    const validated = yield* validateRawSchema(
     raw,
     NpmLockfileRaw,
     path,
     "npm",
    )
    return npmToLockfileData(validated)
   }
   case "yarn-yaml": {
    // Two-phase: extract metadata, then validate entries
    const parsed = yield* parseYarnBerryLockfile(
     raw as Record<string, unknown>,
    )
    return yarnBerryToLockfileData(
     parsed.metadata,
     parsed.packages,
    )
   }
   case "bun-jsonc": {
    const validated = yield* validateRawSchema(
     raw,
     BunLockfileRaw,
     path,
     "bun",
    )
    return bunToLockfileData(validated)
   }
  }
 }).pipe(Effect.withSpan("LockfileReader.parseLockfile", { attributes: { path, format } }))
```

### Format detection from PackageManagerDetector

```typescript
/**
 * Map from detected package manager to lockfile location and format.
 */
const lockfileConfig: Record<
 string,
 { filename: string; format: LockfileFormat }
> = {
 pnpm: { filename: "pnpm-lock.yaml", format: "pnpm-yaml" },
 npm: { filename: "package-lock.json", format: "npm-json" },
 yarn: { filename: "yarn.lock", format: "yarn-yaml" },
 bun: { filename: "bun.lock", format: "bun-jsonc" },
}
```

### Error handling integration

The pipeline integrates with the existing error hierarchy from
`architecture.md`:

```typescript
class LockfileReadError extends Data.TaggedError("LockfileReadError")<{
 readonly lockfilePath: string
 readonly reason: string
}> {
 get message(): string {
  return `Failed to read lockfile at ${this.lockfilePath}: ${this.reason}`
 }
}

class LockfileParseError extends Data.TaggedError("LockfileParseError")<{
 readonly lockfilePath: string
 readonly format: string
 readonly cause: unknown
}> {
 get message(): string {
  return `Failed to parse ${this.format} lockfile at ${this.lockfilePath}`
 }
}
```

Consumers can handle errors precisely using `catchTag`:

```typescript
program.pipe(
 Effect.catchTag("LockfileReadError", (e) =>
  // Lockfile doesn't exist -- maybe not installed yet
  Effect.succeed(emptyLockfileData),
 ),
 Effect.catchTag("LockfileParseError", (e) =>
  // Lockfile is corrupt or unsupported version
  Effect.fail(new WrappedError({ cause: e })),
 ),
)
```

## Rationale

### Why raw schemas + transformation instead of direct parsing?

Separating raw schema validation from unified model transformation provides:

1. **Schema validation catches malformed lockfiles early** with clear error
   messages via Effect Schema's parse error reporting.
2. **Raw schemas document the actual on-disk format** as executable
   specifications, not just comments.
3. **Transformation logic is isolated** and testable independently from
   parsing.
4. **Adding a new lockfile format** only requires a new raw schema and
   transformation function, not changes to the unified model.

### Why Schema.Class for unified model?

`Schema.Class` provides both a runtime validator and a TypeScript type from
a single definition. It follows the established pattern in the codebase
(`WorkspacePackage`, `WorkspaceInfo`) and enables:

- `Schema.decodeUnknown` for validation
- `instanceof` checks at runtime
- `new ResolvedPackage({...})` construction with validation
- Integration with Effect's tracing (class name in spans)

### Why Schema.Struct for raw schemas?

Raw schemas use `Schema.Struct` (not `Schema.Class`) because:

- They are intermediate representations, not domain objects
- No need for `instanceof` or branded types
- Simpler to compose and extend
- Matches the "parse, don't validate" pattern where raw data flows through
  schema validation into typed domain objects

### Why variable-length tuple handling for bun?

Bun's `packages` map uses a compact tuple encoding that requires
length-based discrimination. The recommended approach is:

1. Decode as `Schema.Array(Schema.Unknown)` first
2. Switch on array length to determine package type
3. Decode each variant with its specific schema

This is more robust than `Schema.Union` of `Schema.Tuple` variants because
it avoids ambiguity in union discrimination and produces better error
messages when a tuple has an unexpected length.
