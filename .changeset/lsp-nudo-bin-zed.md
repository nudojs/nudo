---
"@nudojs/lsp": minor
---

Add a `nudo-lsp` bin (shebang on `dist/server.js`) and default to stdio when the host did not pass a transport flag (`--stdio` / `--node-ipc` / `--socket=`). Editors and agent bridges can launch the server as a bare command (`nudo-lsp`, `node dist/server.js`) instead of `tsx` + `src/server.ts`. The [Zed extension](https://github.com/nudojs/nudo-zed) uses this path.
