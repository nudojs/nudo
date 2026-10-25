---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
"nudojs": patch
---

Fix evaluator correctness and remove duplicated machinery:

- Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, and suppress undefined-literal narrowing facts when the name is bound.
- Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
- Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
- Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
- Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
- Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
