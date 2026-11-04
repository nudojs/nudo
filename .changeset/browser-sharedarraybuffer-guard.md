---
"@nudojs/core": patch
---

Fix: engine module loads in browsers without `SharedArrayBuffer` (Playground crash).

- Two module-level tables referenced the bare global identifier `SharedArrayBuffer` at evaluation: `NAMESPACE_ONLY_HOST_CTORS` (`exec/runtime/members.ts`) and `NAMESPACE_GLOBALS` (`exec/runtime/containers/member.ts`). In non-crossOriginIsolated contexts Chrome does not expose it ⇒ `ReferenceError: SharedArrayBuffer is not defined` at import time ⇒ the whole engine bundle failed to load and the Playground error boundary rendered “This page crashed”.
- Fix: both tables now use the existing `Float16Array` guard pattern (`typeof SharedArrayBuffer !== "undefined"` ⇒ entry included, otherwise omitted; lookups stay fail-closed for that name). Verified in headless Chromium against a production build served **without** COOP/COEP headers: `/playground/` loads, presets run with precise cases, share links and the tsc panel work (worker chunks emitted via relative-path entries); with isolation headers behavior is unchanged.
