---
"@nudojs/core": patch
"@nudojs/env": patch
---

Reading a member of a built-in prototype, a branded value or a namespace now
returns what JavaScript returns instead of a confident `undefined`.

- A built-in prototype object had no table for its own members, so
  `Map.prototype[Symbol.toStringTag]` returned `undefined` instead of `"Map"`,
  `RegExp.prototype.flags` returned `undefined` instead of `""` and
  `Error.prototype.name` returned `undefined` instead of `"Error"`. The
  prototype objects of the built-ins now carry their own symbol members,
  their own data properties and their own methods.
- A value of a built-in brand whose class was derived from a built-in — an
  instance of `class M extends Set` — lost the whole built-in prototype
  face: `s.add` returned `undefined` even though `"add" in s` said `true`.
  The two answers contradicted each other. The prototype chain is now
  resolved to the first built-in owner, and a member defined by the
  derived class still wins.
- `Object.prototype.toString.call(Math)` reported `[object Math]` but
  `Math[Symbol.toStringTag]` returned `undefined`. A namespace object now
  exposes its `Symbol.toStringTag`.
- `Symbol.prototype.description` returned the string `"undefined"` and did
  not record a throw; it now throws a `TypeError`, like the specification
  says.
- `Map.prototype.size` and `Set.prototype.size` returned `"undefined"` and
  did not record a throw; they now throw a `TypeError`.
- `Intl.NumberFormat.prototype.format` returned `undefined` and did not
  record a throw; reading a brand-check accessor of an `Intl` prototype now
  throws a `TypeError`.
- A member that does not exist on a `number`, `boolean` or `bigint` primitive
  folded to `unknown`, which made every later read of that value look
  harmless. It now folds to `undefined`, so the later read is still
  recognised as a possible `TypeError`.
- `Symbol()` instances resolved `toString` and `toLocaleString` to the
  matching members of `Object.prototype`, losing the brand check. The brand
  check is now performed.
- The `constructor` of a class value resolved to a built-in constructor
  named after the class, so `Widget.constructor === Function` was `false`.
  It is now `true`.
- A getter-only static accessor accepted a write; it now throws a `TypeError`
  in strict mode, like the instance-level accessors already did.
- The `prototype` property of a class value was missing its
  "not writable" flag, so `A.prototype = {}` silently wrote through. It is
  now rejected with a `TypeError`.
- `process.env` and `process.versions` were shown as
  `Record<string, string | undefined>` but reading `process.env.HOME`
  returned `unknown`, and the difference was reported as a failed
  inference. The read now uses the declared index domain.
- A host or namespace object such as `Math` only projected its enumerable
  own properties, so `Object.getOwnPropertyNames(Math)` returned `0` and
  `Math.PI` could not be read at all, even though the object was marked as
  exactly known. All own properties are projected now, and the descriptor
  flags are recorded, so the enumerable face still matches the original.
