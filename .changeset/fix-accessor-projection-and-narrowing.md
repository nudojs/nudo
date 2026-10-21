---
"@nudojs/core": patch
"@nudojs/service": patch
---

Accessors are now projected by what they actually return, repeated keys in
an object literal follow the last definition, and an early return narrows
the path that follows it.

- An accessor does not live in a shape slot: the transpiler writes a
  placeholder `undefined` slot to keep the key present and keeps the real
  getter in a side table. The read path consults the side table, so `o.ab`
  reads correctly, but the projection paths read the placeholder slot, so
  every object literal with a getter was projected as
  `{ ab: undefined }` — a confident wrong value, narrower than the truth
  and self-contradictory. The projection paths (shape formatting, guard
  derivation, constraint projection, contract proof) and the `.d.ts`
  generator now take the read domain of the getter: the getter is
  evaluated with the object as receiver, a getter that throws projects to
  `unknown`, and a data property keeps its slot value.
- A key that appears twice in an object literal kept the *first* accessor
  even when a data property came later, so `{ get x() {}, x: 2 }` was read
  through the getter and writing `o.x = 9` was reported as a definite
  `TypeError`. The last definition now wins, including its kind: a data
  property after an accessor replaces it, and an accessor after a data
  property replaces it too.
- The facts of an early return did not reach the path that follows it, so
  `if (x <= 0) { return 1; } return x;` violated a contract of
  `number().gt(0)` while the equivalent `if (x > 0) { return x; } else {
  return 1; }` passed. The path after an early return now knows the
  negation of the guard. The fact reaches the code after the early return
  whatever block the early return is written in — a bare block, a `try`
  block, a `catch` block or a `finally` block.
