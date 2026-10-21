---
"@nudojs/service": patch
---

Derived contracts now name the parameter the implementation actually returns,
and the same function derives the same contract no matter how many call sites
the root has.

- The return slot of a derived contract was anchored to a parameter by the
  derivation root node id alone. Every parameter derived from the same
  upstream variable shares that id, so `helper(a, b) { return b; }` called as
  `helper(x + 5, x + 1)` anchored the return to the **first** parameter and
  wrote `fn({ a, b }, a)` — a return constraint of `number().gt(5)` for an
  implementation that only guarantees `number().gt(1)`. The contract was
  stronger than the code, and `nudo contract` displayed it as authoritative.
  The anchor is now resolved against the parameter it actually describes:
  when several parameters share a root, they are told apart by the
  constraint value, and when that is still ambiguous the relative anchor is
  refused instead of guessed, so the return slot falls back to the direct
  chain projection.
- A derived contract for one function could change shape when the root
  called it once or twice. The derivation tags were read after the call-site
  values had been joined, and joining two equal values returns one of them,
  so the join tag replaced the shift chain of the first call site and the
  compositional projection was never reached. The tags are now read before
  the join, and the return slot of a multi-call-site root is projected call
  site by call site. `add2(x) => x + 2` called once or twice now derives the
  same `fn({ x }, x.shift(2))`, instead of the second form degrading to a
  literal bound one ULP away (`number().gt(0.9999999999999999)`), which
  accepted a boundary value the exact form rejects.
- When the call sites of one root do not derive the same chain, the derived
  section falls back to the expanded form; it no longer emits two `const`
  declarations of the same name with different values, which is not valid
  JavaScript.
