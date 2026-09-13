---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/cli": minor
"@nudojs/lsp": minor
---

Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

- Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
- Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
- When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
- CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
- LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
- Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).
