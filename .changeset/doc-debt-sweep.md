---
"workspaces-effect": patch
---

## Documentation

Address eight stale design-doc audit issues (#47, #48, #49, #50, #51, #54,
#55, #57). No code changes.

- `architecture.md`: corrected error-type count from 11 to 12 (missing
  `LockfileIntegrityError`); added the optional `cwd` parameter to the
  documented `WorkspaceDiscovery` method signatures.
- `CLAUDE.md`: removed two stale references to a non-existent `pkgs/`
  directory and replaced the example test command with a single-package
  equivalent; updated the code-review summary from "5/10 fixed" to
  "6/10 fixed".
- `code-review-findings.md`: replaced the open-ended "Should fix soon"
  marker on Issue 3 (`/**` glob) with a reference to the new GitHub issue
  #62 that tracks the fix.
- `phase4-configuration-lockfiles.md`: replaced the stale, self-referential
  composite layer example with the real `Layer.mergeAll` shape from
  `src/layers/WorkspacesLive.ts`.
- `phase3-change-detection.md`: corrected the false claim that
  `ChangeDetectorLive` does not resolve `CommandExecutor`; the layer does
  yield it inside `Layer.effect` so service methods have `R = never`.
- `research-notes.md`: promoted from `draft`/60 % to `current`/100 % and
  added a header marking the document as historical reference material that
  informed the architecture rather than a prescriptive spec.
