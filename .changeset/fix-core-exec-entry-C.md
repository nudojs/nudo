---
"@nudojs/core": patch
---

Family 04 (core execution / entry), shard C — fixes for bugs 273, 274, 275,
276, 277, 280, 287 and 289.

- **Bug 273**: an `@nudo:mock <name>` whose name collided with a **module-level
  binding** made the whole file fail to evaluate. The env/mock injection
  unconditionally prepended `let <name> = …`, while the import rewrite emits
  `let <name> = …` for the same name, so `new Function` raised a
  `SyntaxError` (duplicate declaration). The file then degraded to
  fail-closed `unknown` and `nudo check` exited `0` — a green gate over a file
  that was never analysed. Injection now skips names that are already bound at
  module level (module-level binding wins), and a mock that targets an
  **imported** binding is applied by rewriting that import binding to read the
  mock value (the mock overrides the import), so `@nudo:mock` keeps working
  instead of being silently dropped.
- **Bug 274**: `@nudo:mock Math` / `JSON` / `Date` / `Promise` … were silently
  ignored. Mocks and env globals shared one injection table, and the merged
  key set was filtered with the **env-only** "do not shadow host intrinsics"
  skip list (`ENV_SHADOW_SKIP_GLOBALS`), so every mock whose name was on that
  list was dropped before injection — the user believed the mock was in effect
  while the host intrinsic answered. The skip list now applies to **env
  globals only**; mock keys are not filtered (a mock value is an `Abs` with no
  host object identity to preserve — shadowing the host global is the point of
  a mock).
- **Bug 275**: the optional `require` form (`try { d = require(a) } catch (e)
  { d = require(b) }`) missed the `cjsMain` branch, so a module shaped
  `module.exports = X` was returned as a **namespace** instead of `X` itself —
  the plain `require` and the optional `require` disagreed on the shape of the
  same module. Both paths now share one value resolution.
- **Bug 276**: `require()` of a module that cannot be resolved returned a plain
  `unknown` value instead of throwing, so the user's `catch` arm was dead code
  and the engine claimed "does not throw" — the `nudo:entry-may-throw` gate
  under-reported (a missing module was diagnosed as `nudo:module-missing` while
  the runtime said "no throw"). A missing module now throws a `NudoThrow`
  carrying an `Error` brand (same class as the native `MODULE_NOT_FOUND`), so
  the `catch` arm is live and an uncaught one is reported honestly. The
  **load-time** case (a `require` executed while the module body is still being
  evaluated) keeps the previous degradation: natively it means "the module
  cannot be loaded", and throwing there would fail the whole file closed
  (every export collapses to `unknown` ⇒ green gate over an unanalysed file);
  the missing module is still reported by the `nudo:module-missing` diagnostic.
- **Bug 277**: in a CommonJS module the top-level `this` was `undefined`
  instead of `module.exports`, so `this.x = v` always threw a `TypeError` and
  the whole module failed to evaluate (green gate over a file that was never
  analysed). The top-level `this` is now bound to the module's `exports` object
  (`=== module.exports`), so `this.x = v` is visible through `module.exports`
  exactly as in Node. ESM sources keep `undefined` (the native ESM semantics).
- **Bug 280**: `export const a = …, b = …` only exported `a` — the second
  declarator was missing from the export table, so `b` was not an export, its
  signature collapsed to `unknown` and cross-module imports of `b` were
  `unknown` as well. The transpiled output of a multi-declarator export is
  byte-identical to that of an independent declaration plus an independent
  export (the transpiler only prefixes the first declarator with `export `),
  so the remaining declarators are now recovered from the **source AST** and
  merged into the export-name set.
- **Bug 287**: the export-name recovery regexes used the ASCII-only `\w`, so
  any exported name containing `$` or a non-ASCII character was dropped
  entirely: the function was never analysed, its signature collapsed to
  `unknown` and a bogus `nudo:unknown-inference` was appended — the
  `nudo:entry-may-throw` gate went green on a file that did throw. The capture
  groups now accept JavaScript identifiers (`$`, `_`, Unicode), and the same
  pattern source is shared with the `export * as` rewrite.
- **Bug 289**: `export * as "<name>" from "…"` (the ES2022 arbitrary module
  namespace name) was not rewritten, so the statement leaked into the
  transpiled output, `new Function` raised a `SyntaxError` and the whole
  module failed to evaluate — every export was silently emptied and the L1 gate
  went green. The namespace re-export rewrite now accepts a string literal
  name in addition to an identifier.
