---
"@nudojs/lsp": patch
---

LSP: the workspace-folder subscription must never take the server down.

`connection.workspace.onDidChangeWorkspaceFolders` is a **getter** in
`vscode-languageserver@10.1.2` that throws
(`Client doesn't support sending workspace folder change events.`) unless the
client declared `capabilities.workspace.workspaceFolders` — and it only
becomes usable **after** `initialize`, when the library has processed the
client's capabilities. The server read that getter while it was still being
constructed, i.e. before any client had spoken, so the getter threw for
**every** client and the language server died on startup with

```
Error: Client doesn't support sending workspace folder change events.
    at get onDidChangeWorkspaceFolders (…/vscode-languageserver/lib/common/workspaceFolder.js:38:23)
    at createNudoServer (…/packages/lsp/src/server.ts:374:3)
```

The optional chaining (`?.`) did not help: it only guards `null` /
`undefined`, not a thrown exception.

The value is now read inside a `try`/`catch`; a client that does not
support the notification face makes the server skip the subscription
silently and start normally, and `initialize` still answers with the
unchanged server capabilities. The subscription itself is kept: it is taken
once at construction (in-memory connections) and, for a real transport, once
more right after `initialize` — where the getter is finally ready — so the
workspace-folder change handling (the authorization boundary follows the
added/removed folders) keeps working instead of being silently dropped by
the guard.
