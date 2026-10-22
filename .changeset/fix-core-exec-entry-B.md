---
"@nudojs/core": patch
---

Proxy traps now reach the enumeration and extensibility faces.

- `Object.isExtensible(proxy)` dispatched no trap at all: the `isExtensible`
  trap was missing from the handler lookup table, so the call always folded to
  a definite `true`. A proxy whose trap reports `false` while its target is
  still extensible makes the native engine throw a `TypeError` (the
  extensibility invariant is violated), and the trap's own side effects were
  dropped as well. The trap is now dispatched, its result is coerced with
  `ToBoolean`, and a mismatch against the target's real extensibility raises
  the `TypeError` the native engine raises. The target's real extensibility
  follows `Object.preventExtensions` / `Object.freeze` on the proxy, which
  freeze the *target* in the native engine.
- `for (const key in proxy)` enumerated the **target's** own enumerable keys
  and ignored the `ownKeys` trap, so it produced an exact but wrong key
  sequence. The enumeration now goes through `[[OwnPropertyKeys]]` (the
  `ownKeys` trap, including the spec's invariant checks — duplicate entries or
  a missing non-configurable target key raise a `TypeError`) and then filters
  the result by enumerability through `[[GetOwnProperty]]`. The key order is
  the trap's order, as in the native engine.
