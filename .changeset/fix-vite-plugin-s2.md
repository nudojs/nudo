---
"vite-plugin-nudo": patch
---

The build plugin reads the project's L2 gate settings instead of ignoring them.

- `package.json#nudo.check.entryThrows` was ignored during a build: the
  plugin always applied the strictest level, so a project that had moved the
  gate to `"warning"` (or `"off"`) saw `nudo check` pass while `vite build`
  reported an error — and with `failOnError: true` the build was interrupted.
  The configured level is applied now, matching the CLI and the editor.

- `package.json#nudo.check.ignoreThrows` was ignored for the same reason: a
  throw class listed there was still reported as `nudo:entry-may-throw`.
  The listed classes are ignored now.
