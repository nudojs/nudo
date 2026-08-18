---
sidebar_position: 5
---

# Agent API

`@nudojs/lsp` 面向 agent 的 API 参考。全部五个 agent 命令都内置于 Nudo 语言服务器，通过标准的 `workspace/executeCommand` 调用或自定义 LSP 请求访问——不需要安装独立的服务器进程或协议。连接方式（LSP→MCP 桥、原生 LSP 客户端、VS Code）见 [Agent 集成指南](../guides/mcp-server.md)。

## 命令

| 命令 | 自定义请求别名 | 用途 |
|---------|---------------------|---------|
| `nudo.whatIf` | `nudo/whatIf` | 对绑定应用类型假设，读取目标的推断类型 |
| `nudo.suggestCase` | `nudo/suggestCase` | 检查函数的 `@nudo:case` 覆盖情况 |
| `nudo.trace` | `nudo/trace` | 列出函数每个用例的参数类型 → 结果类型 |
| `nudo.selectCase` | `nudo/selectCase` | 切换用于悬停/诊断的活动用例 |
| `nudo.getActiveCases` | `nudo/getActiveCases` | 读取文件中每个函数的活动用例索引 |

`nudo.whatIf`、`nudo.suggestCase` 和 `nudo.trace` 返回 MCP 风格的文本内容——`{ content: [{ type: "text", text }] }`——结果可以直接进入 agent 工具链。`nudo.selectCase` 返回 `{ success: true }`；`nudo.getActiveCases` 返回 `Record<string, number>`。

## 约定

- **`file` 参数**——每个命令都接收字符串 `file`，接受 `file://` URI 或裸路径。未在编辑器中打开的文件从磁盘读取。
- **编辑器风格请求**——`nudo/selectCase` 与 `nudo/getActiveCases` 请求额外接受编辑器风格的 `{ uri, ... }` 参数（VS Code 扩展的 CodeLens 使用）。Agent 应始终使用 `file`。
- **类型表达式**——见下方[类型表达式](#类型表达式)。

---

## nudo.whatIf

设置类型假设并观察其他位置的推断类型——AI 驱动类型探索的主要工具。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `bindings` | `Array<{ name: string, type: string }>` | 要应用的类型假设。`name` 是变量名；`type` 是类型表达式，如 `number` 或 `string \| null` |
| `target` | `string` | 要获取类型的变量或表达式 |

**返回：** `{ content: [{ type: "text", text }] }`，其中 `text` 为 `Type of "<target>": <type>`——目标**在假设绑定之下**的推断类型；不是已知绑定时为 `unknown`。

**示例**——给定 `const y = Number(x.trim())`，假设 `x` 是 `string`，询问 `y` 变成什么：

```json
{
  "command": "nudo.whatIf",
  "arguments": [
    {
      "file": "src/app.js",
      "bindings": [{ "name": "x", "type": "string" }],
      "target": "y"
    }
  ]
}
```

```text
Type of "y": number
```

## nudo.suggestCase

根据函数的参数类型建议 `@nudo:case` 指令。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件的 `file://` URI 或路径 |
| `functionName` | `string` | 函数名 |

**返回：** `{ content: [{ type: "text", text }] }`，内容为以下三者之一：`Function "<functionName>" not found`、`Function "<functionName>" already has N case(s)`，或一行 `Suggested: /** @nudo:case */` 后跟 `function <functionName>(...) { ... }`。由于全程序推断会从调用点合成用例，已存在的函数通常报告其当前用例数。

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

## 类型表达式

`nudo.whatIf` 绑定的 `type` 字段接受基本类型或以 `|` 分隔的基本类型联合：

| 表达式 | 含义 |
|------------|---------|
| `number` \| `string` \| `boolean` | 对应的基本类型 |
| `null` \| `undefined` | 对应的单例类型 |
| `bigint` \| `symbol` | 其余基本类型 |
| `string \| null` | 联合——“string 或 null” |

## 诊断

类型错误（失败的 `@nudo:returns` 断言、不可达代码等）通过 LSP 诊断在两个方向可用：

- **推送**：每次分析后的 `textDocument/publishDiagnostics`
- **拉取**：按需的 `textDocument/diagnostic`

拉取模式天然适合 agent：打开（或指向）一个文件，发送 `textDocument/diagnostic`，读取 severity 为 1 的条目即可——无需调用命令。

## 从 MCP 服务器迁移

独立的 `@nudojs/mcp` 包已退役；其工具映射到上述命令：

| 旧 MCP 工具 | 替代方案 |
|--------------|-------------|
| `nudo-what-if` | `nudo.whatIf`——`bindings` 现在会真正生效（此前被忽略） |
| `nudo-check` | 通过 `textDocument/diagnostic` 拉取诊断 |
| `nudo-type-at` | `bindings` 为空、`target` 指定目标的 `nudo.whatIf`，或 LSP hover |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

连接层面的变化见指南的[从 MCP 服务器迁移](../guides/mcp-server.md#从-mcp-服务器迁移)一节。
