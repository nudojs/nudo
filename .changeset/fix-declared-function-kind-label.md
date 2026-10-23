---
"@nudojs/core": patch
---

`Object.prototype.toString` now reports the right label for functions that
are declared with `async` or `*`.

- `export async function f() {}` used to report `[object Function]`, and so
  did `export function* f() {}` and `export async function* f() {}`. A
  function declared with `async` or `*` is compiled to a plain host
  function, so the kind could not be recovered from the host value the way
  it is for a function expression, an arrow function, or a method.
- The declaration site now records the kind explicitly, and
  `Object.prototype.toString.call(f)` reports `[object AsyncFunction]`,
  `[object GeneratorFunction]`, and `[object AsyncGeneratorFunction]`
  respectively — the same labels the other declaration forms already
  produced.
- The kind is recorded before the declaration, so a function that is called
  before its declaration — function declarations are hoisted — still gets
  the right label.
