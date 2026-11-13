---
"@nudojs/core": patch
---

Tighten generator abrupt completion around delegations and finalizer throws.

- The A1 timeline guard no longer disables the suspension timeline for every generator containing `yield*`; aligned delegations (same Abs per delegated element, no overlapping ranges, indices in bounds) keep the timeline, while fork-drifted ones still fall back. `returnAt(k)` also works for generators without snapshot hooks (no outer free writes). `for (const v of outer()) break` across `yield*`/`finally` now yields the native-exact cleanup value.
- Finalizers containing `throw` are replay-safe: conditional throws observed at the suspension point propagate exactly (sync throw / rejected promise for async generators). When replay is unavailable the runtime records `may-throw` (`YIELD_FINALLY_THROWS`) instead of folding a possibly-throwing finalizer into a definite normal completion.
Remaining: finalizers with their own `yield`/`return` statements still need true suspension. Pinned by `abs13-abrupt-completion.test.ts`.
