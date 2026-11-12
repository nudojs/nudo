---
"@nudojs/core": patch
---

Speed up snapshot copies on object-heavy graphs. `copyWithMemo` now checks the leaf shapes (`prim` / `never` / `any` / `unknown`) before the memo lookup: leaves are immutable and are never stored in the memo, so the result is identical but one `WeakMap` query is saved on every leaf (71.4% of calls in the ABS-17 reproducer). The `obj` / `fn` slot loops also switch from `Object.entries` to `for...in` and reuse leaf slot values directly, removing one `[k, v]` array and one recursive call per leaf slot. In the ABS-17 object-export reproducer (single file, N object exports) N=800 drops from 5077ms to 3297ms and N=200 from 464ms to 339ms; combined with the earlier `setSlot` fast path the same file goes from 8524ms to 3297ms (-61%). Copy semantics (leaf sharing, fresh non-leaf copies, alias preservation, slot flags) are pinned by `copy-abs-leaf-sharing.test.ts`; gold recall/precision, real-package zero-FP and the ABS-14 equivalence gate are unchanged.
