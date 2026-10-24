---
"@nudojs/core": patch
"@nudojs/service": patch
---

The generated products and the named imports of a module now agree with
each other.

- The schema product rendered the brand of a generator as
  `z.instanceof(GeneratorFunction)`, which made the generated module fail
  to load with a `ReferenceError`. The brands that are not globals are
  downgraded to `z.unknown()` and the loss is recorded, so the product can
  always be loaded.
- A named import of a function from an environment module wrapped the
  declared function in a JavaScript arrow function, which dropped the
  declared parameter and return types: the signature showed an invalid
  placeholder and the generated declaration file disagreed with it. The
  named import now yields the declared function itself, so both import
  forms report the same type. The function is still callable: a call and a
  `new` both dispatch to it.
