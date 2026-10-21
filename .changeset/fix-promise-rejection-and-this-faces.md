---
"@nudojs/core": patch
---

Promises keep their rejection channel, and the static methods respect
their `this` binding.

- A throwing executor now rejects the promise. The rejection used to be
  swallowed, which turned `catch` into dead code and reported a
  confident wrong value.
- `Promise.all` / `race` / `any` keep the rejection channel instead of
  dropping it, and `race` / `any` no longer settle with the element
  promise itself.
- `Promise.allSettled` projects each entry correctly: `value` holds the
  resolved value, `reason` holds the rejection reason, and `status`
  distinguishes fulfilled from rejected.
- A non-callable `then` / `catch` handler passes the value through
  unchanged, as in the language, instead of rejecting the promise.
- `Promise.resolve` / `reject` / `all` / `race` / `any` / `allSettled`
  are ordinary functions that receive `this`. `Promise.resolve.call(null, 1)`
  now throws a `TypeError` (it used to return a value and report no
  throw), while `Promise.resolve(1)` and `Promise.resolve.call(Promise, 1)`
  keep working.
