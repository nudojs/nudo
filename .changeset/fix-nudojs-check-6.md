---
"@nudojs/service": patch
"@nudojs/core": patch
"@nudojs/lsp": patch
---

The disk cache, the LSP and the Vite plugin now agree with the CLI about
environments, budgets and injected modules.

- The cache key did not contain the effective fork budget, so changing
  `NUDO_MAX_FORKS` still served the previous run's result. The effective
  value (environment variable, then `package.json`, then the default) is now
  part of the key.
- An invalid `nudo.check.entryThrows` value was reported once per checked
  file. The warning is now printed once per distinct invalid value.
- `@nudo:as` did not apply to an exported binding, so the tool still reported
  "bindings applied" while the type stayed unchanged. The override now
  matches the exported declaration as well.
- `--what-if` attached an assumption to the wrong variable when a line ended
  with a comment, and it reported a made-up reason when two declarations
  shared a line. Assumptions are now anchored by statement identity.
- The LSP and the Vite plugin never applied `@nudo:mock`, so a project that
  checked cleanly in the CLI reported a spurious "may throw" in the editor and
  in the build. Both now assemble the same injection channel the CLI uses.
