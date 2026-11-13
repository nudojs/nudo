---
"@nudojs/core": patch
---

Add an explicit host **capability manifest** (ABS-12 R12-D, first slice) and use it for runtime identity blocking. `exec/capabilities.ts` classifies 188 host globals and all `node:` builtins as allowed/denied with default-deny, plus snapshots for drift gates; `neverExecHostName` now blocks every denied host function by identity (aliases such as `const f = BroadcastChannel` included), not just the hand-written fetch/timer list. Denied values still degrade to `unknown` (no native execution), and allowed values (e.g. `Array`, `Buffer`, `structuredClone`) are untouched. A new drift test fails when a Node upgrade or runner injects an unclassified global/builtin, forcing explicit review. Remaining for the capability work: the `nudo:capability-denied` diagnostic code, module-resolution denial, and the `--capabilities trusted` opt-out.
