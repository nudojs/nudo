---
"@nudojs/core": patch
---

Fix array mutator spread arguments (`f.push(...xs)`) folding to `$unknown()` and polluting the container element domain (issue #153):

- The array-mutator fast path in `transpile/stmt.ts` (statement position, identifier/member-path receivers) and the rebind lines of `emitArrMutatorRebinds` in `transpile/emit.ts` (expression position / nested mutators — the rebind line performs the *real* mutation, so the unknown argument landed in the container) now emit `...$elems(<expr>)`, the same flattening the ordinary call paths have used since DEC-006 K5. Generated code is a JS spread inside the args array literal, so `$elems`' returned `Abs[]` flattens element-wise into `$arrMutContainer`.
- Element precision restored: `const findings = []; findings.push(...check(x)); return findings` keeps the precise per-element tuple from `check` instead of `[unknown]`; mixed arguments keep order (`f.push(a, ...xs, b)`); spreading an abstract array joins its known element domain via the single representative; spreading a string pushes per code point, matching native `push(..."ab")` semantics.
