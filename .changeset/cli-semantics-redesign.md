---
"@nudojs/cli": major
"@nudojs/core": major
"@nudojs/service": major
"@nudojs/lsp": major
---

feat!: unify CLI around check/test/contract/export/health + L2 entry may-throw

- Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports (no `infer`/`show`/`types` verbs). Old verbs (`infer`/`types`/`generate`/`emit`/`guard`/`interface`/`doctor`/`watch`/`harvest`) print stderr deprecations and are removed in the next major.
- L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Configure with `--ignore-throws` / `--entry-throws error|warning|off` or `package.json#nudo.check.{ignoreThrows,entryThrows}`. LSP/agent check paths read the same `nudo.check` config.
- `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure). `check --abs` remains observation but still gates on L1/L2 errors.
- `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit (including `--json` / `--abs`). `--freeze[=update]` replaces `infer --emit-cases`.
- Flag renames: `--callsites` → `--from`; `infer --dts` → `export --format dts`; `types` → `check --abs`.
- Breaking for CI scripts that assumed silent check-on-success, or that relied on `nudo infer` as the primary observation verb.
