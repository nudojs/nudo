---
"@nudojs/lsp": patch
"@nudojs/service": patch
---

族 25 收口接线（6 项）：把跨片耦合的缺口补上，并让文档与工具面说同一件事。

- **`testTool` 改异步入口**（Bug 993）：A4 把 `whatIf` / `suggestCase` / `trace`
  改成了 `analyzeFileAsync`（path 型 env 只能异步预载），但 `testTool` 属另一片
  的函数级边界 ⇒ 冷进程 `nudo/test` 首调仍是 env-less（`"unknown"` + 1 条误导
  诊断）。⇒ 改 `async` + `analyzeFileAsync`（**签名变更**：
  `AgentToolResult` → `Promise<AgentToolResult>`），同步调用点与既有测试。
- **`AGENT_TOOL_SOURCES` 值同步**：工具面真换了数据源，表与文档要跟着走 ——
  `check` → `checkSource + mergeCheckIssues + serializeCheckJson`、
  `test` → `analyzeFileAsync + buildTestReport + serializeCaseJson`；同步
  `packages/lsp/PUBLIC_API.md` §5、`packages/website/docs/api/agent.md` 与
  `AGENT_TOOL_SOURCES` 的值钉。
- **`nudo/contract.emit` 转发 `from`**（Bug 994）：三个 contract 工具已支持
  `--from` 等价通道，但协议入口 `makeHandleContractEmit` 只构造
  `{file, functionName, mode, dryRun?}` ⇒ **`from` 到不了 emit 工具** ⇒ 补
  入参类型 + 透传。
- **CJS 导出的 hover 面**（Bug 998）：`findFunctionNameAtPosition` 没有
  `MemberExpression` property 分支 ⇒ `module.exports.alpha = function () {}`
  的 hover 回退成无名 `(x) => ?`（诊断面认得它、hover 面不认 ⇒ IDE 内部
  自相矛盾）⇒ 补分支（祖父节点走 `path.parentPath.parent` —— Babel 的
  `node.parent` 不存在）。
- **失败面文档同步**：`selectCase` / `selectContract` / `getActiveCases` 的失败
  面统一为 `{ success: false, error, isError: true }` ⇒ 两份 API 文档的返回面
  记载同步；`nudo/contract.emit` 的 `from?: string[]` 参数也补进文档。
- **`pathEnvPreloadFingerprint` 的瞬时 ReferenceError**：族内 build 前
  `dist` 落后于 `src` 造成的一次性混用 ⇒ 随本族 build 消失（已连跑 5 次
  复现不出）。
