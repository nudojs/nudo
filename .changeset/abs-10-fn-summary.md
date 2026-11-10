---
"@nudojs/core": minor
---

ABS-10: cross-instance post-summaries for function instantiation (conservative phase).

- New summary layer (`key/fn-summary.ts`): the post `Abs` of a body evaluation plus its α variable order, keyed by function identity (source hash + name + deps fingerprint + sidecar fingerprint) × instance key (α-normalized args + Φ, including the conf digest).
- A new `PolyFn` instance (same function/context, e.g. re-generalized with a different display label) can hit the summary instead of re-running the body; results are α-renamed back to the caller's names and are byte-identical to the body path. The instance-level memo stays the first layer.
- Only pure contexts participate: `refine` / `inject` / custom budgets (unhashable closures that change body semantics) bypass the store entirely; seeded analysis windows neither read nor write it.
- `resetGeneralizeMemo()` clears the summary layer too (explicit invalidation hook; no cross-round object reuse).
- Bounded at 4096 entries (oldest evicted); stats exposed on the internal module for observability.
