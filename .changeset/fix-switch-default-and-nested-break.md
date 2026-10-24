---
"@nudojs/core": patch
---

Two `switch` defects are fixed: a `default` that follows an empty `case`
no longer runs its body twice, and a `break` inside a loop nested in a
`switch` arm breaks the loop again.

- In `case 1: default: body` the default's statements are shared between
  the case arm (which falls through into them) and the default arm (which
  runs them when nothing matches). The fall-through merge appended them a
  second time, so the body ran twice in one arm — `switchDefaultAfterEmptyCase()`
  folded `"dd"` instead of `"d"` and side effects were doubled.

- The "inside a switch arm" marker was carried into nested loops, so an
  unlabelled `break` inside such a loop was lowered as "end of arm" instead
  of "end of loop": the loop ran to completion (`f() => 3` instead of `1`).
  Loop bodies no longer inherit the marker.
