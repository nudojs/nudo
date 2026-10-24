---
"@nudojs/core": patch
"@nudojs/parser": patch
---

File-level `@nudo:` directives no longer evaporate in silence: the mock-module
payload grammar accepts single quotes, the env payload grammar accepts
space-separated lists, block-comment `@nudo:import` is ignored instead of
taking effect, and an empty `@nudo:import` payload is diagnosed.

- `@nudo:mock-module 'axios' from './mocks/v-axios.js'` was silently dropped.
  The two payload regexes hard-coded double quotes, so a single-quoted payload
  matched neither and the directive returned `undefined`. The mock was never
  installed, no diagnostic was raised, and the gate stayed green. Single
  quotes are now accepted (the source and the path may even use different
  quote kinds), and an unparsable payload now raises `nudo:directive-syntax`
  instead of vanishing.
- `@nudo:env node web` was silently dropped. The payload was split on commas
  only, so a space-separated list became a single token and was filtered out;
  a bare `/// @nudo:env` tag did not even match the tag regex. Both forms
  were discarded with no diagnostic, so no environment was loaded and
  everything stayed `unknown`. Commas and whitespace are now both accepted
  (trailing comments are stripped), and a bare tag raises
  `nudo:directive-syntax`.
- `@nudo:import` inside a block comment took effect. The text scanner
  flattened line comments and block comments into one list and dropped the
  comment kind, so a block-comment import really loaded its sidecar — the
  opposite of `@nudo:env` / `@nudo:mock-module`, which the AST channel ignores
  in block comments. Comment kinds are now kept apart: line comments take
  effect, block comments are ignored and warned about.
- `/// @nudo:import` with an empty payload was silently discarded. The payload
  was dropped before the malformed-import scanner could see it, so the
  malformed form had no diagnostic while other unrecognised forms of the same
  directive did. The empty payload is now reported as a malformed import and
  raises `nudo:contract-syntax`.
