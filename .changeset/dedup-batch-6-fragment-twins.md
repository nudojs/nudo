---
"@nudojs/core": patch
"@nudojs/env": patch
"@nudojs/lsp": patch
---

Dedup batch 6 (same-file fragment twins from the jscpd `--min-tokens 70`
audit; batch 5 closed the cross-file sync obligations and whole-function
twins). Pure refactor — outputs byte-identical (vitest --changed green,
verify:examples 251 checks, lint + lint:tests clean, defineEnv deep
structural dump parity vs HEAD for the env change).

- transpile `expr/optional-chain.ts`: `invoke` / `invokeKey` hop arms share
  the emission tail (contOf IIFE wrap, fnOptional double fork with
  Bug 187 whole-chain short-circuit + BUG-216 single-Get preRead,
  recvOptional short-circuit, bare tail) — extracted `emitInvokeTail`;
  the two arms now only define `callOf` (`$invoke` vs `$invokeKey`) and the
  method-value read (`$get` vs `$idx`). Emitted code text unchanged.
- `algebra/term.ts`: `surviveMulOne` / `surviveSubZero` verbatim-twin
  closures → shared `toNumberDomainTerm` (Bug 010 number-domain guard for
  x*1 / x-0 identities, bigint mixed-type preservation).
- `algebra/check.ts`: assume / invariant segment processing shares
  `anchorSurfaceOf` (#165 anchorable surface: contract formals ∪ AST params
  ∪ top-level locals); the two L2 entry-may-throw issue constructions
  (no-signature fallback vs generalized success) share
  `pushEntryMayThrowIssue` — only the `actual` line differs.
- transpile `stmt/statement.ts`: for-loop fallback path and init-declaration
  path share the body-prep block (`forBodyPrep`: body local decls → body
  opts with alias filtering → body statements → loop-carried assignment
  names); paths inject constScope shadowing and the initName exclusion.
  Emitted code text unchanged.
- `builtins/json.ts`: tuple and arrayView branches of the stringify walker
  share `mapElements` (index-keyed element mapping, abstract child folds to
  null with partial/unseen accounting, tuple holes).
- `builtins/object/methods.ts`: `Object.keys` / `Object.entries` string-
  literal receiver arms share `stringIndexTupleAbs` (code-unit indexing,
  exact conf; element construction injected).
- `algebra/promote-scan.ts`: ForOf's binding-window child walk and the
  generic tail walk share `walkChildren`.
- `arithmetic/muldiv.ts`: `div` / `mod` share the numeric leading
  (`divModLead`: builtin-brand ToPrimitive re-entry, Symbol TypeError,
  bigint fold + abstract-bigint domain with 0n RangeError per Bug 106);
  0-divisor semantics after the leading remain per-op.
- `env/src/node.ts`: the three verbatim MessagePort slot tables
  (MessageChannel.port1 / port2 / standalone MessagePort brand) single-
  sourced as `messagePortSlots` (same cross-brand sharing pattern as the
  existing `streamSlots`); defineEnv deep structural dump verified
  byte-identical vs HEAD.
- `lsp/src/symbols.ts`: `FunctionDeclaration` / `FunctionExpression`
  visitor bodies merged into a single `"FunctionDeclaration|FunctionExpression"`
  visitor key (babel traverse alias syntax), bodies were verbatim twins.
