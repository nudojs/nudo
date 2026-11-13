---
"@nudojs/core": patch
---

Surface finalizer throws on generator abrupt completion. When a safely extractable `finally` thunk throws during `.return()`/`.throw()` replay and the generator body has no outer free writes (no snapshot hooks), the exception now propagates like native instead of being skipped — e.g. `try { yield 1 } finally { null.x }` no longer reports a normal completion (pinned by `abs13-abrupt-completion.test.ts`). Async generators wrap replay errors into a rejected promise where the runtime path reaches it. Remaining follow-ups: finalizers with `yield`/`return`/`throw` statements, `for-of break` replay by iteration index (the eager collector drains the generator before the loop), and the async-generator replay path.
