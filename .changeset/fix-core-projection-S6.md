---
"@nudojs/core": patch
---

Regression pin for a `__proto__` object-slot projection defect that was
**already fixed** in an earlier release (family 17 / Bug 606) — this changeset
only adds the guard test, there is no behaviour change.

An object slot named `__proto__` used to be swallowed by the contract
projection layer: the field table was a plain object, so assigning the key hit
the `Object.prototype.__proto__` **prototype setter** instead of creating an own
property, and the key silently vanished from the projected shape (the zod
artefact lost the field). The rendering layer had the same hole.

Both are closed: the projected field table is now a **null-prototype** object,
and `formatObjectKey` writes `__proto__` as a **computed key**
(`["__proto__"]`), which is an ordinary own property.

The new pin locks that behaviour in place:

- `formatObjectKey("__proto__")` returns `["__proto__"]`, never a bare
  `__proto__` key.
- The projected field table has a `null` prototype and `__proto__` shows up as
  an **own** key (`Object.hasOwn`), so the prototype setter cannot swallow it.

One related residue is **not** fixed here and is filed separately: zod v4
assigns `["__proto__"]` back onto the parsed result through `[[Set]]`, which
triggers the prototype setter, so the **parsed** value still loses the key.
That is zod's own runtime behaviour, outside Nudo's projection and generation
responsibilities.
