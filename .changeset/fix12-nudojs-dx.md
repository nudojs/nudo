---
"nudojs": minor
---

DX batch: face consistency across check/fix/export/health/test, plus `nudo init` and onboarding (fix-12, 20-point TS-parity batch).

- `export --format dts` consumes contract faces through the same `effectiveInterface` source as `check` — non-exported top-level functions no longer leak into `.d.ts`; evidence-less params stay unknown with a stderr note.
- `health` budget line no longer contradicts `check`: per-file budget snapshot, attribution segments only for the budget that actually triggered (depth 64/64, not "eval calls 71/20000"); human face and multi-envelope budgets aligned.
- `check --fix` no longer writes non-fixing contracts: array-method receivers synthesize `array(shape({...}))` from callback element reads, and a re-check gate downgrades unprovable totality to `[review]` — no auto-applied half-fixes.
- new `nudo init`: writes an idempotent adoption baseline into package.json (L2 → warning).
- zero-config failing check prints an onboarding block (`init` / `contract --draft` / `--profile` adoption); gate exit code unchanged.
- `nudo.test.profile` typos warn on stderr; syntax-error files print tsc-style blocks (path:line:col + excerpt + caret), `--json` folds them into `pathErrors`.
- `nudo test` annotates `entry@` fallback cases on contracted functions.
- TTY colors for severity markers / section headers (`NO_COLOR` master switch, `FORCE_COLOR` override, piped output stays plain); `check --quiet` suppresses signatures; `check --help` flags grouped (Common/Observation/Fix/CI/What-if); `contract --draft` emits uncomment-to-accept suggested bindings; diagnostics outside cwd print absolute paths; multi-file check prints an opt-in cache hint.
