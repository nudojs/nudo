---
"@nudojs/core": patch
---

Static fields now shadow inherited static methods, and calling a method that
does not exist on an array or a built-in object throws instead of silently
succeeding.

- A derived class that declares `static m = 2` now owns that member: `B.m`
  reads `2` and `B.m()` throws `TypeError`, like it does natively. The
  static-method lookup only consulted the method registry and walked the
  `super` chain, so the inherited `A.m()` was called instead and the
  own static field was ignored. The lookup now checks the class value's own
  static slots first, matching the native own-then-prototype order.
- Calling a method that does not exist on an array or on a built-in object
  (`[].missing()`, `new Map().missing()`) threw nothing and was not even
  recorded as a possible throw, so the L2 gate reported a false green. The
  missing-method check now covers arrays and built-in objects: both
  prototype surfaces are closed, so a name outside them is provably absent
  and the call throws `TypeError`, consistently with the class-instance
  branch.
