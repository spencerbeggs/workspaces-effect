---
"workspaces-effect": minor
---

## Documentation

Finalizes `@public` release tags across previously untagged or `@internal`-marked exports, resolving every TSDoc/API Extractor release-tag and unresolved-link diagnostic in the package.

* Tagged `@public`: the `Data.TaggedError` base constants across all error modules, the dual-API dependency-inspection utilities (`hasDependency`, `hasDevDependency`, `hasPeerDependency`, `hasOptionalDependency`, `hasAnyDependencyOn`, `dependencyVersion`, `matchesDependency`, `dependencyDiff`, `readPackageJson`), `ManifestLike`, `CatalogResolverError`, and `PublishConfigType`
* Fixed an unresolved `{@link levels}` reference in `TopologicalSorter`'s TSDoc

## Build System

Migrated `savvy.build.ts` to the `build()` API from `@savvy-web/bundler`, replacing the previous `defineBuild`/`runBuild` pattern.
