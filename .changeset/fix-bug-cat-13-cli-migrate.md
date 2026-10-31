---
"nudojs": patch
"@nudojs/core": patch
---

Fix bug-report category 13 (`nudo migrate` status / strip / verify / retire) — 20 of 21
bugs, plus two defects that were filed under other categories but live in `migrate.ts`.

- BUG-234: `migrate strip` rewrites an enum's **computed member** references to
  `E["KEY"]` (reference-position aware) instead of leaving the initializer verbatim, so
  the stripped product no longer throws ReferenceError; string-valued computed members
  skip the reverse mapping like tsc. A `enumComputedMemberRewritten` report flag records
  the rewrite.
- BUG-050: `strip` refuses to write when a TS-only construct survives the stripper
  (`namespace`, `import x = require(...)`) instead of writing a `.js` that fails
  `node --check`/`nudo check` with exit 0.
- BUG-226: `migrate verify`'s env merge uses `mergeHarvestUnderEnv` (the `check` path), so
  harvest-only exports are no longer dropped ⇒ `verify` no longer reports `unknown` where
  `check` reports a precise type.
- BUG-064: `migrate verify` resolves project-level env against the project root and
  file-level env against the file's directory, and surfaces env load errors as
  `nudo:env-unresolved`.
- BUG-061: `migrate verify` installs the eval-fallback collector, so an internal analysis
  failure is an error-level `nudo:internal` (same code/severity as `check`).
- BUG-114: `migrate verify` runs the strict, extension-aware parse first, so TS-only
  syntax inside a `.js` file is a per-file `syntax-error` instead of `verify` saying
  `nudoOk: true`.
- BUG-015: `migrate`'s `ignoreThrows` uses the same lenient parser as `check`.
- BUG-051 / BUG-052 / BUG-103 / BUG-117 / BUG-118: retire batch semantics — a mixed batch
  retries the work-bearing targets and reports the skipped ones; `retire --all` shares
  `retireScope` with the single-target path; a leftover `migrate-retiring.json` is
  recovered; a repeat run reports `already retired` with a zero delta (the ledger no
  longer leaks into this run's result); a multi-root failure reports every bad root.
- BUG-053 / BUG-112 / BUG-179: JSON/human faces — dry-run results carry `dryRun`; an
  unknown action emits a JSON error envelope instead of empty stdout; the human face
  prints only this run's deltas.
- BUG-062 / BUG-063 / BUG-065 / BUG-102 / BUG-116: retire/status plumbing — the gate
  script test is command-text based and reports the real `from`; the workflow dedup key
  includes the line so the rewrite count is exact; a corrupt marker fails closed and is
  left byte-identical; `status` and `retire` share the same workflow scope; the product
  specifier is tried verbatim before candidate rewriting.
- BUG-178: `migrate status` uses retire's gate/compiler split for blockers and reports a
  `preserved` field; `next:` branches on state instead of being unconditional.

Regression tests: `migrate-bug-{015,050,051,052,053,061,062,063,064,065,102,103,112,114,
116,117,118,178,179,226,234}-*` and `core-bug-234-*`.

Known follow-up NOT covered here: BUG-017 (`--json` top-level shape) is blocked because
existing tests pin **both** an object envelope for failures and an array for success; a
single shape breaks at least two of `cli-bug-696-migrate-strip-json-envelope`,
`migrate-bug-cli-wiring`, `cli-bug-56-cli-face`, `cli-bug-675-migrate-retire-json-shape`,
`migrate-bug-1028-marker-json-same-shape`. Every failure path now uses the same object
envelope (including the previously empty-stdout unknown-action path).

## 追加：BUG-017 `migrate --json` 顶层形状恒为数组

成功路径早已是数组，动作级失败路径却输出对象信封（`{ ok:false, action, targets,
error }`）⇒ 消费方 `JSON.parse(stdout).map(...)` 在失败路径抛异常。现统一为
**数组**：失败/正常终止信封一律包成单元素数组（`[ { ok:false, … } ]`），
`status` / `verify` / `strip` / `retire` 四个 action 与未知 action 分支同口径。

已有测试更新（原先钉住对象信封）：

- `cli-bug-696-migrate-strip-json-envelope.test.ts`（失败面读 `[0]`，并断言
  `Array.isArray`）
- `migrate-bug-cli-wiring.test.ts`（Bug 1006 失败面同上）
- `cli-bug-56-cli-face.test.ts`（正常终止信封 `failedTargets` 同上）

成功路径的数组形状（`cli-bug-675` / `migrate-bug-1028`）不变。
