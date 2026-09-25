# nudo-vscode

Thin VS Code / Cursor launcher for the Nudo language server.

On `activate`, the extension starts the bundled LSP (`server/server.js`, packed from `@nudojs/lsp` dist by `scripts/bundle-server.mjs`) over IPC via `vscode-languageclient`. The real analysis surface lives in [`@nudojs/lsp`](../lsp) — this package only wires the client, status bar, and commands.

Marketplace / Open VS X releases are cut from `main` (see `RELEASE_CHECKLIST.md`). Private package; not published to npm.
