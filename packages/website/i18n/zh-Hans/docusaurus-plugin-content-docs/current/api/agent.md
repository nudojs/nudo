---
sidebar_position: 5
description: "Agent API —— 语言服务器内的五个 nudo.* 命令：whatIf 类型假设、suggestCase 指令建议、trace、selectCase、getActiveCases。"
---

# Agent API

`@nudojs/lsp` 面向 agent 的 API 参考。全部五个 agent 命令都内置于 Nudo 语言服务器，通过标准的 `workspace/executeCommand` 调用或自定义 LSP 请求访问——不需要安装独立的服务器进程或协议。连接方式（LSP→MCP 桥、原生 LSP 客户端、VS Code）见 [Agent 集成指南](../guides/mcp-server.md)。

## 命令

| 命令 | 自定义请求别名 | 用途 |
|---------|---------------------|---------|
| `nudo.whatIf` | `nudo/whatIf` | 对绑定应用类型假设，读取目标的推断类型 |
| `nudo.suggestCase` | `nudo/suggestCase` | 检查函数的 `@nudo:case` 覆盖情况；用例全为合成时返回可直接粘贴的指令 |
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
| `bindings` | `Array<{ name: string, type: string }>` | 要应用的类型假设。`name` 必须是**顶层声明**（顶层 `const`/`let`/`var`、函数或类）——函数参数与局部变量没有可匹配的声明，会被回报为未应用。`type` 是类型表达式，如 `number` 或 `string \| null` |
| `target` | `string` | 要获取类型的顶层变量 |

**返回：** `{ content: [{ type: "text", text }] }`，其中 `text` 为 `Type of "<target>": <type>`——目标**在假设绑定之下**的推断类型；不是已知绑定时为 `unknown`。末尾的说明行回报哪些绑定生效了：`Bindings applied: …`；对没有顶层声明的名字则有 `Bindings not applied (no top-level declaration found): …`（此时答案使用文件自身的类型）。

**示例**——`src/config.js` 中有 `const size = raw.length`，`raw` 来自一个未知加载函数；假设 `raw` 是 `string`，询问 `size` 变成什么：

```javascript
const raw = loadRaw();
const size = raw.length;
```

```javascripton
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

## 类型表达式

`nudo.whatIf` 绑定的 `type` 字段接受基本类型或以 `|` 分隔的基本类型联合：

| 表达式 | 含义 |
|------------|---------|
| `number` \| `string` \| `boolean` | 对应的基本类型 |
| `null` \| `undefined` | 对应的单例类型 |
| `bigint` \| `symbol` | 其余基本类型 |
| `string \| null` | 联合——“string 或 null” |

已是 `T.*` 语法的形式与结构化表达式（对象/数组字面量、`=>` 函数）原样透传给指令文法（`parseTypeValueExpr`）；其他名字一律变为 `T.unknown`。

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
