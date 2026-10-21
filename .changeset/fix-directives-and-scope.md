---
"@nudojs/core": patch
---

The `@nudo:as` and `@nudo:replace` directives now affect exactly the node
they annotate, and `this` inside a default parameter binds to the function
that owns the parameter.

- `@nudo:as` is a type override: the annotated expression must still be
  evaluated. The transpiler replaced the whole expression with the injected
  constant, so the side effects of the expression never happened, the
  expression's throws domain disappeared (`JSON.parse` failures were
  swallowed and the entry point was reported as not throwing), and the
  runtime value was wrong. The expression is now evaluated once and the
  injected value is used as the result.
- `@nudo:replace` had the same problem: the replaced sub-expression was
  never evaluated, so its side effects were lost and its throws domain
  disappeared. It is now evaluated once, and the injected value is used as
  the result.
- The scope of both directives was decided by a window of line numbers, so
  an unrelated expression on the same line, the next statement on the same
  line, a nested block or a nested function body was overridden or
  replaced as well. The scope is now decided by the identity of the
  annotated node, so only that node is affected.
- `this` inside a default parameter expression bound to the `this` of the
  enclosing scope. In JavaScript the default value is evaluated in the
  scope of the function that owns the parameter, so `this` is that
  function's own `this`. The transpiler only looked for `this` in the
  function body, so the default expression used the outer `this`: a
  default of `this.v` returned the outer object's value instead of
  throwing, and a default of `this` returned `undefined` instead of the
  receiver.
- The body of an arrow function or a function expression is an expression,
  and the value of `o.n++` had to be captured before the write-back ran.
  The expression is now captured first, the write-back second, and the
  captured value is returned.
- The optional call `o.b?.()` short-circuited only the call itself: when
  `o.b` was nullish, the rest of the chain was still evaluated and
  `undefined.c` was reported as a definite `TypeError`. The whole chain is
  now short-circuited, like the optional member access `o.b?.c` already
  was.
