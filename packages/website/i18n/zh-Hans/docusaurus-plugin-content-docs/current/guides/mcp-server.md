---
sidebar_position: 6
---

# Agent 集成指南

AI 编码代理——Claude Code、Cursor、Copilot、Zed 等——通过 Nudo 的**语言服务器** [`@nudojs/lsp`](../api/lsp.md) 访问推断能力。驱动 VS Code 扩展的同一个服务器，同时通过标准的 `workspace/executeCommand` 调用暴露五个 agent 命令，外加拉取式诊断。不需要安装或维持独立的 MCP 服务器进程：一个服务器同时服务编辑器*和* agent。

完整的命令参考（参数、返回形状、类型表达式语法）见 [Agent API](../api/agent.md) 页面。面向 agent 的现成 skill 文件发布在 [`packages/lsp/agent-skill/SKILL.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/agent-skill/SKILL.md)。

## 安装

```bash
npm i -g @nudojs/lsp
```

服务器通过 stdio 讲 LSP。用 Node 启动（类型剥离需要 Node ≥ 22.18；更老的 Node 用 `tsx`）：

```bash
node "$(npm root -g)/@nudojs/lsp/src/server.ts"
# 或在项目本地安装、任意 Node 版本：
npx tsx node_modules/@nudojs/lsp/src/server.ts
```

## 三种接入方式

### 方式一：LSP→MCP 桥

如果你的 agent 只讲 MCP，运行一个通用桥，把 Nudo 注册为 `.js` 文件的语言服务器。三个桥均可直接使用：

**[cclsp](https://github.com/ktnyt/cclsp)** —— 在项目旁配置 `cclsp.json`：

```json
{
  "extensions": ["js", "mjs", "cjs"],
  "command": ["npx", "tsx", "node_modules/@nudojs/lsp/src/server.ts"],
  "rootDir": "."
}
```

然后把桥加入 MCP 客户端：

```bash
claude mcp add cclsp -- npx cclsp@latest --env CCLSP_CONFIG_PATH=/abs/path/to/cclsp.json
```

**[mcpls](https://github.com/bug-ops/mcpls)** —— 配置 `mcpls.toml`：

```toml
[[lsp_servers]]
language_id = "javascript"
command = "node"
args = ["node_modules/@nudojs/lsp/src/server.ts"]
file_patterns = ["**/*.js", "**/*.mjs"]
```

**[agent-lsp](https://github.com/blackwell-systems/agent-lsp)** —— 运行 `agent-lsp init`；它会自动探测 `PATH` 上的语言服务器并替你写好 MCP 客户端配置，把多个服务器编排成 agent 原生的工作流。

:::note
各桥转发的能力不同。标准 LSP 功能（hover、诊断、定义跳转）总会透传；如果某个桥没有把 `workspace/executeCommand` 转发到 Nudo 的五个命令，请改用方式二。
:::

### 方式二：原生 LSP 客户端

任何 LSP 客户端库（`vscode-languageserver-protocol`、各类语言的原生 LSP 客户端、手写 stdio 客户端）都可以。启动服务器、`initialize`，然后调用 `workspace/executeCommand`——线上消息就是普通 JSON-RPC，可以逐字发送：

```jsonc
// 1. 握手
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":"file:///home/you/project","capabilities":{}}}
{"jsonrpc":"2.0","method":"initialized","params":{}}

// 2. 提一个 what-if 问题
{"jsonrpc":"2.0","id":2,"method":"workspace/executeCommand","params":{
  "command": "nudo.whatIf",
  "arguments": [{ "file": "src/app.js", "bindings": [{ "name": "x", "type": "string" }], "target": "y" }]
}}
```

`file` 参数接受 `file://` URI 或裸路径。未在编辑器中打开的文件直接从磁盘读取——不需要 `didOpen`。

### 方式三：VS Code / Cursor 扩展

安装 `nudo-vscode` 扩展后，本指南的一切都已接好：扩展会启动 `@nudojs/lsp`，编辑器内的 agent 通过同一服务器获得悬停类型、诊断和用例切换 CodeLens。

## 五个命令

每个示例都是完整的 `workspace/executeCommand` 载荷——复制、改路径、直接发送。共用示例文件 `src/app.js`：

```js
function normalize(x) {
  const trimmed = x.trim();
  return Number(trimmed);
}
```

**`nudo.whatIf`** —— 假设 `x` 是 string，询问 `trimmed` 变成什么：

```json
{ "command": "nudo.whatIf", "arguments": [{
    "file": "src/app.js",
    "bindings": [{ "name": "x", "type": "string" }],
    "target": "trimmed"
}] }
```

```text
Type of "trimmed": string
```

**`nudo.trace`** —— 列出每个用例的输入和输出：

```json
{ "command": "nudo.trace", "arguments": [{ "file": "src/app.js", "functionName": "normalize" }] }
```

**`nudo.suggestCase`** —— 检查 `@nudo:case` 覆盖情况：

```json
{ "command": "nudo.suggestCase", "arguments": [{ "file": "src/app.js", "functionName": "normalize" }] }
```

当函数的用例全部由调用点合成时，返回可直接粘贴到函数声明上方的指令文本——例如以 `(1, 2)` 和 `("x", "y")` 调用过的 `add(a, b)`：

```text
Function "add" has 2 synthesized case(s); suggested directives:
/**
 * @nudo:case "call@L2" (1, 2)
 * @nudo:case "call@L3" ("x", "y")
*/
```

已有手写用例的函数则返回 `Function "<name>" already has N case(s)`；其余返回情形见 [Agent API](../api/agent.md#nudosuggestcase) 页面。

**`nudo.selectCase`** —— 把函数固定到一个用例（悬停与诊断随之切换，直到再次切换）：

```json
{ "command": "nudo.selectCase", "arguments": [{ "file": "src/app.js", "functionName": "normalize", "caseIndex": 0 }] }
```

**`nudo.getActiveCases`** —— 读取每个函数的活动用例：

```json
{ "command": "nudo.getActiveCases", "arguments": [{ "file": "src/app.js" }] }
```

`whatIf`、`trace`、`suggestCase` 返回 `{ content: [{ type: "text", text }] }`——MCP 风格文本内容；`selectCase` 返回 `{ success: true }`；`getActiveCases` 返回 `Record<string, number>`。

## 拉取诊断

旧 `nudo-check` 工具由标准的 LSP 拉取请求取代：

```json
{"jsonrpc":"2.0","id":3,"method":"textDocument/diagnostic","params":{"textDocument":{"uri":"file:///home/you/project/src/app.js"}}}
```

error 级条目（失败的 `@nudo:returns` 断言、不可达代码等）在 `items` 中返回，`source: "nudo"`。如果你的客户端偏好推送，`textDocument/publishDiagnostics` 也会发出。

## 从 MCP 服务器迁移

独立的 `@nudojs/mcp` 包已退役——其能力已并入 `@nudojs/lsp`。迁移步骤：

1. **移除 MCP 注册** —— 从 `.mcp.json` / 客户端 MCP 配置中删除 `nudo` 条目；已安装的话执行 `npm rm @nudojs/mcp`。
2. **安装并连接语言服务器** —— 按[安装](#安装)一节和上面三种方式之一操作。
3. **重新映射旧工具：**

| 旧 MCP 工具 | 新等价物 |
|--------------|----------------|
| `nudo-what-if` | `nudo.whatIf`——且 `bindings` 现在会真正生效（旧服务器忽略它们） |
| `nudo-check` | `textDocument/diagnostic` 拉取请求 |
| `nudo-type-at` | 指定 `target`（`bindings` 留空）的 `nudo.whatIf`，或 LSP hover |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

需要注意一个行为升级：`nudo.whatIf` 的回答会反映假设的 `bindings`——旧服务器返回的是文件自身的分析结果并静默丢弃假设。依赖旧行为的提示词或流水线需要相应调整。
