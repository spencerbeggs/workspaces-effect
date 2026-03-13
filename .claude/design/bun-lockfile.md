---
title: "Bun Lockfile Format Reference"
module: core
category: reference
status: complete
completeness: 90
created: 2026-03-12
updated: 2026-03-12
last-synced: 2026-03-12
related:
  - architecture.md
  - phase4-configuration-lockfiles.md
  - lockfile-schemas.md
authors:
  - C. Spencer Beggs
tags:
  - bun
  - lockfile
  - reference
---

## Bun Lockfile Format Reference

<!-- TOC -->

- [Overview](#overview)
- [Current State](#current-state)
- [Top-Level Schema](#top-level-schema)
- [Workspaces Map](#workspaces-map)
- [Packages Map Tuple Format](#packages-map-tuple-format)
- [Workspace Inter-Dependencies](#workspace-inter-dependencies)
- [Comparison with Other Lockfiles](#comparison-with-other-lockfiles)
- [Implementation Strategy](#implementation-strategy)
- [Rationale](#rationale)

<!-- /TOC -->

## Overview

Starting with Bun v1.2, Bun uses a text-based `bun.lock` file in JSONC
format (JSON with trailing commas and comments). It replaced the binary
`bun.lockb` format. This document captures the schema and parsing
strategy for `workspaces-effect`.

## Current State

Research completed 2026-03-12. Sources: Bun official docs, Bun blog,
`Bun.BunLockFile` TypeScript type reference, Turborepo bun.lock support
PR, and bun.lock.zig source.

## Top-Level Schema

From the official `Bun.BunLockFile` TypeScript type:

```typescript
interface BunLockFile {
  lockfileVersion: number;
  configVersion?: 0 | 1;
  workspaces: Record<string, WorkspaceEntry>;
  packages: Record<string, PackageTuple>;
  catalog?: Record<string, unknown>;
  catalogs?: Record<string, Record<string, unknown>>;
  overrides?: Record<string, string>;
  patchedDependencies?: Record<string, string>;
  trustedDependencies?: string[];
}
```

| Field | Description |
| ----- | ----------- |
| `lockfileVersion` | Structural format version (0 or 1) |
| `configVersion` | Linker strategy: 0 = hoisted, 1 = isolated for workspaces |
| `workspaces` | Map of workspace relative paths to dependency declarations |
| `packages` | Map of package identifiers to resolution tuples |
| `catalog`/`catalogs` | Centralized version catalog entries (like pnpm catalogs) |
| `overrides` | Dependency version overrides |
| `patchedDependencies` | Patch file locations |
| `trustedDependencies` | Packages allowed to run lifecycle scripts |

## Workspaces Map

Keys are relative paths from repo root. Root workspace uses `""` (empty
string). Each entry mirrors the dependency fields from that workspace's
package.json:

```jsonc
{
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
        "@repo/ui": "packages/ui",      // workspace inter-dep (path)
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
}
```

## Packages Map Tuple Format

Package entries are arrays whose length distinguishes the type:

| Type | Tuple | Length |
| ---- | ----- | ------ |
| npm | `[id, registry, INFO, integrity]` | 4 |
| workspace | `[id, INFO]` | 2 |
| git/github | `[id, INFO, .bun-tag]` | 3 |
| symlink/folder/tarball | `[id, INFO]` | 2 |
| root | `[id, {bin, binDir}]` | 2 |

**Identifier** (position 0): Always `"name@resolution"`. For npm:
`"react@19.0.0"`. For workspaces: `"@repo/ui@workspace:packages/ui"`.

**Registry** (position 1, npm only): Empty string for default npm registry.

**INFO object**: Contains resolved dependencies and platform constraints:

```jsonc
{
  "dependencies": { "pkg": "^1.0.0" },
  "devDependencies": { "pkg": "^2.0.0" },
  "optionalDependencies": { "pkg": "^3.0.0" },
  "peerDependencies": { "pkg": "^4.0.0" },
  "optionalPeers": ["pkg"],
  "os": "darwin",
  "cpu": "arm64",
  "bin": { "name": "path" },
  "binDir": "bin-directory",
}
```

**Integrity** (position 3, npm only): SRI hash like `"sha512-..."`.

### Examples

```jsonc
{
  "packages": {
    // NPM: 4-element tuple
    "react": ["react@19.0.0", "", {}, "sha512-..."],

    // Workspace: 2-element tuple, workspace: protocol
    "@repo/ui": [
      "@repo/ui@workspace:packages/ui",
      { "dependencies": { "react": "^19.0.0" } },
    ],

    // GitHub: 3-element tuple
    "uWebSocket.js": [
      "uWebSockets.js@github:uNetworking/uWebSockets.js#6609a88",
      {},
      "uNetworking-uWebSockets.js-6609a88",
    ],
  },
}
```

## Workspace Inter-Dependencies

Two places encode workspace relationships:

1. **Workspaces map**: A dependency whose version is a relative path
   (e.g., `"@repo/ui": "packages/ui"`) points to another workspace.

2. **Packages map**: Workspace packages use `workspace:` protocol in
   their identifier (e.g., `"@repo/ui@workspace:packages/ui"`).

To detect inter-workspace deps:

- In `workspaces[path].dependencies`, check if the version matches
  another workspace path key
- In `packages`, filter for entries with `@workspace:` in the identifier

## Comparison with Other Lockfiles

| Aspect | bun.lock | package-lock.json | pnpm-lock.yaml |
| ------ | -------- | ----------------- | -------------- |
| Format | JSONC | JSON (strict) | YAML |
| Entries | Compact tuples | Nested objects | Nested objects |
| Workspace encoding | `workspaces` map by path | `"link": true` entries | `importers` map by path |
| Inter-workspace deps | Path as version value | `file:` links | `link:` prefix |
| Integrity | 4th tuple element | `integrity` field | `integrity` field |
| Unique features | `trustedDependencies`, catalogs, `configVersion` | lockfileVersion 3 | `settings`, lockfileVersion 9.0 |

## Implementation Strategy

### Parsing

1. **Parse as JSONC** — standard JSON parsers will fail on trailing
   commas. Use a JSONC parser or strip comments/commas before parsing.
2. **Read `workspaces` map** for workspace discovery and relative paths.
3. **Identify inter-workspace deps** by checking if version values match
   workspace path keys.
4. **Use tuple length** to distinguish package types in `packages` map.

### Binary bun.lockb (Pre-1.2)

**Recommendation: support only `bun.lock` (text JSONC).**

The binary `bun.lockb` uses a custom Structure of Arrays format that is
undocumented and complex to reimplement. Since Bun 1.2 defaults to text
lockfiles and can migrate with `bun install`, requiring the text format
is pragmatic. If a project has only `bun.lockb`, we can suggest running
`bun install` to generate `bun.lock`.

### Schema for workspaces-effect

```typescript
const BunLockfileSchema = Schema.Struct({
  lockfileVersion: Schema.Number,
  configVersion: Schema.optional(Schema.Literal(0, 1)),
  workspaces: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      name: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
      dependencies: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.String })
      ),
      devDependencies: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.String })
      ),
    }),
  }),
  // packages map is complex (variable-length tuples) —
  // may need custom decoder rather than Schema.Struct
})
```

## Rationale

### Why JSONC-only

- `bun.lock` is the default since Bun 1.2 (released late 2024)
- Binary `bun.lockb` is undocumented and requires reimplementing Bun's
  serialization format
- Users can migrate by running `bun install`
- All new Bun projects generate `bun.lock` by default

### Why the workspaces map is sufficient for discovery

For `workspaces-effect`, the `workspaces` map provides everything needed
for workspace discovery: package names, versions, relative paths, and
inter-workspace dependency relationships. The `packages` map is only
needed for full dependency resolution (Phase 4+).
