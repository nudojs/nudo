---
"@nudojs/core": patch
---

`Object.prototype.toString` now tells an async function from a
generator.

`Object.prototype.toString.call(async function () {})` was
`"[object Function]"` for every function shape. The label now follows
the language:

- `function () {}` → `"[object Function]"`
- `async function () {}` → `"[object AsyncFunction]"`
- `function* () {}` → `"[object GeneratorFunction]"`
- `async function* () {}` → `"[object AsyncGeneratorFunction]"`

The same holds for a method shorthand (`{ async m() {} }.m`), for a
class method (`class A { async m() {} }` → `A.prototype.m`) and for a
static class method.

A function *declaration* (`export async function f() {}`) still reports
`"[object Function]"`: the declared function is a host function, and
the engine cannot recover the kind from it.
