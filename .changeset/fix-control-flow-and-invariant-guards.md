---
"@nudojs/core": patch
---

Control flow and the loop invariants now carry the facts JavaScript
guarantees at those points.

- A `break` inside a `try` block was swallowed by the `catch` block: the
  body of the `catch` ran and the loop did not leave. A control flow
  signal is not an exception, so it is not delivered to a `catch` block
  now, and the loop leaves as it should.
- The write to the loop variable of a `for (let i …)` loop before a
  `continue` was dropped, so the loop ran a different number of times and
  produced a different result. The latest value of the loop variable is
  written back when the body is left, and the `continue` branch uses it.
- The invariant of a `@nudo:invariant` directive was silently dropped in
  a `while`, a `do..while` and a `for..of` loop, so a function could not
  prove what its own invariant promised. The invariant is applied when
  the loop is left now, in all loop forms.
- An invariant whose predicate contradicts the other facts was baked into
  the value, and a contradiction proved anything: a real violation of a
  contract was reported as proven. Contradictory facts are no longer
  merged, so a contradiction can no longer prove a violation away.
- The `switch` statement did not narrow the value in an arm, and the
  branch that was not taken did not narrow it either, so the code after
  the switch was analysed against a value that could never occur there.
  The arms now know the value they matched and the value they excluded.
- The facts of an early return did not reach the path that follows it, so
  `if (x <= 0) { return 1; } return x;` was reported as violating a
  contract that the equivalent `if`/`else` form satisfied. The path after
  an early return now knows the negation of the guard, in every block the
  early return is written in.
