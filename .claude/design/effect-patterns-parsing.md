---
title: "Effect Patterns: Schema & Parsing"
module: core
category: patterns
status: current
completeness: 95
created: 2026-03-12
updated: 2026-03-14
last-synced: 2026-04-15
authors:
  - C. Spencer Beggs
tags:
  - effect
  - patterns
  - schema
  - parsing
  - lockfiles
related:
  - architecture.md
  - effect-patterns-core.md
  - effect-patterns-testing.md
  - lockfile-schemas.md
  - phase4-configuration-lockfiles.md
---

## Effect Patterns: Schema & Parsing

Patterns for Schema definition, parsing pipelines, and error formatting in
workspaces-effect. Covers YAML, JSONC, and JSON parsing through the Effect
Schema pipeline. Split from the original effect-best-practices.md for
focused context loading.

## Schema Patterns

### Schema.Literal for enums

```typescript
const PackageManager = Schema.Literal("npm", "pnpm", "yarn", "bun");
type PackageManagerType = Schema.Schema.Type<typeof PackageManager>;
```

### Branded types for semantic strings

```typescript
const PackageName = Schema.NonEmptyString.pipe(Schema.brand("PackageName"));
```

### Schema.Class for domain objects

```typescript
class WorkspacePackage extends Schema.Class<WorkspacePackage>("WorkspacePackage")({
  name: Schema.NonEmptyString,
  version: Schema.String,
  private: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
```

### Schema.optionalWith for defaults

Prefer `Schema.optionalWith` with `default` over just `Schema.optional`
when you want a guaranteed value at runtime:

```typescript
Schema.optionalWith(Schema.Boolean, { default: () => false })
```

### Union for polymorphic fields

```typescript
const WorkspaceField = Schema.Union(
  Schema.Array(Schema.String),
  Schema.Struct({ packages: Schema.Array(Schema.String) })
);
```

## Schema Parsing Pipelines

Patterns for parsing external file formats (YAML, JSONC, JSON) through the
Effect Schema pipeline. These compose format parsing with schema validation
to produce typed, validated data structures from raw file content.

See [lockfile-schemas.md](lockfile-schemas.md) for full schema definitions
used in lockfile parsing.

### Schema.transformOrFail for format parsing

Use `Schema.transformOrFail` to wrap a format parser (YAML, JSONC) as a
Schema stage. This turns a string-to-unknown parsing step into a composable
Schema that participates in the full decode/encode pipeline:

```typescript
import { ParseResult, Schema } from "effect"
import YAML from "yaml"

const YamlToUnknown = Schema.transformOrFail(
 Schema.String,
 Schema.Unknown,
 {
  decode: (input, _options, ast) => {
   try {
    return ParseResult.succeed(YAML.parse(input) as unknown)
   } catch (err) {
    return ParseResult.fail(
     new ParseResult.Type(
      ast,
      input,
      `YAML parse error: ${String(err)}`,
     ),
    )
   }
  },
  encode: (value) => ParseResult.succeed(YAML.stringify(value)),
 },
)
```

The `ast` parameter from the decode callback provides the schema node for
error reporting. Wrapping the parser error in `ParseResult.Type` produces
structured errors that integrate with Effect's error formatters.

### Schema.compose for multi-stage parsing

Compose format parsing with schema validation using `Schema.compose`. This
chains two Schema stages: the first parses the format (string to unknown),
the second validates structure (unknown to typed):

```typescript
import { Schema } from "effect"

// Stage 1: YAML string -> unknown
// Stage 2: unknown -> typed PnpmWorkspaceYaml
const PnpmWorkspaceYamlFromString = Schema.compose(
 YamlToUnknown,
 PnpmWorkspaceYamlSchema,
)

// Decode in one step: string -> typed struct
const result = Schema.decodeUnknownSync(PnpmWorkspaceYamlFromString)(
 yamlContent,
)
```

This separates concerns cleanly. The format parser knows nothing about the
target schema, and the target schema knows nothing about YAML. Each stage
can be tested and reused independently.

### Schema.parseJson for JSON lockfiles

For JSON files like `package-lock.json`, `Schema.parseJson` collapses
`JSON.parse` and `Schema.decodeUnknown` into a single Schema step:

```typescript
import { Schema } from "effect"

const PackageLockFromString = Schema.parseJson(PackageLockSchema)

// Decode: JSON string -> typed PackageLock
const lockfile = Schema.decodeUnknownSync(PackageLockFromString)(
 jsonContent,
)
```

This is simpler than building a custom `transformOrFail` for JSON since
Effect already handles `JSON.parse` errors and produces proper
`ParseResult` failures.

### Error formatting for debugging

Effect provides two error formatters for Schema decode failures:

```typescript
import { ParseResult, Schema } from "effect"

// Human-readable hierarchical format (good for logs and debugging)
try {
 Schema.decodeUnknownSync(MySchema)(input)
} catch (error) {
 const formatted = ParseResult.TreeFormatter.formatErrorSync(
  error as ParseResult.ParseError,
 )
 console.error(formatted)
 // Output:
 // MySchema
 // └─ ["packages"]
 //    └─ is missing
}

// Machine-readable array format (good for programmatic handling)
try {
 Schema.decodeUnknownSync(MySchema)(input)
} catch (error) {
 const issues = ParseResult.ArrayFormatter.formatErrorSync(
  error as ParseResult.ParseError,
 )
 // issues: { _tag: "Pointer", path: ["packages"], message: "is missing" }[]
}
```

To collect all errors instead of stopping at the first failure, pass the
`{ errors: "all" }` option:

```typescript
Schema.decodeUnknownEither(MySchema)(input, { errors: "all" })
```

### Best practice for lockfile parsing

The recommended pipeline for parsing lockfiles and workspace config files:

1. **Read file** -- `FileSystem.readFileString` wrapped in `Effect.mapError`
   to produce a typed read error
2. **Parse format** -- `Schema.transformOrFail` for YAML/JSONC, or
   `Schema.parseJson` for JSON
3. **Validate against raw schema** -- `Schema.Struct` matching the file's
   native shape
4. **Transform to unified model** -- `Schema.transform` or post-decode
   mapping to a shared internal type

Each step produces structured errors that compose through the pipeline:

```typescript
const parsePnpmLockfile = (content: string) =>
 Effect.gen(function* () {
  // Steps 2+3 composed: YAML string -> validated struct
  const raw = yield* Schema.decode(PnpmLockfileFromString)(content)

  // Step 4: transform to unified model
  return toLockfileModel(raw)
 }).pipe(
  Effect.mapError(
   (error) =>
    new LockfileParseError({
     manager: "pnpm",
     reason: ParseResult.TreeFormatter.formatErrorSync(error),
    }),
  ),
 )
```

This keeps each concern isolated: format parsing, schema validation, and
domain transformation are separate, testable stages. The error at each
stage carries enough context (format error vs. schema mismatch vs.
transformation failure) for actionable debugging.
