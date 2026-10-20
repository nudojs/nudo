---
"@nudojs/core": patch
---

Accessors now see `arguments`, and a string method whose pattern is a free
identifier no longer breaks the module.

- A getter or setter is an ordinary function, so `arguments` exists in it
  (length 0 for a getter, 1 for a setter). The accessor body was emitted
  without the `arguments` slot, so reading `arguments` inside an accessor
  threw a `ReferenceError` instead of returning `0`. Accessors now carry the
  slot like every other function body.
- `String.prototype.match` / `replace` / `replaceAll` emitted a state
  write-back that assigned to the pattern argument, whatever it was. With
  `eval` or `arguments` as the pattern the generated module was not valid
  strict-mode JavaScript, so the whole module failed to load; with
  `undefined` it threw a `TypeError` out of nowhere. The regular expression
  state is now updated in place, so no assignment is generated at all, and
  a pattern that is not a regular expression is converted with the
  `RegExpCreate` / `ToString` rules instead of being reported as throwing.
