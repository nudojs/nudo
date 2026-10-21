---
"@nudojs/service": patch
---

Quickfix edits: the `@nudo:throws` annotation now lands on the declaration it
belongs to, TS sidecars carry their builder import, and the nullish quickfix
no longer swallows a contract's `throws` obligation.

- **The `@nudo:throws` annotation was written into the wrong place, or into a
  file that no longer parsed.** The quickfix located the declaration by name
  (first line that matched) and then scanned *downwards* for the first line
  containing a JSDoc terminator. A plain block comment (`/* note *\/`) inside
  the function body carries the same terminator, so the bare tag was emitted
  outside of any comment and the file stopped being valid JavaScript. The
  declaration is now resolved through the AST (top-level declaration of that
  name — a same-named local binding inside another function no longer
  matches) and the tag is written inside the JSDoc block actually attached to
  the declaration; when there is none, a complete JSDoc block is inserted
  above the declaration.
- **Sidecars written for TypeScript sources did not compile.** `nudo check
  --fix --write` emitted the contract DSL (`fn({ x: shape({ toFixed: any() })
  })`) into a `*.nudo.ts` sidecar without any import: `fn` / `shape` were
  undeclared (`TS2304`) and `any()` collided with the TypeScript type keyword
  (`TS2693`), so the product failed `tsc --noEmit --strict`. TS sidecars now
  import the builders they use from `@nudojs/core`, renaming the ones that
  clash with a TypeScript type keyword, and the DSL is rewritten accordingly.
  JavaScript sidecars keep the existing "engine injects the builders" contract.
- **The nullish quickfix deleted the user's `throws` obligation.** The
  `nullable(...)` wrapper was applied to everything between the first top-level
  comma and the closing parenthesis of `fn(...)`, which swallowed the third
  argument (`{ throws: "Error" }`). The gate then reported a *different* error
  (`entry-may-throw` instead of `constraint-violated`) — a "fix" that traded
  one red for another. Only the return slot is wrapped now; the remaining
  arguments are preserved verbatim, and the edit is downgraded to a review
  when the engine cannot prove that the gate turns green.
