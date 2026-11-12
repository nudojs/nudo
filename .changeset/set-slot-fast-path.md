---
"@nudojs/core": patch
---

Speed up slot writes on the object-copy hot path. `setSlot` no longer calls `Object.defineProperty` for every key: plain assignment has the same semantics for an engine-owned slot record (own, enumerable, writable, configurable data property), and `__proto__` keeps the `defineProperty` path so it still creates an own slot instead of rewriting the prototype. In the ABS-17 object-export reproducer a single module drops from 8427ms to 5077ms at N=800 (-40%) and from 620ms to 464ms at N=200 (-25%); the 120-file synthetic corpus cold analyze drops from 13635ms to 9776ms (-28%). `setSlot` self-time in that stack falls from 33% to noise. Semantics are pinned by `set-slot-semantics.test.ts` (own/enumerable/writable/configurable, `__proto__`, prototype-shadowing keys, null-proto tables).
