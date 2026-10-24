---
"nudojs": patch
---

Five CLI-surface fixes (flags / JSON envelope / watch / config robustness).

- `--what-if` now accepts `name=type` as well as `name:type`. The documented
  commands (guides/ai-native-dx.md, reference/agents.md) use the equals form;
  the parser only accepted the colon form, so the whole token was taken as the
  binding name and the assumption silently did not apply ("Bindings not
  applied", exit 0).
- `package.json#nudo.check.ignoreThrows` is parsed by the same parser as
  `--ignore-throws` (comma-separated, trimmed, bare string or array). The
  config side used a strict `string[]` filter, so `"TypeError"` and
  `["TypeError,RangeError"]` were silently dropped and the gate stayed red
  although the throw class looked ignored. A malformed value (number / boolean
  / object) falls back to the default and prints one stderr warning.
- The `CheckJsonMulti` envelope no longer counts `--from` path errors as
  analysis errors: `summary.errors` equals the sum of `reports[].summary
  .errors` equals the human-face count (the contract core asserts). Path
  errors stay in `pathErrors[]`; a non-empty `pathErrors` still means
  `ok: false` and exit 1.
- `nudo check --watch --from` re-collects the call-site evidence every round
  instead of using a start-up snapshot, so a dependent file and its caller no
  longer give opposite verdicts for the same call in the same round. Missing
  call-site evidence turns the round red instead of silently reusing stale
  data.
- `package.json#nudo.env` with a non-array value is reported as a
  `config-shape` warning (file name + diagnostic code) in both the human and
  the `--json` face, and the consumption point no longer iterates it blindly.
