---
"@nudojs/lsp": major
---

**BREAKING**: LSP **协议契约**变了（`packages/lsp/PUBLIC_API.md` 这份**冻结清单**
本版本同步更新）。

- `nudo.selectCase` / `nudo.selectContract` 的失败面此前是 `{"success": true}`
  （对不存在的函数、对空调用都答成功）⇒ 现在答
  `{ success: false, error, isError: true }`；
- `workspace/executeCommand` 上的**未知命令名**此前答 `result: null`（与
  「命令跑了但没产出」不可区分）⇒ 现在答协议级 `MethodNotFound` 错误。

谁会坏：按 `success` 分支处理 `nudo.selectCase` / `nudo.selectContract` 的客户端
（失败路径的 `success` 现在是 `false`）；以及靠 `result === null` 判「命令不存在」
的客户端（现在收到的是 JSON-RPC 错误）。

怎么迁移：客户端按 `{ success: false, error, isError: true }` 处理失败；用
JSON-RPC 错误码判「命令不存在」（`MethodNotFound`）。

The LSP editor commands now tell the truth: a selection that did not happen
is reported as a failure, and the mirrors a selection touches are refreshed
together.

- `nudo.selectCase` validates its arguments before touching the active-case
  table. A `caseIndex` outside the function's `@nudo:case` list used to be
  accepted: `-1` crashed the analysis (`Cannot read properties of undefined
  (reading 'argsAbs')` in the diagnostics) and `99` silently replaced the
  observation slot. A `functionName` that is not a function of the target
  file used to be stored as-is, so `nudo.getActiveCases` reported ghost
  entries such as `{"":0}`. Both now return a structured error and leave the
  table untouched.
- `nudo.selectContract` validates that the target function exists in the
  file. It used to answer `{"success":true}` for a function that was never
  there (and for a call without any arguments at all), so the client could not
  tell a real switch from a no-op.
- A selection refreshes the inlay hints and the pull diagnostics as well as
  the code lenses. Only the code lenses were refreshed, so a client without
  code lens support kept showing the previous case, and a pull-diagnostics
  client never saw the diagnostics of the newly selected case.
- `file` / `uri` arguments must be non-empty strings. A non-string `file` used
  to escape as a bare `TypeError` (`file.startsWith is not a function`), which
  reached the client as a JSON-RPC protocol error instead of a tool error
  carrying `isError: true`; a missing `file` silently fell back to the
  server's working directory.
- An unknown command name on `workspace/executeCommand` now fails with the
  protocol-level `MethodNotFound` error instead of answering with a `null`
  result, which was indistinguishable from "the command ran and produced
  nothing".
