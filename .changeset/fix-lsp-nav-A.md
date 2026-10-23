---
"@nudojs/lsp": patch
---

LSP navigation now agrees with itself: method and `catch` parameters have a
definition, private class members keep their own identity, and renaming an
aliased export renames the export instead of the local binding.

- `textDocument/definition` returned `null` for a **class method parameter**, an
  **object method parameter**, and a **`catch` parameter**, while
  `textDocument/references` at the very same position returned the
  declaration. The symbol table only visited the parameters of three kinds of
  function, so those parameters never became definitions and the definition
  lookup fell through to a workspace fallback that found nothing. The symbol
  table now visits class methods, object methods, private methods, private
  fields, and `catch` clauses; a `catch` parameter is scoped to the `catch`
  clause itself.
- A **private class member** (`#name`) was resolved as if it were the ordinary
  identifier `name`, so `definition`, `references`, and `rename` all landed on
  an unrelated binding with the same name — renaming a private method rewrote
  an unrelated exported symbol and its importers across files, breaking the
  module graph. A private member now has its own identity (`#name`), scoped to
  the class that declares it; `prepareRename` reports the placeholder with the
  `#`, and the edited range still covers only the identifier so the `#` is
  kept.
- An **aliased export** (`export { a as b }`) packed two identities into one
  specifier: the local name `a` and the exported name `b`. Renaming through an
  importer collected the edit set by the local name, so it rewrote the local
  declaration and the local side of the export specifier while the importers
  were renamed to a name the module no longer exported — the module graph broke
  even though both files stayed syntactically valid. The local name and the
  exported name are now separate identities: renaming the exported name edits
  the exported side of the specifier together with the `imported` side of every
  importer, and never the local declaration; renaming the local name edits the
  local declaration and the local side of the specifier only. The exported-name
  position is no longer a dead end: `definition`, `references`,
  `prepareRename`, and `rename` all answer there.
