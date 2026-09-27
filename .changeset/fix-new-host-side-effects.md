---
"@nudojs/core": patch
---

fix(core): never-execute host side-effect guard also covers `new`

`$new` was not identity-guarded against the host side-effect list
(`WebSocket` / `XMLHttpRequest` / `EventSource`), so `new WebSocket(url)`
only avoided real network I/O by falling through to an empty brand —
a coincidence, not an explicit block. Both `$callNamed` and `$new` now
share `blockHostSideEffect`: identity match fails closed to
`unknown#opaque` and reports `nudo:host-effect-blocked`.
