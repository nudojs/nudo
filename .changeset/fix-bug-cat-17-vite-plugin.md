---
"vite-plugin-nudo": patch
"@nudojs/lsp": patch
"@nudojs/service": patch
---

Fix bug-report category 17 (vite-plugin gate surface).

- BUG-110: the plugin's report face and gate face agree on `ignoreThrows`, so the same
  project no longer yields contradictory verdicts between the two faces.
- BUG-111: project-level env is resolved from the project root rather than the importing
  file's directory, and env-module exports are merged with `mergeHarvestUnderEnv` instead
  of object spread — so adding an unrelated `@nudo:env` line no longer flips the gate from
  green to red, and harvest-only exports are no longer dropped.
- BUG-221: project-level env resolves against the project base dir, so the plugin gate
  matches the evaluator.
- BUG-222: a project-level env load failure is no longer silent in the plugin; it reports
  `nudo:env-unresolved` like the CLI and LSP instead of a false green.

Regression tests: `vite-bug-110-*`, `vite-bug-111-*`, `vite-bug-221-*`, `vite-bug-222-*`.

Note: BUG-140 (listed in this category file but whose defect is the LSP diagnostic face
missing `nudo:internal`) is NOT covered here; it belongs to category 14.
