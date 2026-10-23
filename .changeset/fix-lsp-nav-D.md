---
"@nudojs/lsp": patch
---

LSP: three reverse guard tests for the navigation findings that no longer
reproduce.

This slice changes **no implementation code** — it only adds three regression
tests that pin the *already fixed* behaviour of the navigation face. The
symptoms described in the bug report do not reproduce on `HEAD`: they were
covered by an earlier family, and the tests below are the guard rails that
keep them from coming back (they are expected to **pass** on `HEAD`).

- **Bug 746 — renaming a local alias must not drag the exported symbol and
  the other importers along.** Renaming the local alias of
  `import { oldName as alias } from "./xf-def.js"` now edits only the local
  side of the import specifier and its call site; the defining module and
  the other importer stay untouched. The opposite direction is pinned as
  well: renaming the exported name from the defining module edits that
  module and the *imported* side of every importer, and leaves the alias
  alone. (Covered by the Bug 710 fix of the earlier signature family.)
- **Bug 747 — renaming a parameter must not drag the shadowing top-level
  variable along.** With `const x = 1;` next to `export function f(x)`, both
  directions are pinned: renaming the parameter edits only the parameter
  declaration and its use, renaming the top-level variable edits only that
  one place. `definition` and `references` stay scope-aware as well.
  (Covered by the Bug 709 fix of the earlier signature family.)
- **Bug 1025 — the *imported* side of an aliased import resolves to the
  module it really imports.** With two files exporting the same name, the
  `definition` of the imported side lands in the imported module instead of
  the unrelated same-named export, and its `references` are not the empty
  array the report saw — they are the same set the non-aliased form
  returns. The underlying key space of the import binding table (it is
  still keyed by the local name alone) is tracked as a residual item; the
  position-aware lookup currently covers it.
