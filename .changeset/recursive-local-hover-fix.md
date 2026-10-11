---
"nudojs": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
---

Fix recursive-fn local hover poisoning and arity-only fn hover display

- `$nodoPos` position records and call/assign records now carry the caller-frame depth; hover replay surfaces (`absNodeAtPosition`, `collectEnclosingFnLocals`) only read outermost-frame records. Recursive functions on self-referential contracts (`lazy(() => astNode)`) no longer bind cycle-truncated `opaque unknown` into local-variable hovers (`obj` now shows the computed `null | string | undefined`).
- `const x = <non-call init>` declarations record the bound Abs at the declarator-id position during hover replay (`recordPositions` only) — ternary/optional-chain/literal-initialized locals are hoverable (`prop`, `q`).
- `callTranspiledExportFullInner` refines the called fn Abs `returnType` slot after a successful call (same policy as class method slots, display-only).
- LSP hover: an arity-only fn Abs (empty `returnType` slot) no longer preempts the generalize intension face; fn-name/callee hovers show the full contract signature `(node: nullable(astNode)) => null | string | undefined` instead of `(arg0) => ?`.
