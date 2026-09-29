---
"@nudojs/core": patch
---

fix(env): env globals no longer shadow the host `undefined` / `NaN` / `Infinity`

`runTranspiled` injects every `@nudo:env` global as a module-scope
`const <name> = __nudoEnv["<name>"]`, which shadows the host global for the
whole transpiled body. `@nudojs/env/es` declares `undefined: undef()`, and
`web` / `node` imply `es` — so any `nudo.env` declaration shadowed `undefined`:

- the transpiler's own bare `undefined` text (`stmt` missing `else` arm,
  implicit return) and `$lit(undefined)` received an **Abs object**;
- effect: a conditional `return` inside a loop joined to `unknown`, so
  `for (const s of list) { if (s === "high") return "l1"; } return "l0";`
  folded to `unknown` instead of `"l0" | "l1"`;
- `NaN` bound as `prim.num()` degraded `0 === NaN` from the definite `false`
  of native semantics to `boolean`.

Injection now skips `undefined` / `NaN` / `Infinity`: the transpiler already
hardcodes those identifiers as `$lit(...)`, so the consts had no upside and
only shadowed the host.

Measured on a consumer project (npm-safe) with `nudo.env = ["es","node","web"]`:
`nudo test` went 39/39 → 23 passed / 10 failed; with this fix it is 33 + 6
planned cases green again, plus `opaque-result` 34 → 28, `unknown-inference`
9 → 6, `host-effect-blocked` 1 → 0 (env-declared builtins now fold instead of
failing closed).
