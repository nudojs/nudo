---
"@nudojs/core": patch
---

Stop reporting native-impossible fixed values for generator **abrupt completion**. When `.return()`, `.throw()`, `for-of break` or `yield*` forwarding terminates a generator inside `try/finally`, the enclosing `finally` runs natively; the eager model left outer bindings at the suspension snapshot, so reading a binding written by the finalizer could return a precise value native never produces (e.g. `false` where native is `true`). Abrupt completion now joins the suspension snapshot with the terminal frame per captured binding (`joinGenSuspendTerminal`), which is sound: case results widen from `false` to `false | true`. Precision (replaying the finalizer itself) remains a follow-up; no-finally generators and normal exhaustion are unchanged, pinned by `abs13-abrupt-completion.test.ts`.
