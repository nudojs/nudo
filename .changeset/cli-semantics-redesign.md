---
"@nudojs/cli": major
"@nudojs/core": major
"@nudojs/service": major
"@nudojs/lsp": major
---

feat!: product CLI face only — remove deprecated verbs/aliases; L2 entry may-throw

- **BREAKING — deleted with no compatibility layer:** verbs `infer` / `types` / `interface` / `refine` / `generate` / `emit` / `guard` / `doctor` / top-level `watch` / `harvest`; flags `--callsites`, `--output`, `--format zod`, `--dts`, `--emit-cases`; API `absToZodSchema`; `InferJson`/`serializeInferJson` → `CaseJson`/`serializeCaseJson`; LSP agent tools `nudo.infer` / `nudo.interface*` and aliases → `nudo.test` / `nudo.contract*`; config key `package.json#nudo.interface.*` → `package.json#nudo.contract.*`. Root scripts `infer`/`types`/`interface` removed.
- Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports + IDE hover. Thin shell `@nudojs/nudojs` follows `@nudojs/cli` majors.
- L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Configure with `--ignore-throws` / `--entry-throws` or `package.json#nudo.check.{ignoreThrows,entryThrows}`.
- Nested try: soft may-throw from an inner try re-homes to the enclosing try frame. Catch rethrow does not digest soft effects.
- `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure + `nudo:unknown-inference`).
- `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit. `--freeze[=update]` solidifies witnesses.
- Flags: `--from`, `export --format dts|guard|schema|standard|all` (`--dialect zod` for schema), `export --out`. `--json` cannot combine with `--abs`.
- Design docs consolidated: truth sources `design-kernel-merge.md` + `design-cli-semantics.md`; domain designs compressed to status summaries.
- Breaking for CI scripts that still call old verbs or read old config keys.
