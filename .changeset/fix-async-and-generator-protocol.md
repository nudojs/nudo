---
"@nudojs/core": patch
---

Promises and generators now report what the original reports.

- Awaiting a promise with two arms dropped the rejected arm, so the
  `catch` branch was unreachable and the domain of the enclosing function
  was wrong. The rejected arm is recorded now: a `try`/`catch` inside the
  function can absorb it, and what is not absorbed becomes the rejected
  arm of the promise instead of escaping to the caller.
- Awaiting a thenable did not adopt it: the thenable object itself was
  returned. A thenable with a callable `then` is adopted now and the
  settled value is used. A value whose adoption cannot be decided is
  returned unchanged.
- `yield*` did not forward the `return` of the delegating generator to the
  iterator it delegates to, so the cleanup of the delegated iterator was
  lost. The `return` is forwarded now, and the outcome of the delegation
  decides the outcome of the outer generator.
- A generator object was modelled as a plain object with its own
  enumerable properties, so `Object.keys(g)` listed six keys, `g[0]`
  returned the first yielded value and `"0" in g` was `true`. The
  properties of a generator are internal now: they are not enumerable and
  not own properties, while the protocol methods are still reachable.
- The same applies to the shape of a generator: the protocol methods are
  no longer published in the type of a generator, in its constraint, or
  in the guard that is generated for it.
