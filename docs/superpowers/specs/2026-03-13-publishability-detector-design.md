# PublishabilityDetector Design Spec

## Goal

Add a composable `PublishabilityDetector` service that determines which
workspace packages are publishable and where they publish to, with a
pluggable layer design so consumers can override the detection strategy.

## Motivation

Monorepo tooling needs to know which packages are publishable, to which
registries, and from which directories. The base case is simple (check
`private` and `publishConfig` in `package.json`), but real-world setups
vary: multi-registry publishing, JSR targets, changeset-driven detection,
custom access rules. A pluggable service lets this module provide sensible
defaults while allowing consumers (e.g., `workflow-release-action`) to
swap in their own logic.

## Approach

Enrich existing schemas to carry `publishConfig` data through the
pipeline, then add a thin service that interprets it. The default layer
is pure (no FileSystem dependency) — it only reads data already on
`WorkspacePackage`. Custom layers can depend on whatever they need.

## Schema Changes

### PublishConfigSchema

Added to `src/schemas/core.ts`, used within `PackageJsonSchema`:

```typescript
const PublishConfigSchema = Schema.Struct({
  access: Schema.optional(Schema.Literal("public", "restricted")),
  registry: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
});
```

### PackageJsonSchema

New optional field:

```typescript
publishConfig: Schema.optional(PublishConfigSchema),
```

### PublishTarget

New `Schema.Class` in `src/schemas/publish.ts`:

```typescript
class PublishTarget extends Schema.Class<PublishTarget>(
  "PublishTarget",
)({
  name: Schema.NonEmptyString,
  registry: Schema.NonEmptyString,
  directory: Schema.String,
  access: Schema.Literal("public", "restricted"),
  provenance: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
}) {}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | NonEmptyString | Package name for this target (can differ from workspace name, e.g., scoped for GitHub Packages or JSR) |
| `registry` | NonEmptyString | Registry URL |
| `directory` | String | Publish-from directory relative to package root ("." for root) |
| `access` | "public" \| "restricted" | npm access level |
| `provenance` | Boolean (default false) | Whether to publish with provenance attestation |

### WorkspacePackage

Two new fields:

```typescript
publishable: Schema.optionalWith(Schema.Boolean, {
  default: () => false,
}),
publishTargets: Schema.optionalWith(
  Schema.Array(PublishTarget),
  { default: () => [] },
),
```

`publishable` is derived (true when `publishTargets.length > 0`) but
having it explicit makes filtering easy without importing PublishTarget.

## Service Interface

`src/services/PublishabilityDetector.ts`:

```typescript
class PublishabilityDetector extends Context.Tag(
  "PublishabilityDetector",
)<
  PublishabilityDetector,
  {
    readonly detect: (
      pkg: WorkspacePackage,
      root: string,
    ) => Effect.Effect<ReadonlyArray<PublishTarget>>
  }
>() {}
```

### Design decisions

- **Input**: `WorkspacePackage` (carries `publishConfig` from schema
  enrichment) plus `root` (workspace root path, needed by custom layers
  to resolve relative paths or read additional config files).
- **Output**: `ReadonlyArray<PublishTarget>`. Empty array means not
  publishable. No error channel — the base case always succeeds.
- **Single method**: `detect` only. Consumers use `Effect.forEach` to
  detect across multiple packages.
- **Custom layers** that read external files (e.g., `.changeset/config.json`)
  can depend on `FileSystem` and introduce their own error types. The
  error surfaces at layer composition time, not at the service interface
  level.

## Default Layer Logic

`src/layers/PublishabilityDetectorLive.ts`:

The default detection follows standard npm semantics:

1. If `pkg.private === true` AND no `publishConfig.access` set →
   not publishable (return empty array)
2. If `publishConfig.access` is set → publishable (access overrides
   the `private` field, because a build step is expected to resolve this)
3. If `pkg.private === false` (or undefined) and no `publishConfig` →
   publishable with defaults

When publishable, build a single target:

```typescript
new PublishTarget({
  name: pkg.name,
  registry:
    publishConfig?.registry ?? "https://registry.npmjs.org/",
  directory: publishConfig?.directory ?? ".",
  access: publishConfig?.access ?? "public",
  provenance: false,
})
```

The layer is pure — no dependencies. It interprets data already on
`WorkspacePackage`.

### Custom layer example

What a consumer like `workflow-release-action` would provide:

```typescript
const CustomPublishabilityDetectorLive = Layer.effect(
  PublishabilityDetector,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return {
      detect: (pkg, root) =>
        Effect.gen(function* () {
          const changesetConfig = yield* fs.readFileString(
            path.join(root, ".changeset", "config.json"),
          );
          // Multi-registry target resolution, JSR support, etc.
          return targets;
        }),
    };
  }),
);
```

## Observability

Following the existing pattern across all services:

### Span

`PublishabilityDetector.detect` with attribute `workspace.package`.

### Logging

Debug log: "Publishability resolved" with structured fields:

```typescript
yield* Effect.logDebug("Publishability resolved").pipe(
  Effect.annotateLogs({
    "workspace.package": pkg.name,
    "workspace.publishable": targets.length > 0,
    "workspace.targets.count": targets.length,
  }),
);
```

## Error Handling

No new error types. The default layer is pure data interpretation that
always succeeds. Custom layers can introduce their own error types which
surface at layer composition time through Effect's type system.

## Testing Strategy

Unit tests in `src/layers/PublishabilityDetectorLive.test.ts`. No
FileSystem needed — the default layer is pure.

Test cases:

| Scenario | private | publishConfig | Expected |
| --- | --- | --- | --- |
| Private, no publishConfig | true | undefined | [] |
| Private, publishConfig.access set | true | { access: "public" } | [target with access "public"] |
| Not private, no publishConfig | false | undefined | [target with defaults] |
| Not private, full publishConfig | false | { access: "restricted", registry: "...", directory: "dist" } | [target with all fields] |
| Undefined private, no publishConfig | undefined | undefined | [target with defaults] |
| PublishConfig with registry only | false | { registry: "<https://custom/>" } | [target with custom registry] |
| PublishConfig with directory only | false | { directory: "dist/npm" } | [target with custom directory] |

## WorkspaceDiscoveryLive Changes

`WorkspaceDiscoveryLive` already reads each package's `package.json` via
`PackageJsonSchema`. After the schema enrichment, `publishConfig` is
parsed automatically. The discovery layer passes it through when
constructing `WorkspacePackage` instances — no additional file reads.

## Files Modified

- Create: `src/schemas/publish.ts` — PublishTarget schema
- Create: `src/services/PublishabilityDetector.ts` — service interface
- Create: `src/layers/PublishabilityDetectorLive.ts` — default layer + observability
- Create: `src/layers/PublishabilityDetectorLive.test.ts` — tests
- Modify: `src/schemas/core.ts` — add PublishConfigSchema to PackageJsonSchema, add publishable/publishTargets to WorkspacePackage
- Modify: `src/layers/WorkspaceDiscoveryLive.ts` — pass through publishConfig when constructing WorkspacePackage
- Modify: `src/index.ts` — export new schemas, service, layer

## Dependencies

None. All types used (`Schema.Class`, `Context.Tag`, `Effect.withSpan`,
`Effect.logDebug`, `Effect.annotateLogs`) are part of the core `effect`
package already in dependencies.
