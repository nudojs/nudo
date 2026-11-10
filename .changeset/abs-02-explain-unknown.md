---
"@nudojs/core": minor
"nudojs": minor
---

ABS-02: explain where `unknown` / `any` came from (observation-only side channel).

- New `buildUnknownExplanations` / `formatUnknownExplanations` (core) derive a stable, deduped reason list from existing observation faces (signatures, issues, budget, eval fallbacks) — no Abs field, no cache-key or `leqAbs` change; cold/warm results are untouched by construction.
- Reasons: `budget` / `missing-env` / `unsupported` / `eval-failure` / `no-contract` / `explicit-any` / `inference-failure`, each with an actionable suggestion. Cycle truncation says explicitly that `@nudo:budget` cannot help.
- `nudo check --explain-unknown` prints the list after the human report; default output is byte-identical and `--json` / `--gitlab` machine contracts are unaffected.
