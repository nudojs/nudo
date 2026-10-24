---
"nudojs": minor
---

check 面新增了此前**不存在**的诊断码（`nudo:json-invalid` 等）⇒ 机器面新增
可观测的诊断码属**增量**变更（additive）⇒ minor。

`nudo check` now reports the diagnostics it used to swallow: module-loading
problems and env-harvest conflicts reach the check face instead of being
dropped.

- A dependency that could not be found, or that did not provide the requested
  export, was diagnosed by the analyzer but never surfaced, so the gate stayed
  green on a program that could not even be loaded. Module-loading problems
  are now visible on the check face (`nudo:module-missing`, `nudo:missing-export`
  as errors; `nudo:module-cycle`, `nudo:module-depth`, `nudo:json-invalid`,
  `nudo:exports-unresolved` as warnings).
- The same finding was reported twice when it arrived through both the mock
  channel and the module-graph channel; the duplicates are now collapsed.
- A handwritten `@nudo:env` that wins over the harvested environment was
  invisible on the check face although the documentation lists it as a check
  warning. It is now reported as `nudo:env-harvest-conflict` (warning, so it
  does not block the gate).
- `--from` now also sees call sites that live inside a function body: the
  call-site files are scanned statically as well, so a violation that was
  visible when the caller was checked alone is reported when the callee is
  checked with `--from`.
