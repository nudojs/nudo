---
"@nudojs/core": patch
---

Fix async-generator replay rejection. When a replayed `finally` throws during `.return()`/`.throw()` on an async generator, the runtime now returns the rejected promise directly instead of wrapping it again in `deliver`, so awaiting the call rejects like native. Fixture: `async function* g() { try { yield 1 } finally { null.x } }` + `await it.return(0)` now yields `promise<"rejected">` instead of `promise<"resolved">`. Side-effect finalizers keep resolving (`promise<true>`), pinned by `abs13-abrupt-completion.test.ts` (13 cases).
