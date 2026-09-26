---
description: "Agent API —— 语言服务器内的 nudo.* 命令：check（Abs 门禁）、test、contract、hover、whatIf、suggestCase、trace、selectCase、getActiveCases。"
---

# Agent API

`@nudojs/lsp` 面向 agent 的 API 参考。全部 agent 命令都内置于 Nudo 语言服务器，通过标准的 `workspace/executeCommand` 调用或自定义 LSP 请求访问——不需要安装独立的服务器进程或协议。连接方式（LSP→MCP 桥、原生 LSP 客户端、VS Code）见 [Agent 集成指南](../guides/agent-integration.md)。

## 命令

| 命令 | 自定义请求别名 | 用途 |
|---------|---------------------|---------|
| `nudo.check` | `nudo/check` | 约束门禁 —— **CheckJson v1**（Abs 签名 + actual ⊭ expected） |
| `nudo.test` | `nudo/test` | 全文件推断 —— **CaseJson v1**（intension 携带无损 Abs） |
| `nudo.hover` | `nudo/hover` | 源码位置上的无损 Abs（可选 inlay / contract 分层） |
| `nudo.whatIf` | `nudo/whatIf` | 对绑定应用类型假设，读取目标的推断类型 |
| `nudo.suggestCase` | `nudo/suggestCase` | 检查函数的 `@nudo:case` 覆盖情况；用例全为合成时返回可直接粘贴的指令 |
| `nudo.trace` | `nudo/trace` | 列出函数每个用例的参数类型 → 结果类型 |
| `nudo.contract` | `nudo/contract` | 打印有效契约分层（handwritten / generated / implicit） |
| `nudo.contract.draft` | `nudo/contract.draft` | **代码优先草稿**：从已有逻辑生成 `*.nudo.draft.js` / `*.nudo.draft.ts`（与 CLI `--draft` 同源） |
| `nudo.contract.emit` | `nudo/contract.emit` | 把调用点域固化为侧车 `@generated` 段 |
| `nudo.selectCase` | `nudo/selectCase` | 切换用于悬停/诊断的活动用例 |
| `nudo.getActiveCases` | `nudo/getActiveCases` | 读取文件中每个函数的活动用例索引 |

`nudo.check` / `nudo.test` / `nudo.hover` / `nudo.whatIf` / `nudo.suggestCase` / `nudo.trace` / `nudo.contract*` 返回 MCP 风格的文本内容——`{ content: [{ type: "text", text }] }`。`nudo.selectCase` 返回 `{ success: true }`；`nudo.getActiveCases` 返回 `Record<string, number>`。共享数据源由 `AGENT_TOOL_SOURCES`（E5）钉住——agent 工具与 CLI/LSP 命令走同一 service/core 入口。

## 约定

- **`file` 参数**——每个命令都接收字符串 `file`，接受 `file://` URI 或裸路径。未在编辑器中打开的文件从磁盘读取。
- **编辑器风格请求**——`nudo/selectCase` 与 `nudo/getActiveCases` 请求额外接受编辑器风格的 `{ uri, ... }` 参数（VS Code 扩展的 CodeLens 使用）。Agent 应始终使用 `file`。
- **类型表达式**——见下方[类型表达式](#类型表达式)。
- **Abs 优先**——`check` / `test` / `hover` 暴露无损代数（Abs）。外延字符串（`args` / `result` / `ext`）是兼容用的有损投影，不是类型模型本身。

---

## nudo.check

在 **Abs**（类型即计算）上的约束门禁。契约与 CLI `nudo check --json` 一致。见 [nudo check](../guides/check.md)。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | `file://` URI 或路径 |
| `source` | `string?` | 预读源码（绕过磁盘/编辑器） |
| `format` | `"text" \| "json"` | `"json"` → 只返回 CheckJson；默认人类摘要 + JSON |

**返回（CheckJson v1）：** `{ version: 1, file, ok, summary, signatures[], issues[] }`，issue 可携带 `actual` / `expected`。Issue code：

| Code | 含义 |
|------|---------|
| `nudo:constraint-violated` | 调用/返回不满足显式契约 Pred（`actual ⊭ expected`） |
| `nudo:assign-mismatch` | 赋值 ⊭ 既有绑定形状 |
| `nudo:arg-structure` | HOF：实参不是可调用 fn / arity 不匹配 |

**`actions[]`（只增字段）。** 每条 `issues[]` 可携带结构化下一步。Agent 应优先消费 `actions[]`，不要解析 `suggestion` 散文：

| 字段 | 描述 |
|------|------|
| `actions[].kind` | `draft` \| `relax` \| `callsite` \| `assume` \| `mock` \| `emit` \| `ignore-throws` \| `info` |
| `actions[].command` | 可选的可执行命令（如 `nudo contract --draft`）；省略则只读 label/hint |
| `actions[].label` | 一行说明（与 `suggestion` 同源，通常更短） |
| `actions[].hint` | 可选：目标 Pred / 字段名等，供程序化改写 |

```json
{
  "command": "nudo.check",
  "arguments": [{ "file": "src/validators.js", "format": "json" }]
}
```

## nudo.test

全文件用例报告 —— 数据与 CLI `nudo test --json` 一致。CI 优先 CLI `nudo check` / `nudo test`；本工具名为遗留，映射到 test/check 观察面。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | 路径或 URI |
| `source` | `string?` | 预读源码 |
| `format` | `"text" \| "json"` | `"json"` → 只返回 CaseJson |
| `functions` | `string[]?` | 过滤到这些函数名 |

**返回（CaseJson v1）：** `cases[].intension` 携带 `abs` / `term` / `pred` / `conf`（无损）；`args` / `result` 是外延字符串（`formatShape` 投影）。

```json
{
  "command": "nudo.test",
  "arguments": [{ "file": "src/app.js", "functions": ["scale"], "format": "json" }]
}
```

## nudo.hover

位置上的无损 Abs —— 与编辑器 hover 同源，中间不经过投影。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | 路径或 URI |
| `line` | `number` | **1-based** 行号 |
| `column` | `number` | **0-based** 列号 |
| `source` | `string?` | 预读源码 |
| `includeInlays` | `boolean?` | 同时返回该文件全部 Abs inlay |

**返回 JSON：** `{ file, line, column, abs, absMultiline, intension, ext, inlays? }` —— `abs` 无损；`ext` 仅作对照用的外延投影。

## nudo.whatIf

设置类型假设并观察其他位置的推断类型——AI 驱动类型探索的主要工具。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `bindings` | `Array<{ name: string, type: string }>` | 要应用的类型假设。`name` 必须是**顶层声明**（顶层 `const`/`let`/`var`、函数或类）——函数参数与局部变量没有可匹配的声明，会被回报为未应用。`type` 是类型表达式，如 `number` 或 `string \| null` |
| `target` | `string` | 要获取类型的顶层变量 |

**返回：** `{ content: [{ type: "text", text }] }`，其中 `text` 为 `Type of "<target>": <type>`——目标**在假设绑定之下**的推断类型；不是已知绑定时为 `unknown`。末尾的说明行回报哪些绑定生效了：`Bindings applied: …`；对没有顶层声明的名字则有 `Bindings not applied (no top-level declaration found): …`（此时答案使用文件自身的类型）。

**示例**——`src/config.js` 中有 `const size = raw.length`，`raw` 来自一个未知加载函数；假设 `raw` 是 `string`，询问 `size` 变成什么：

```javascript
const raw = loadRaw();
const size = raw.length;
```

```json
{
  "command": "nudo.whatIf",
  "arguments": [
    {
      "file": "src/config.js",
      "bindings": [{ "name": "raw", "type": "string" }],
      "target": "size"
    }
  ]
}
```

```text
Type of "size": number
Bindings applied: raw: string
```

## nudo.suggestCase

根据函数的参数类型建议 `@nudo:case` 指令。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `functionName` | `string` | 函数名 |

**返回：** `{ content: [{ type: "text", text }] }`，内容为以下四种之一：

- `Function "<functionName>" not found` —— 文件中没有该函数。
- 一行 `Suggested: /** @nudo:case */` 后跟 `function <functionName>(...) { ... }` —— 函数完全没有用例（只有被推断跳过的函数才会零用例）。
- `Function "<functionName>" already has N case(s)` —— 函数已有手写（或 entry-only）的 `@nudo:case` 用例，保持不动。
- 全部用例都由调用点合成 —— 返回可直接粘贴到函数声明上方的指令文本，例如：

```text
Function "add" has 2 synthesized case(s); suggested directives:
/**
 * @nudo:case "call@L2" (1, 2)
 * @nudo:case "call@L3" ("x", "y")
*/
```

实参无法序列化为指令的用例（函数、Promise、实例等）会被丢弃，并在末尾追加一行 `(M case(s) skipped: not serializable as directives)`；若全部用例都不可序列化，则改回 `Function "<functionName>" already has N case(s) (none serializable as directives)`。

## nudo.trace

追踪类型在函数中从输入到输出的转换——每个用例一行。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `functionName` | `string` | 要追踪的函数 |

**返回：** `{ content: [{ type: "text", text }] }`，每个用例一行 `Input: (<参数类型>) => Output: <结果类型>`，或 `Function "<functionName>" not found` / `No cases found for "<functionName>"`。

## nudo.selectCase

切换函数的活动用例。活动用例决定悬停类型、诊断和内联提示，直到再次切换。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `functionName` | `string` | 函数名 |
| `caseIndex` | `number` | 要激活的用例索引（从 0 开始） |

**返回：** `{ success: true }`。服务器会以新的活动用例重新验证文档并刷新 CodeLens。

## nudo.getActiveCases

读取文件中每个函数的活动用例索引。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |

**返回：** `Record<string, number>`，函数名 → 活动用例索引，例如 `{ "parse": 1, "greet": 0 }`。

## nudo.contract / nudo.contract.draft / nudo.contract.emit

Interface 产品面（与 CLI 同一数据源）：

| 命令 | 参数 | 行为 |
|---------|------|----------|
| `nudo.contract` | `{ file, functionName?, source? }` | 打印 `fn  [handwritten\|generated\|implicit]  (params) → returns` + JSON |
| `nudo.contract.draft` | `{ file, functionName?, source?, write?, dryRun? }` | 代码优先草稿模块（`@nudo:draft`）；`write: true` 落盘 `*.nudo.draft.js` / `*.nudo.draft.ts`（从不碰 ambient 绑定）。body 读字段仅作**建议**。`write: true` **无项目根时 fail-closed**（nudo 配置 / `package.json` 祖先）——与 CLI `--draft --write` 同口径（覆盖：`NUDO_DRAFT_FORCE=1`） |
| `nudo.contract.emit` | `{ file, functionName, mode: "add"\|"update", dryRun?: boolean }` | 通过 `emitInterface` 固化调用点域。`dryRun: true` 只预览不写盘：返回同形结果（路径、would-change、unifiedDiff）与 `[dry-run] would update …` 文本；不会新建/修改侧车文件。VS Code Persist/CodeLens 确认流程先发 `dryRun: true`，确认后再真实写盘 |

`loadModule` 与有效 `autoBind` 由**服务端注入**（buffer-aware 侧车装载 + 项目 `package.json#nudo.contract.autoBind` AND 客户端请求）。它们不是可 JSON 序列化的请求参数——agent 不要发送。

手写契约永不被 draft 或 emit 覆盖。接受草稿时请将审阅过的导出拷入 `*.nudo.js` / `*.nudo.ts`。工具错误携带 `isError: true`。

## 类型表达式

`nudo.whatIf` 绑定的 `type` 字段接受基本类型或以 `|` 分隔的基本类型联合：

| 表达式 | 含义 |
|------------|---------|
| `number` \| `string` \| `boolean` | 对应的基本类型 |
| `null` \| `undefined` | 对应的单例类型 |
| `bigint` \| `symbol` | 其余基本类型 |
| `string \| null` | 联合——“string 或 null” |

约束构建器形式（`number()`、`lit(...)`、`shape({...})`、`union(...)`、`array(...)`）与结构化表达式（对象/数组字面量、`=>` 函数）透传给指令文法（`parseCaseArgExpr`）；其他名字一律变为 `unknown`。

## 诊断

类型错误（失败的 `@nudo:contract` 断言、不可达代码等）通过 LSP 诊断在两个方向可用：

- **推送**：每次分析后的 `textDocument/publishDiagnostics`
- **拉取**：按需的 `textDocument/diagnostic`

拉取模式天然适合 agent：打开（或指向）一个文件，发送 `textDocument/diagnostic`，读取 severity 为 1 的条目即可——无需调用命令。

## 从 MCP 服务器迁移

独立的 `@nudojs/mcp` 包已退役；其工具映射到上述命令：

| 旧 MCP 工具 | 替代方案 |
|--------------|-------------|
| `nudo-what-if` | `nudo.whatIf`——`bindings` 现在会真正生效（此前被忽略） |
| `nudo-check` | `nudo.check`（CheckJson v1，CI/agent 门禁首选）。pull 诊断现已含 Abs check + A3 过滤的 evaluator 诊断（打开 buffer），但不等价于全文件 CI 门禁 |
| `nudo-type-at` | `bindings` 为空、`target` 指定目标的 `nudo.whatIf`，或 LSP hover |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

连接层面的变化见指南的[从 MCP 服务器迁移](../guides/agent-integration.md#从-mcp-服务器迁移)一节。

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> 由 `pnpm run docs:gen:api` 从包导出面（`PUBLIC_API.md` / `src/index.ts`）生成 —— 请勿手改本块。重新生成：`node scripts/gen-api-docs.mjs`。

Agent 工具来自 `AGENT_TOOL_SOURCES`（`packages/lsp/src/agent-tools.ts`），与 `src/public-api.ts` 的 `nudo.*` executeCommand / `nudo/*` 请求名同源钉住。`codeLens` 仅服务端；`selectCase` / `getActiveCases` 是编辑器命令，不是 agent 工具。

| 名称 | 种类 | 说明 | 签名 |
|------|------|------|------|
| `check` | fn | nudo.check / `nudo/check` — checkSource + serializeCheckJson | `nudo.check \| nudo/check` |
| `codeLens` | fn | (server-only, no command) — computeInterfaceLenses + interfaceTierOf | — |
| `contract` | fn | nudo.contract / `nudo/contract` — interfaceSurface + formatInterfaceSurfaceLine | `nudo.contract \| nudo/contract` |
| `contract.draft` | fn | nudo.contract.draft / `nudo/contract.draft` — draftInterface + formatDraftSummary | `nudo.contract.draft \| nudo/contract.draft` |
| `contract.emit` | fn | nudo.contract.emit / `nudo/contract.emit` — emitInterface | `nudo.contract.emit \| nudo/contract.emit` |
| `getActiveCases` | fn | nudo.getActiveCases / `nudo/getActiveCases` — editor command (not an agent tool) | `nudo.getActiveCases \| nudo/getActiveCases` |
| `hover` | fn | nudo.hover / `nudo/hover` — getHoverAtPosition + interfaceTierOf | `nudo.hover \| nudo/hover` |
| `selectCase` | fn | nudo.selectCase / `nudo/selectCase` — editor command (not an agent tool) | `nudo.selectCase \| nudo/selectCase` |
| `suggestCase` | fn | nudo.suggestCase / `nudo/suggestCase` — analyzeFile + buildCaseDirective | `nudo.suggestCase \| nudo/suggestCase` |
| `test` | fn | nudo.test / `nudo/test` — analyzeFile + serializeCaseJson | `nudo.test \| nudo/test` |
| `trace` | fn | nudo.trace / `nudo/trace` — analyzeFile cases | `nudo.trace \| nudo/trace` |
| `whatIf` | fn | nudo.whatIf / `nudo/whatIf` — injectBindings + analyzeFile | `nudo.whatIf \| nudo/whatIf` |
<!-- NUDO-API-SKELETON:END -->
