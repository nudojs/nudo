---
"@nudojs/core": patch
---

Fix: frozen/sealed array-like receivers now enforce the mutator integrity gate; add async-plan drift gate.

- `$arrMutContainer` (arr-methods.ts): hoist the extState integrity gate (frozen → TypeError on any mutator; sealed/non-extensible → TypeError on structural extension) ahead of the tuple/arr vs array-like dispatch — the generic-borrow path (`Array.prototype.push.call(frozenArrayLike, …)`) previously bypassed it and silently succeeded where native semantics throw. Extend the Bug 223 sealed pop/shift analysis with an array-like obj arm (own-slot analysis mirroring the tuple formula; unmodelable shapes record a conservative may-throw). Parity test pins updated from "documents the gap" to "asserts the gate".
- New `async-plan-drift` test (92 cases): pins every row of the async-plan gen/thunk classification table and uses the V8 compiler itself as the emitter-alignment oracle — bodies classified all-safe must produce host-form output that compiles under `new Function` (a mis-classified await yields inside a nested arrow ⇒ SyntaxError, the Bug 1139 failure mode); thunk bodies pin the sync fallback path stays compilable. All four `asyncBodyPlan` consumers covered (function / object method / class method / top-level await).
