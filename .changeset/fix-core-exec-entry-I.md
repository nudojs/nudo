---
"@nudojs/core": patch
"@nudojs/service": patch
---

Importing an environment module by its default name now infers the same type
as importing it as a namespace.

- `import fs from "node:fs"` bound to nothing, because the environment module
  table only carried the named exports and had no `default` slot. The import
  folded to `unknown`, every exported function of that file degraded to
  `unknown`, and the check reported a misleading `nudo:unknown-inference`
  warning (the binding was never connected; nothing failed to infer) while
  still exiting 0. Importing the very same module as `import * as fs from
  "node:fs"` was judged normally, so one import semantics produced two gate
  verdicts.
- Environment modules are CommonJS interoperability modules: Node's default
  export for `node:fs` is the module object itself, with the named exports on
  it. The environment module table now carries that `default` slot (the
  namespace of the module) and marks the module as an interoperability
  module, and the default-import binding has a single source of truth: the
  `default` slot when present, the namespace for an interoperability module
  that has no `default` slot, `unknown` otherwise.
- Ordinary user modules are untouched: a module table without a `default`
  slot still binds a default import to `unknown` rather than falling back to
  the namespace.
