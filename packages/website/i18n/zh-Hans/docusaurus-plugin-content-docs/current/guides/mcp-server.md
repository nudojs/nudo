---
sidebar_position: 6
---

# MCP 服务器（AI 代理集成）

`@nudojs/mcp` 包提供了一个 [Model Context Protocol](https://modelcontextprotocol.io/)（MCP）服务器，让 AI 编码代理——如 Claude Code、Cursor 和其他兼容 MCP 的工具——能够直接与 Nudo 的类型推断引擎交互。代理无需猜测 JavaScript 函数会产生什么类型，而是可以询问 Nudo 并获得由抽象解释推导出的精确答案。

## 什么是 MCP

Model Context Protocol 是一个开放标准，让 AI 助手能够通过统一接口连接外部工具和数据源。MCP 服务器暴露一组**工具**（AI 可调用的函数）和可选的**资源**（AI 可读取的数据）。Claude Code、Cursor 等客户端会自动发现并调用这些工具。

对 Nudo 而言，这意味着 AI 代理可以：

- 探索类型如何在函数中流动，而无需运行它
- 在编码工作流中检查文件的类型错误
- 建议和验证 `@nudo:` 指令
- 追踪从输入到输出的完整类型转换路径

这将类型推断从人工驱动的过程转变为 AI 代理可以使用的推理工具。

## 安装

```bash
pnpm add @nudojs/mcp
```

或全局安装：

```bash
pnpm add -g @nudojs/mcp
```

## 配置

### Claude Code

将 MCP 服务器添加到 Claude Code 配置中。运行以下命令：

```bash
claude mcp add nudo -- npx @nudojs/mcp
```

或手动添加到项目根目录的 `.mcp.json`：

```json
{
  "mcpServers": {
    "nudo": {
      "command": "npx",
      "args": ["@nudojs/mcp"]
    }
  }
}
```

### Cursor

在 Cursor 中，打开 Settings > MCP > Add new MCP server 并配置：

- **Name**: nudo
- **Type**: command
- **Command**: `npx @nudojs/mcp`

### 其他 MCP 客户端

任何支持 MCP 标准的客户端都可以连接到服务器。服务器通过 stdio 通信，除启动命令外不需要额外配置。

---

## 可用工具

Nudo MCP 服务器暴露五个工具。每个工具接受 JSON 参数并返回结构化文本输出。

### `nudo-what-if`

为函数参数设置类型假设，观察推断的返回类型。这是 AI 驱动类型探索的主要工具——它让代理可以问"如果这些输入具有这些类型，结果会是什么？"而无需修改任何源代码。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `function` | `string` | 是 | 要分析的函数名 |
| `assumptions` | `Record<string, string>` | 是 | 参数名到类型假设的映射 |

**示例场景**

你正在审查一个工具函数，想知道当一个参数为 `null` 时会发生什么：

```
Tool: nudo-what-if
{
  "file": "src/utils.js",
  "function": "formatUser",
  "assumptions": {
    "user": "null",
    "fallback": "\"anonymous\""
  }
}
```

**输出**

```
Assumptions:
  user: null
  fallback: "anonymous"

Inferred return type: "anonymous"

Type flow:
  user → null
  user.name → never (access on null)
  user?.name ?? fallback → "anonymous"
```

代理可以利用这个结果来推理空值安全、默认值和边界情况，而无需执行代码。

---

### `nudo-check`

使用 Nudo 的推断引擎检查 JavaScript 文件的类型错误。返回类似于 CLI 产出的诊断列表，但采用适合程序化消费的结构化格式。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | 要检查的 JavaScript 文件路径 |

**示例场景**

编辑文件后，让代理验证没有类型问题：

```
Tool: nudo-check
{
  "file": "src/parser.js"
}
```

**输出**

```
src/parser.js: no errors found.
```

或存在问题时：

```
src/parser.js:
  12:5 - Cannot access property "length" on type number
  24:10 - Type "hello" is not assignable to parameter of type number
```

---

### `nudo-type-at`

获取文件中特定位置的推断类型。当代理需要了解某个变量、表达式或返回值在特定行列的类型时非常有用。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `line` | `number` | 是 | 行号（从 1 开始） |
| `column` | `number` | 是 | 列号（从 1 开始） |

**示例场景**

代理试图了解经过一系列操作后 `result` 持有什么类型：

```
Tool: nudo-type-at
{
  "file": "src/transform.js",
  "line": 18,
  "column": 12
}
```

**输出**

```
Position: src/transform.js:18:12
Expression: result
Inferred type: string | number
```

---

### `nudo-suggest-case`

分析函数并建议能够覆盖其不同代码路径的 `@nudo:case` 指令。这有助于代理为类型推断生成有意义的测试输入。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `function` | `string` | 是 | 要分析的函数名 |

**示例场景**

代理正在帮助编写文档或测试，需要知道函数处理哪些类型的输入：

```
Tool: nudo-suggest-case
{
  "file": "src/validators.js",
  "function": "validateEmail"
}
```

**输出**

```
Suggested cases for validateEmail:

  @nudo:case "valid email" ("user@example.com")
  @nudo:case "empty string" ("")
  @nudo:case "missing @" ("userexample.com")
  @nudo:case "null input" (null)
  @nudo:case "undefined input" (undefined)

Each case exercises a distinct code path through the function.
```

代理随后可以将这些指令添加到文件中并运行推断，以验证函数在所有路径上的行为。

---

### `nudo-trace`

追踪类型在函数中从输入到输出的转换过程。显示类型计算的每个中间步骤，使完整数据流可追踪。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `function` | `string` | 是 | 要追踪的函数名 |

**示例场景**

代理需要理解一个复杂的转换管道：

```
Tool: nudo-trace
{
  "file": "src/transform.js",
  "function": "processData"
}
```

**输出**

```
Trace for processData:

  input: { raw: string, count: number }
  raw.split(",") -> string[]
  .map(s => s.trim()) -> string[]
  .filter(Boolean) -> string[]
  .slice(0, count) -> string[]

  Return type: string[]
```

这为代理提供了类型在每个操作处如何变化的逐步视图，对于调试类型不匹配和理解不熟悉的代码非常有价值。

---

## 为什么这对 AI 很重要

传统的 AI 辅助编码依赖于需要类型注解的静态分析工具，或者通过执行代码来观察行为。Nudo 的 MCP 服务器提供了第三条路径：**通过抽象解释的假设分析**。

当 AI 代理遇到不熟悉的 JavaScript 代码时，它可以：

1. **探索类型流** ——使用 `nudo-what-if` 测试不同的输入类型并观察它们如何传播，无需编写或运行任何代码。
2. **理解边界**——使用 `nudo-trace` 查看类型在函数中确切的收窄、拓宽或转换位置。
3. **验证变更**——使用 `nudo-check` 在提交前验证编辑是否引入了类型错误。
4. **生成测试用例**——使用 `nudo-suggest-case` 发现函数应处理的有趣输入场景。

这与事后运行 linter 或类型检查器有本质区别。代理可以交互式地查询类型系统，在单个对话轮次中形成和测试关于代码行为的假设。结果是更准确的代码变更，以及代理与开发者之间更少的来回交互。
