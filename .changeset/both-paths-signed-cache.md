---
"@nudojs/service": minor
"nudojs": minor
---

DX: `nudo test --both-paths` (directive + synthesized witnesses in one round) and opt-in HMAC-signed disk cache entries.

- `nudo test <path> --both-paths [--only <names>]`: functions with `@nudo:case` directives now *can* also synthesize `call@`/`entry@` witnesses in the same round (teaching comparison face; default exclusivity unchanged). `--json` separates the paths via `source: "directive" | "callsite"`; exit semantics unchanged (synthetic cases never fail the run). `--only` without `--both-paths`, and `--both-paths --freeze`, are usage errors.
- Signed disk cache: `package.json#nudo.cache.sign: true` + `NUDO_CACHE_KEY` signs every entry (HMAC-SHA256, domain-separated key derivation). Verification failure = miss (recompute, never trust) — a forged CheckJson can no longer pass the gate; signed/unsigned key spaces are separate, so key rotation is a clean full miss. Fail-closed config: sign without a key, or a non-boolean sign, refuses to run (`check` / `contract` / `health`, machine-readable on `--json`) instead of silently running unsigned. `nudo.cache` also accepts an object form `{ dir?, sign? }`; typo'd keys surface as `config-shape` report entries.
- truncation suggestions: fork/recursion-budget fix values in the analyzer now consume the single-sourced `suggested{Fork,Depth,Calls}Ceiling` helpers from `@nudojs/core/internal` (same wording as the check face, concrete numbers instead of `@nudo:budget depth=…` placeholders).
- benchmark: `bench-monorepo.mts --corpus <path>` runs the S1 benchmark against a real monorepo directory (dynamic hub/mid/leaf targets from the module graph, in-memory edits only — user files are never written; report lands in `s1-perf-baseline-real.{md,json}` with an honest corpus header).
