---
"@nudojs/core": patch
---

Loop-return join soundness (root-cause class C9) from the differential bug
report: a `return` inside a `while`/`for` body with an abstract test no
longer drops the zero-iteration path — the body's return value is
collected as one arm and the post-loop statements as the sibling arm
(`whileGuard(x)` with `any` folds `any | 0` instead of the unsound exact
`0`); `NudoThrow` still propagates and definite-true loops keep bubbling
(Bug 99). Generator/async thunk bodies are the target boundary of
`$loopReturn` — absorbed arms merge into the generator terminal value
domain / the promise inner domain (`async f(x){ while(x<0) return 5;
return 9; }` folds `promise<5 | 9>` with no phantom number arm), which
also fixes the pre-existing fork/switch-in-generator phantom-arm family.
Bug 1 (guarded plain-variable return contracts) was already fixed by a
prior commit (verified against the report's repro matrix).
