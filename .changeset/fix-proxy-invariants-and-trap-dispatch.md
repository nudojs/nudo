---
"@nudojs/core": patch
---

Proxy traps are now dispatched and the invariants of the proxy
specification are checked.

- A proxy with a `get` trap was not checked for the invariant that a
  non-configurable and non-writable property of the target must be
  reported with the same value, so the trap could report a different
  value where JavaScript would raise a `TypeError`.
- A proxy with an `ownKeys` trap was not checked at all: a duplicate key,
  a key that is not a string or a symbol, a missing non-configurable key
  of the target, or an extra key on a non-extensible target were all
  accepted. The invariant checks are now performed, and the trap is
  dispatched from `Reflect.ownKeys`, `Object.keys` and
  `Object.getOwnPropertyNames`.
- `Reflect.set` raised a `TypeError` where the original returns `false`,
  and `Reflect.deleteProperty` reported success where the original raises
  a `TypeError` for a non-configurable property of the target.
- `Reflect.get` and `Reflect.getOwnPropertyDescriptor` did not dispatch the
  traps of the proxy at all.
- A proxy was only marked as a fresh instance when one of its traps was
  used, so two proxies over the same target could not be told apart. The
  mark is now applied where the proxy is created.
- A proxy without a `get` trap fell back to reading the target, and the
  getter was called with the target as its receiver. The receiver is the
  proxy now, as the specification requires.
