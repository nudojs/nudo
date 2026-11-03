---
"@nudojs/lsp": minor
---

Feat: LSP rename scope-conflict detection + inlay any/unknown responsibility split.

- rename: the new name now goes through a scope-conflict check (`renameNameConflicts` in `symbols.ts`) on top of the existing syntax-level validation (Bug 750). A rename is rejected (`null`, no edits) when the new name would break the source: duplicate declaration in the target scope, outer capture (renaming `x` to an outer name referenced inside the target scope), inner-scope capture (a target reference sits inside a scope that declares the new name), duplicate member key within the same class/object owner, duplicate `#private` name, or duplicate export name. Plain cross-scope shadowing stays allowed. Cross-file renames re-run the check in the defining file's scope (import / re-export scenarios). Same philosophy as ambiguous-receiver rejection (Bug 712): refuse rather than break.
- inlay: return-position hints that render exactly `unknown` (= inference failure, engine debt) now carry a `⚠ ` label prefix and a tooltip naming the failure and the fix channels (`@nudo:mock` / `@nudo:env` / `@nudo:contract`); `any` (unconstrained param — developer responsibility) never gets the warning prefix, and its `where any()` tooltip gains a responsibility note while preserving the existing predicate expansion. The display contract is unchanged: unconstrained params still render `any`, never `unknown`.
