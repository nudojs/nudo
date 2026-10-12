---
"@nudojs/core": patch
---

Fix loop-mutated array bindings widening with fabricated `(unknown | undefined)[]` arms — `for…of` + `push` return values now prove against element contracts (issue #156):

- `loop-widen.ts`: tuple length growth (push accumulation) is now detected as element-domain growth (`{el}`) instead of whole-value growth; widening goes through `arrify` — element domain = join of all observed element domains. No fabricated `unknown` element arm from the empty initial tuple, no baked out-of-bounds `undefined` (OOB is a read-site fact: `$idx` on an abstract index already joins the marker; concrete-index optimism matches the engine-wide `arr` invariant shared with `splice`/`sort` degradation).
- Packed-container slot joins produce sums of objects (`joinValues` does not structurally merge object slots); `normalizeForWiden` structurally merges same-key-set object sums before the growth tree descends, so sequential states of `{ list: [...] }`-style accumulators union their element domains instead of widening the zero-element member alone into `arr(unknown)`.
- `control.ts` `widenLoopJoin`: stops baking the OOB marker into collapsed element domains (hole reads still contribute, they are real element values).
- `postcondition.ts`: `conf="widened"` structural arms (`arr`/`tuple`/`obj`) against `array(...)`/`shape(...)` contracts (union members traversed) now discharge through per-element/per-field reconciliation — widening loses length/key-openness/bound/path evidence, not the structural domain. Guards unchanged: bounded element contracts (`number().gt(0)`), mismatched prim domains, and unknown element domains stay `unprovable`; interrupted loops (abstract `break`) keep the honest `unknown[]` top.
