---
"@nudojs/core": patch
---

Call-site contract enforcement no longer depends on where the call sits, and
default parameter values are checked against the contract they belong to.

- `f(true)` was checked only when the call was a top-level statement. The
  literal fast path had no case for boolean literals, so `f(true)` fell
  through to the unknown fallback and the call site carried no enforceable
  information. Only the evaluator's value-flow fallback could still see it,
  and that fallback has a record only for statements the module actually
  executed — a call inside a function body was therefore never checked.
  Boolean literals now have their own case in the fast path, so the same
  violation is reported identically in both places.
- A parameter with a default value (`f(x = -5)`) was never checked when the
  call passed no argument at all: the zero-argument early return skipped the
  whole call site. The default value was computed by the engine and then
  never reconciled with the contract, so a default that violates its own
  precondition passed silently. Zero-argument calls now fill the argument
  positions from the callee's default values before the contract is
  enforced. Defaults that cannot be read statically (destructuring
  patterns) are left alone rather than guessed at.
