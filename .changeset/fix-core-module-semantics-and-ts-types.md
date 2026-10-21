---
"@nudojs/core": patch
---

The engine keeps the module semantics and the declared types of a TypeScript
source.

- An import cycle made the first call inside the cycle return a wrong value
  and made the same export answer differently depending on the order of the
  calls. Live import bindings are refreshed when a call enters, not only after
  it returns, and the refresh registry no longer drops the bindings of a
  module that is still alive.
- A dependency that exists but cannot be read escaped the check as an
  uncaught error that killed the whole run. The read failure is classified
  (absent / unreadable) and reported as `nudo:module-unreadable`.
- The TypeScript type annotations of a source were removed before the
  analysis saw them, so every parameter of a `.ts` file was unconstrained
  and the file was reported as possibly throwing. The declared types are
  kept now, and a parameter declared `a: string` is analyzed as a string.
- An `export default function f() {}` was looked up under its local name and
  not found, because an ESM default export lives under `default`. The lookup
  falls back to the default slot now.
- A `module.exports = { f: fn }` export was not reachable by name, so the
  function's return type degraded to `unknown`.
- The type annotation of a rest parameter (`...rest: string[]`) was read from
  the wrong node and was always lost.
