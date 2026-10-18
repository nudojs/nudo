---
"@nudojs/core": patch
---

Fix a 5.5x yargs regression from the Bug 116 strict seam: guard shadow
rebinding emitted the **guarded identifier** as an arrow parameter
(`((arguments) => THUNK)(…)` for `if (arguments.length === 0)` style
discriminant/nullish/typeof/rel guards), and `arguments`/`eval` are
illegal binding names in strict code — the whole module body then died
at `new Function` compile time with "Unexpected eval or arguments in
strict mode", fail-closed to empty exports, and since failed evals are
never memoized every analysis re-transpiled the file (yargs check
5952ms → 1161ms after the fix). Guard names that cannot be bound in
strict mode now skip the narrowing wrapper entirely (same all-or-nothing
skip as fork-binding collisions — narrowing is a precision gain, not a
semantic obligation). The `"use strict"` prefix itself is now scoped to
sources with ESM syntax (`sourceHasEsmSyntax`: static `import` / any
`export` statement ⇒ definitely ESM); sources without it follow Node's
`.js`-without-`type:"module"` default and stay CommonJS/sloppy, so
sloppy-legal constructs (implicit global writes, `arguments` bindings)
no longer miscompile in CJS files. Docs: the levenshtein
`@nudo:invariant` example splits its L2 expectation
(`--ignore-throws RangeError`, mirroring the engine test suite) for the
legitimate `Array.from` array-like-length may-throw.
