---
"@nudojs/core": patch
---

Function-level `@nudo:` directives now bind to the right function again: a
statement-level JSDoc on a multi-declarator `const` binds to the first
declarator only, an inline JSDoc on an arrow initializer binds to the binding
name, a shadowing function no longer steals the exported function's
`@nudo:throws`, a `static` method and an instance method of the same name get
distinct directive scope names, and the CommonJS assignment form
(`exports.f = function`) keeps its directives.

- One JSDoc was bound to *every* declarator of a multi-declarator `const`. The
  statement-level comment was copied to each declarator's scope, so
  `const a = () => 1, b = () => 2` under `@nudo:case "shared"` produced the
  same witness twice — `nudo test` printed the case under `a` *and* under `b`.
  The statement-level JSDoc now binds to the first declarator only (the
  TypeScript ground truth); a later declarator keeps only its own inline
  comment.
- An inline JSDoc on an arrow initializer was registered under `<anonymous>`.
  The variable-declaration branch built a scope named after the variable but
  read the *statement's* leading comments, while the inline comment sits on the
  arrow node itself — so the witness landed on the `<anonymous>` scope and
  `nudo test` printed `=== <anonymous> ===`. A declared function now has exactly
  one scope, named after its binding, and both the statement-level and the
  inline comment are visible on it.
- A shadowing function stole the exported function's `@nudo:throws`. Directive
  scopes are looked up by name, and the first match in document order won, so an
  inner `f` inside another function took the comment block of the exported
  `f` — the exported `f` then inherited `@nudo:throws *` and the L2
  entry-may-throw gate stayed green while the function really threw. Scopes now
  carry their lexical nesting depth and a name lookup takes the shallowest
  match, which is the same function the analysis side registers.
- A `static` method and an instance method of the same name shared the
  directive scope name `C.m`. Only one `@nudo:contract` survived and it was
  applied to both methods, so the static method's contract was reported against
  the instance method (`nudo:interface-param-mismatch`). When a class has an
  instance method of the same name, the static method's scope is now named
  `C.static.m`; the instance method keeps `C.m`, matching the name-census
  surface, which registers only the instance method on a name collision.
- The CommonJS assignment form lost every function-level directive.
  `exports.f = function (x) { … }` has no binding name to take, so the scope
  was named `<anonymous>` and the lookup by the exported name `f` found
  nothing: the L1 contract silently did not apply (green gate), a
  `@nudo:throws` declaration did not suppress the L2 gate (red gate), and the
  `@nudo:case` witness evaporated entirely — with no diagnostic in any of the
  three cases. The CommonJS export slot (`exports.f`, `module.exports.f`,
  `module.exports`) is now used as the binding name, and the statement-level
  comment is attached to that scope.
