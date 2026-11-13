---
"@nudojs/core": patch
---

Replay `finally` for `for…of` exits over generator objects. `$forOf` eagerly drains a generator's elements before the loop, so a `break` (or `throw`/`return` in the body) previously closed an already-done generator and the finalizer never ran at the suspension point. A leaf registry (`runtime/gen-return-at.ts`) now attaches `returnAt(k)` to each generator object: it rewinds the consumption cursor to the k-th yield, restores the suspension snapshot, replays the finalizer (and forwards through `yield*`), and falls back to the sound join when the timeline frame is unavailable. The registry is carried over when the lazy trigger upgrades the shell to the freshly evaluated body. Result: `for (const v of g()) break` across `try/finally` now yields the native-exact cleanup value; `yield*`-delegated breaks and finalizers with their own control flow keep the plan-C over-approximation. Pinned by `abs13-abrupt-completion.test.ts`.
