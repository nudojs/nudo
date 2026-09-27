---
"@nudojs/core": patch
---

fix(core): never execute host side-effect globals in the B path

`$callNamed` executed any host function it could not fold, so a module calling
`fetch(url)` made the analyzer issue a **real** network request with Abs
arguments (`[object Object]`): `nudo check` / `nudo test` died with
`TypeError: Failed to parse URL from [object Object]` (ERR_INVALID_URL) via an
unhandled rejection. `setTimeout` / `setInterval` scheduled real timers the
same way.

`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / timers /
`queueMicrotask` / `requestAnimationFrame` / `requestIdleCallback` are now
identity-guarded (aliases included) and fail closed to `unknown#opaque`,
reported through a dedicated `nudo:host-effect-blocked` (info) diagnostic —
not `nudo:recursion-truncated`. Other host functions still evaluate for real.
