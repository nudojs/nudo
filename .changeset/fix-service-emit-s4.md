---
"@nudojs/service": patch
---

The Standard Schema face now enforces what its own type says, and its
`validate` never throws.

- A fixed-length tuple was only checked element by element, so
  `pairOutput.validate([1, "two", 3])` passed even though the exported type
  is the 2-tuple `[1, "two"]` — the engine (`leqAbs`) and the zod face
  (`z.tuple`) both reject it. The tuple arm now requires the array length
  to match the element count, unless the tuple has a `rest` slot.
- The two copies of the validator disagreed: the library version walked
  arrays with `forEach` (which skips holes) while the generated module used
  an index loop (which reads a hole as `undefined`), so the same schema and
  the same sparse array got opposite verdicts. Both copies now use the
  index loop, matching the zod face and the engine, which both read a hole
  as `undefined`.
- A `brand` node was accepted unconditionally, so `mkDateOutput.validate({})`
  passed while the zod face of the same export (`z.instanceof(Date)`)
  rejected it. A brand whose name is a runtime global constructor is now
  checked with `instanceof` (no import needed, the product stays
  importable); brands with no runtime criterion (user classes) are still
  passed through, and the projection already records them as dropped.
- A `fn` node was accepted unconditionally, so a function-typed output
  validator passed `42` / `null` / `"str"` / `{}` while the zod face
  (`z.function()`) rejected all of them. A `fn` node now requires the value
  to be a function (the signature is not checked).
- A required slot was only considered present when it was an *own*
  property, so a value carrying the key on its prototype
  (`Object.create({ c: 1 })`) was reported as missing — stricter than the
  zod face and than the TypeScript structural type, which both accept it.
  Key presence now follows `HasProperty` semantics, minus the
  `Object.prototype` pollution keys (`toString`, `constructor`, …).
- `~standard.validate` threw a `TypeError` on a `bigint` or a circular
  object, because the issue message was built with `JSON.stringify` on the
  runtime input. Standard Schema v1 requires `validate` to *return* a
  result, so the message is now built with a safe description
  (`1n`, `<unserializable>`) and any error is reported as an issue instead
  of escaping.
- The issue message no longer loses non-finite numbers: `Infinity` is
  reported as `expected Infinity, got 0` instead of `expected null, got
  null`, matching the zod, guard and `nudo check` faces.
