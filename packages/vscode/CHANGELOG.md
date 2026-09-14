# nudo-vscode

## Unreleased

- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.

## 0.3.0

### Minor Changes

- Ship the B-path engine line with the monorepo 0.3 packages (`@nudojs/*` 0.3 / `@nudojs/lsp` 0.4): faster incremental analysis, Abs module graph, and LSP hover via Abs node tables.

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version
