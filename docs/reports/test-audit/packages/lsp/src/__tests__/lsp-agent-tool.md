# packages/lsp/src/__tests__/lsp-agent-tool.test.ts

模块套件：agent tool 面（路径错误/deps 懒加载/env 预载/error flag/文件校验）。

审计：15 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"nudo/test：JSON 面是结构化 pathErrors（不是裸 errno 文本）"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。 断言：expect(r.isError).toBe(true);；expect(json.pathErrors).toBeTruthy();"	没测该层	keep	keep	—
"nudo/check：JSON 面是结构化 pathErrors"	"LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道** ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有 `nudo:path-not-found` 码、没有 suggestion）； 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`）， 且 `format:\"json\"` 必须真的返回 JSON。 断言：expect(r.isError).toBe(true);；expect(json.ok).toBe(false);"	没测该层	keep	keep	—
"文本面：一行原因 + fix 提示（不再是裸 errno）"	"断言：expect(r.isError).toBe(true);；expect(text).toContain(\"Not found:\");"	没测该层	keep	keep	—
"dot 形式同样是结构化信封"	"断言：expect(r.isError).toBe(true);；expect(json.pathErrors[0].code).toBe(\"nudo:path-not-found\");"	没测该层	keep	keep	—
"agentToolDeps = undefined（真 server 挂载后状态）时不抛且给出 action"	"钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。 断言：expect(() => {；expect(Array.isArray(actions)).toBe(true);"	没测该层	keep	keep	—
"agentToolDeps = undefined 时侧车仍从磁盘读到（契约面可见）"	"钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。 断言：expect(titles.some((t) => t.includes(\"contract shape\"))).toBe(false);"	没测该层	keep	keep	—
"agentToolDeps 有 getOpenText 时读**编辑器打开缓冲**的侧车文本"	"钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛， 且必须给出可用 action。 断言：expect(titles.some((t) => t === \"Add 'name' to greet contract shape\")).toBe(true);"	没测该层	keep	keep	—
"文件未打开时 nudo/trace 也能看到 env 的全局（99，而非 unknown）"	"每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键， 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。 断言：expect(cold.content[0].text).toContain(\"99\");；expect(cold.content[0].text).not.toContain(\"unknown\");"	夹具漏形态	keep	keep	—
"打开与否给出**同一个**答案（不随会话状态变）"	"断言：expect(before.content[0].text).toBe(after.content[0].text);；expect(after.content[0].text).toContain(\"99\");"	没测该层	keep	keep	—
"同步面（nudo/test）先跑也不得把「无 env」的陈旧结果喂给后续异步调用"	"每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键， 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。 断言：expect(traced.content[0].text).toContain(\"99\");"	夹具漏形态	keep	keep	—
"trace / suggestCase 的「函数不存在」是失败（isError），成功面不带"	"agent 工具的**失败路径**必须带 `isError: true` （协议层可与成功区分； 此前失败与成功同形，客户端只能解析文本猜）。 断言：expect(missingTrace.isError).toBe(true);；expect(missingTrace.content[0].text).toContain('Function \"nope\" not found');"	没测该层	keep	keep	—
"nudo/whatIf / hover / trace / suggestCase：file 非字符串/空串/缺失 ⇒ isError"	"改前：`file: 42` ⇒ 裸 JS TypeError（`file.startsWith is not a function`） 当工具文案回给客户端； `file` 缺失 ⇒ 回落服务器 cwd（幽灵条目）。 断言：expect(result, `${method} file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();；expect(result.isError, `${method} file=${JSON.stringify(bad)} 应当 isError`).toBe(true);"	没测该层	keep	keep	—
"nudo/getActiveCases：file 非字符串 / 空串 / 缺失 ⇒ 结构化错误，不抛异常"	"改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。 断言：expect(result, `file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();；expect(result.success).toBe(false);"	夹具漏形态	keep	keep	—
"nudo/contract.emit：file 非字符串 ⇒ isError 工具错误，不抛异常"	"改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。 断言：expect(result.isError).toBe(true);；expect(result.content[0].text).toContain(\"file is required\");"	夹具漏形态	keep	keep	—
"nudo/selectCase：file 非字符串 ⇒ 结构化错误，不抛异常、不建 cwd 幽灵条目"	"改前：file=42（非字符串）→ 裸 TypeError（\"file.startsWith is not a function\"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具 错误； file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。 断言：expect(result.success).toBe(false);；expect(result.isError).toBe(true);"	夹具漏形态	keep	keep	—
```
