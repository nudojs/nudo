---
"@nudojs/core": patch
---

`switch` statements and loop bodies now carry the facts that JavaScript
guarantees at those points.

- A `break` inside a `switch` arm — including inside an `if` inside the arm
  — was emitted as a `return`, which only ended the innermost thunk. The
  statements after it still ran. A `break` in an arm now ends the arm and
  the `switch`, and a `break` that belongs to an enclosing loop still ends
  only that loop.
- The test of a `case` was emitted like an ordinary argument, so every case
  test of the `switch` ran before the `switch` was entered, even after a
  case had already matched. The case tests are now evaluated in source
  order and stop at the matching one, and each test is evaluated exactly
  once. When the discriminant is abstract and no case can be selected, all
  case tests are still evaluated, so their side effects are not lost.
- A side effect in a case test was rolled back by the snapshot the arm
  restores, so `switch (1) { case t(1): n = n + 10; break; }` ended with
  `n = 10` instead of `n = 11`. The baseline is now refreshed after the
  case test, so the writes of the test survive while the arms stay
  isolated from each other.
- The head of a `for (var … of …)` or `for (var … in …)` was lowered to a
  callback parameter. That shadowed the function-level `var` binding, so
  reading it after the loop gave `undefined`, and every iteration created a
  new binding, so a closure captured the wrong value. The `var` head is now
  a function-level binding, shared by all iterations and still visible
  after the loop; `let` and `const` heads keep their per-iteration binding.
- `for (o.x of …)` and `for (o.x in …)` did not write the iteration value
  back to the member at all, so `o.x` kept its old value. The head target is
  now assigned on every iteration, like in JavaScript.
- The body of a `for`, `while` or `do-while` loop did not receive the facts
  of its own test. A `for (; x > 0; ) { return x; }` was judged to violate
  a contract of `number().gt(0)`, and `for (; v !== null; ) { return
  v.length; }` was reported as possibly throwing on `null`, even though
  JavaScript never throws there. The loop body now receives the nullish and
  the relational facts of the test, in all three loop forms. The first
  iteration of a `do-while` body is not narrowed, because it runs before the
  test is evaluated.
- A `break` or `continue` in the body of a `do-while` escaped the whole
  function, because the body was executed once outside the loop. The body
  now always runs inside the loop, so `break` ends the loop and `continue`
  goes to the test.
- A `case` label did not produce any narrowing fact, so the arm did not
  know which value it matched and the other arms did not know which values
  were excluded. `switch (x) { case 1: return x; default: return 2; }`
  violated a contract of `number().gt(0)`, and `switch (v) { case null:
  return 0; default: return v.length; }` was reported as possibly throwing
  on `null`. The arms now know the matched value and the excluded values.
