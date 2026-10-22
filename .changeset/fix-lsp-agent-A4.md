---
"@nudojs/lsp": patch
"@nudojs/service": patch
---

Fix agent-tool (LSP) defects found by the族 25 audit:

- **767** — `nudo/trace` / `nudo/suggestCase` failure paths now return `isError: true` (MCP-style), so a failed call is distinguishable from a successful one at the protocol level instead of only in the text.
- **768** — `nudo/hover` validates its position arguments: a non-integer `line` / `column` is a tool error (previously the value was echoed back with every analysis field `null`, so "no hover here" and "my argument was the wrong type" were indistinguishable), and `column` now defaults to `0` so the documented `{ file, line, column, … }` payload shape always holds.
- **961** — `nudo/whatIf` validates its arguments: a missing `target` is a tool error (previously a fake success reporting `Type of "undefined": unknown`), a non-array `bindings` is a diagnosable tool error (previously a raw `bindings.map is not a function`), and a binding without `name` is rejected instead of silently doing nothing. `injectBindings` in `@nudojs/service` gained the matching shape guard and names the offending entry (`<missing name>`).
- **993** — the observing agent tools (`nudo/whatIf`, `nudo/suggestCase`, `nudo/trace`) now analyse through the asynchronous entry point, which preloads path-based `@nudo:env` modules. Their output no longer depends on whether the file happens to be open in the editor (previously the same file and tool could answer `never`/`unknown` or `99` depending on call order, together with a misleading "Built-in API is not covered" diagnostic). The analysis caches additionally key on the env **preload state** so a synchronous analysis taken before the preload can no longer feed a stale "no env" result to later calls.
- **955 (shared entry)** — `normalizeFilePath` now rejects a non-string / empty / missing `file` with a diagnosable `file is required …` tool error instead of leaking a raw `file.startsWith is not a function` TypeError (or silently falling back to the server's working directory). Every agent tool goes through this shared entry point.
