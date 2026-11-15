# packages/lsp/src/__tests__/lsp-agent-tool.test.ts

模块套件：15 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"nudo/test：JSON 面是结构化 pathErrors（不是裸 errno 文本）"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。"	没测该层	keep	keep	—
"nudo/check：JSON 面是结构化 pathErrors"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。"	没测该层	keep	keep	—
"文本面：一行原因 + fix 提示（不再是裸 errno）"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。"	没测该层	keep	keep	—
"dot 形式同样是结构化信封"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。"	没测该层	keep	keep	—
"agentToolDeps = undefined（真 server 挂载后状态）时不抛且给出 action"	"钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。"	没测该层	keep	keep	—
"agentToolDeps = undefined 时侧车仍从磁盘读到（契约面可见）"	"契约里 u 的 shape 已有 name ⇒ 不下发「往契约 shape 补字段」的动作 （补了就是重复键）； 但**不得**因为 sidecar 读不到而崩。 钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。"	没测该层	keep	keep	—
"agentToolDeps 有 getOpenText 时读**编辑器打开缓冲**的侧车文本"	"打开缓冲里的侧车：u 的 shape **没有** name ⇒ 应当给出补字段动作 钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。"	没测该层	keep	keep	—
"文件未打开时 nudo/trace 也能看到 env 的全局（99，而非 unknown）"	"冷状态：没有任何 didOpen ⇒ env 未被预载 每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键， 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。"	夹具漏形态	keep	keep	—
"打开与否给出**同一个**答案（不随会话状态变）"	"每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键， 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。"	夹具漏形态	keep	keep	—
"同步面（nudo/test）先跑也不得把「无 env」的陈旧结果喂给后续异步调用"	"同步面先跑（冷状态）——它自身仍是同步入口（testTool 属 A1 分片） 随后的异步工具必须重新分析（env 已预载）而不是命中陈旧条目 每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键， 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。"	夹具漏形态	keep	keep	—
"trace / suggestCase 的「函数不存在」是失败（isError），成功面不带"	"对照组：成功面不得带 isError agent 工具的**失败路径**必须带 `isError: true` （协议层可与成功区分； 此前失败与成功同形，客户端只能解析文本猜）。"	没测该层	keep	keep	—
"nudo/whatIf / hover / trace / suggestCase：file 非字符串/空串/缺失 ⇒ isError"	"合法 file ⇒ 成功面（不得被共用入口误伤） 改前：`file: 42` ⇒ 裸 JS TypeError（`file.startsWith is not a function`） 当工具文案回给客户端； `file` 缺失 ⇒ 回落服务器 cwd（幽灵条目）。"	没测该层	keep	keep	—
"nudo/getActiveCases：file 非字符串 / 空串 / 缺失 ⇒ 结构化错误，不抛异常"	"改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。"	夹具漏形态	keep	keep	—
"nudo/contract.emit：file 非字符串 ⇒ isError 工具错误，不抛异常"	"改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。"	夹具漏形态	keep	keep	—
"nudo/selectCase：file 非字符串 ⇒ 结构化错误，不抛异常、不建 cwd 幽灵条目"	"file 缺失时不再回落服务器 cwd：该 uri 下没有活动档条目 改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。"	夹具漏形态	keep	keep	—
```
