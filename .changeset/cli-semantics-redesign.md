---
"@nudojs/cli": major
"@nudojs/core": major
"@nudojs/service": major
"@nudojs/lsp": major
---

feat!: unify CLI around check/test/contract/export/health + L2 entry may-throw

- Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports (no `infer`/`show`/`types` verbs). Old verbs (`infer`/`types`/`generate`/`emit`/`guard`/`interface`/`doctor`/`watch`/`harvest`) print stderr deprecations and are removed in the next major. Thin shell `@nudojs/nudojs` follows `@nudojs/cli` majors.
- L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Covers export function/default/const arrow, `export { f as g }`, anonymous `export default` fn/arrow, CJS `exports.f=` / `module.exports={ f(){} }` ObjectMethod, and exported class static methods. Configure with `--ignore-throws` / `--entry-throws error|warning|off` or `package.json#nudo.check.{ignoreThrows,entryThrows}`. LSP/agent check paths read the same `nudo.check` config; analysis.diagnostics=off still surfaces gate errors in IDE.
- Nested try: soft may-throw from an inner try re-homes to the enclosing try frame (outer catch digests). Catch rethrow does not digest soft effects on either ast-eval or B-path.
- `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure + `nudo:unknown-inference`). `check --abs` remains observation but still gates on L1/L2 errors. `--ignore-throws` filters the gate but signature still shows throws domain.
- `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit (including `--json` / `--abs`). `--freeze[=update]` replaces `infer --emit-cases`. Assertion summary counts declared cases only.
- Flag renames: `--callsites` → `--from`; `infer --dts` → `export --format dts`; `types` → `check --abs`. `--json` cannot combine with `--abs`.
- Public API: `@nudojs/service` and `@nudojs/service/evaluator` export `checkConfig` / `CheckConfig`. CheckJson signatures carry `paramTypes` / `throws` / `entry`.
- Agent/LSP wire names `nudo.infer` / `nudo.interface*` stay **protocol-stable** this major; docs map them to CLI `check`/`test`/`contract`.
- Breaking for CI scripts that assumed silent check-on-success, or that relied on `nudo infer` as the primary observation verb.
