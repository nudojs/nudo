---
"@nudojs/core": patch
---

`await` now suspends the async body instead of running it to completion at
the call site.

- An `async` function used to be evaluated as a straight-line block: the
  whole body — including everything *after* an `await` — ran before the
  call returned, so its side effects were already visible to the caller.
  `async function f() { await 0; n = 5; } f();` left `n` at `5`; natively
  it is still `0`, because the continuation after an `await` runs in a
  microtask, after the current synchronous run has finished. The same
  applied to counters, log ordering across `async` calls, and a pending
  promise, which the engine walked straight through.
- An async body that contains an `await` is now compiled to a real
  generator, and `await x` suspends it at that point. The continuation is
  queued on the same microtask queue the promise reactions already use, so
  the order of work across a promise chain is preserved. `await` in an
  expression position — `const x = await f()`, `return await g()`,
  `h(await x)`, `x + await y`, `const { a } = await f()` — suspends the
  same way.
- The value of the returned promise is still the value the body reaches:
  the continuation fills the promise's inner value in place, so
  `promise<7>` is reported for `async function f() { return await g(); }`
  where `g` returns `7`.
- A `for await` loop is treated as one suspension point for the whole
  loop, rather than one per iteration. That keeps it consistent with how
  the engine already models `for await`; natively each iteration awaits
  separately.
- An async body whose `await` sits inside a branch arm, a loop body, a
  `switch` arm, or the right-hand side of `&&` / `||` / `??` keeps its
  previous behaviour: those positions are compiled to plain callbacks,
  where a suspension point cannot be expressed. The body as a whole is
  left unchanged rather than half-suspended.
