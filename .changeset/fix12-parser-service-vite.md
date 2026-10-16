---
"@nudojs/parser": patch
"@nudojs/service": minor
"vite-plugin-nudo": patch
---

Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).

- parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
- service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
- vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.
