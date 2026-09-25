---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/cli": minor
---

fix review gaps on the B-path migration (PR #34 follow-up):

- **inject pipeline**: `CheckOptions.inject` is now threaded into generalize, L2 throws, the record channel, and drift recompute (previously CLI computed mocks/env/replacements but only `modules` reached core; `@nudo:mock`/`env`/`replace` sources were fail-closed `unknown#opaque` under `checkSource`). Memo keys use inject **content** fingerprint (stable across CLI's per-call object allocation). `mode: "analyze"` always wins; `modules` prefers `opts.modules` then `inject.modules`.
- **L2 class / CJS methods**: explicit `throw` on class static methods and CJS object methods is no longer hard-coded as `throws: never` — NudoThrow/ReferenceError map to throws Abs (same as `callTranspiledExportFull`). `$call` records throw exits before returning `never`. L2 evaluation now seeds `phi` from `checkSource`.
- **`freeIdentifiers`**: lexical scopes (nested params no longer pollute outer free set); non-computed `ObjectMethod`/`ClassMethod` keys are not free refs.
- **`callBudgetKey`**: single defensive implementation for non-Abs args (B-run JS function args). `$call` compiled-body path now uses `enterCall`/`exitCall` (same budget as apply). Budget keys use fn object identity (`stableCallId`) instead of `anon#N` (false cycles across same-arity functions). `MAX_TOTAL_CALLS` unified at 20k.
- **method early-return (correctness)**: `ObjectMethod` / `ClassMethod` / property `FunctionExpression` bodies now go through `transpileFnBodyStmts` (early-return lift) + implicit return — previously `if (c) return X; return Y` silently always returned `Y` (false precision vs native).
- **collectors**: `setBCallCollector` / `setBAssignCollector` / `setMemberDiagCollector` / `setAbsTruncationCollector` return the previous collector; nested call sites save/restore instead of nulling.

User-visible notes:

- Sources with `@nudo:mock` / `@nudo:env` / `@nudo:replace` get real B evaluation under `nudo check` (CLI already built the inject pack).
- Class static / CJS object methods with explicit throws now report `entry-may-throw` (L2 no longer misses them).
- Object/class methods with early-return branches now fold the same values as native JS (differential batch19).
- `interface-derivation` class-method roots stay fail-closed (no call-chain derivation) — intentional after ast-eval removal.
