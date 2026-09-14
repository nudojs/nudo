# @nudojs/lsp

## 0.4.1

### Patch Changes

- 34b246c: Implement textDocument/documentSymbol and workspace/symbol; make definition, references, and rename follow relative imports across files so go-to-definition on an imported symbol lands in the defining module and rename/references include importer call sites.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/service@0.3.1
  - @nudojs/parser@0.3.1

## 0.4.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0
  - @nudojs/parser@0.3.0

## 0.3.0

### Minor Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.

### Patch Changes

- @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
  - @nudojs/service@0.1.0
