---
"workspaces-effect": minor
---

## Bug Fixes

- Fix pnpm v9+ lockfile parsing for catalogs with `{ specifier, version }` format
- Fix integrity check for all package managers by adding `relativePath` to `ResolvedPackage`

## Other

- Restructure tests to follow `@savvy-web/vitest` discovery convention with real generated lockfile fixtures
