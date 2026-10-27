---
"nudojs": patch
---

Fix bug-report category 10 (`nudo test` / `nudo health` / `nudo init`) — 10 of 11 defects.

- BUG-018: `nudo test --freeze <path>` treats the value as a path unless it is a known
  mode, so a path is no longer swallowed with `Usage error: needs at least one path`.
- BUG-036: witness identity keeps the call-site prefix, so deleting one of two call sites
  is reported as drift instead of `0 case drift / OK / exit 0`.
- BUG-037: a never-frozen file no longer reports case drift (`frozenWitnesses > 0` is
  required before comparing).
- BUG-038: a missing path now lands in `pathErrors` / `targetErrors` with
  `summary.errors` = 1 instead of being silently skipped.
- BUG-039: contract drift counts `@generated` slots (Σ `interfaceDrift`) instead of files,
  so detail, summary and `--json` agree.
- BUG-054: health honours `--from` (same `externalAbsCallRecords` source as `check`), so
  drift is no longer invisible when `--from` is used.
- BUG-113: `health --json` emits a JSON error envelope on a usage error instead of
  printing 0 bytes.
- BUG-199: health's drift criterion now includes whole-section text drift
  (`emitInterface(mode: "update", dryRun: true)`), so `health` and
  `contract --emit --exit-on-diff` agree on the same sidecar.
- BUG-228: file-level `@nudo:env` is resolved with the two-baseDir layering that `check`
  uses, so `check`'s `nudo:interface-drift` and health's "0 contract drift" no longer
  contradict each other.
- BUG-229: `nudo init` rewrites the **effective** (last) `"nudo"` member and removes
  earlier duplicates, so the reported baseline is the one the loader actually reads.

Regression tests: `cli-bug-018-*`, `cli-bug-036-*`, `cli-bug-037-*`, `cli-bug-038-*`,
`cli-bug-039-*`, `cli-bug-054-*`, `cli-bug-113-*`, `cli-bug-199-*`, `cli-bug-228-*`,
`cli-bug-229-*`.

Known follow-up NOT covered here: BUG-136 (CLI `nudo test` witness line and the LSP
`agent-tools.ts` `observationTitle` disagree on indentation/spacing) needs
`packages/lsp/src/agent-tools.ts`, which is outside this category's file set; aligning
`run-test.ts#formatCaseLine` alone would break `test-entry-contract-note.test.ts`.
