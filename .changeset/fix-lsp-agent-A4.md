---
"@nudojs/lsp": major
"@nudojs/service": patch
---

**BREAKING**: 既有 `nudo/…` 请求的**响应信封**变了。

- `nudo/trace` / `nudo/suggestCase` 的失败路径此前**不带** `isError: true`
  （失败被当成成功，客户端只能从正文分辨）⇒ 现在失败路径返回 `isError: true`
  （MCP 风格）⇒ 按「有没有 `isError`」分支的客户端行为变了；
- `nudo/hover` 现在**校验**位置参数：非整数 `line` / `column` 此前被原样回显
  且所有分析字段为 `null`（与「此处无 hover」不可区分），现在答**工具错误**；
  `column` 缺省为 `0` ⇒ `{ file, line, column, … }` 的载荷形状恒成立。

谁会坏：把失败响应当成功处理的客户端（`nudo/trace` / `nudo/suggestCase` 的失败
现在带 `isError: true`）；以及用非整数 `column` 调 `nudo/hover` 探测「此处有没有
东西」的客户端（现在拿到的是工具错误而不是一个全 `null` 的载荷）。

怎么迁移：客户端按 `isError` 分支处理失败；`nudo/hover` 只传整数 `line` /
`column`（`column` 缺省即 0）。

Fix agent-tool (LSP) defects found by the族 25 audit:

- **767** — `nudo/trace` / `nudo/suggestCase` failure paths now return `isError: true` (MCP-style), so a failed call is distinguishable from a successful one at the protocol level instead of only in the text.
- **768** — `nudo/hover` validates its position arguments: a non-integer `line` / `column` is a tool error (previously the value was echoed back with every analysis field `null`, so "no hover here" and "my argument was the wrong type" were indistinguishable), and `column` now defaults to `0` so the documented `{ file, line, column, … }` payload shape always holds.
- **961** — `nudo/whatIf` validates its arguments: a missing `target` is a tool error (previously a fake success reporting `Type of "undefined": unknown`), a non-array `bindings` is a diagnosable tool error (previously a raw `bindings.map is not a function`), and a binding without `name` is rejected instead of silently doing nothing. `injectBindings` in `@nudojs/service` gained the matching shape guard and names the offending entry (`<missing name>`).
- **993** — the observing agent tools (`nudo/whatIf`, `nudo/suggestCase`, `nudo/trace`) now analyse through the asynchronous entry point, which preloads path-based `@nudo:env` modules. Their output no longer depends on whether the file happens to be open in the editor (previously the same file and tool could answer `never`/`unknown` or `99` depending on call order, together with a misleading "Built-in API is not covered" diagnostic). The analysis caches additionally key on the env **preload state** so a synchronous analysis taken before the preload can no longer feed a stale "no env" result to later calls.
- **955 (shared entry)** — `normalizeFilePath` now rejects a non-string / empty / missing `file` with a diagnosable `file is required …` tool error instead of leaking a raw `file.startsWith is not a function` TypeError (or silently falling back to the server's working directory). Every agent tool goes through this shared entry point.
