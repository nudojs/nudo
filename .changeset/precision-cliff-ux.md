---
"@nudojs/service": minor
"nudojs": minor
---

Feat: precision-cliff UX — `nudo test` call@symbolic hint + `nudo health` precision counts.

- `nudo test`: when a report contains `call@symbolic` (the symbolic aggregate witness folded from call sites beyond `callSiteBudget`), the report tail now appends one actionable note (`SYMBOLIC_BUDGET_NOTE`, same "fact — action A or action B" shape as the `nudo:recursion-truncated` advice): raise `package.json#nudo.analysis.callSiteBudget` (1–64, default 3) or pin exact witnesses with `@nudo:case` (limitations §3.2.2 wording — for recursion pin `@nudo:case`, don't rely on call@). Display-face only: no assertion counting, no exit-code change. Reports without `call@symbolic` stay byte-identical.
- `nudo health`: the Summary line and the `--json` summary (same source) now carry precision counts — `unknownSignatures` (functions whose return the engine could not infer; renders `unknown`, counted via the shared `inferenceFailed` predicate; `@nudo:skip` functions are declared faces and not counted) and `widenedWitnesses` (occurrences of `#widened`, i.e. witnesses with `conf === "widened"` — budget-folded symbolic aggregates / loop widening). Informational only, like `uncovered`: never gates the exit code. Text Summary reads `… · N unknown signature(s) · M #widened witness(es)`; `--json` summary gains additive keys `unknownSignatures` / `widenedWitnesses`.
- `@nudojs/service` exports `SYMBOLIC_BUDGET_NOTE` (single source for the note text; CLI and tests consume the same constant). Regressions pinned in `packages/nudojs/src/__tests__/precision-hints.test.ts`; family-63 health baselines and the e2e health golden updated for the Summary extension (their fixtures now pin src tsconfig per the `writeSrcTsconfig` convention, so they no longer silently test a stale `dist/`).
