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
- 查询函数的 `@nudo:` 用例覆盖情况
- 追踪每个用例的输入如何映射到输出

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

Nudo MCP 服务器暴露五个工具。每个工具接受 JSON 参数并返回文本输出。

下面的示例共用一个文件 `src/config.js`：

```js
const config = { retries: 3, label: "fast" };

// @nudo:case "greeting" ("Ada")
// @nudo:case "anonymous" ("")
function greet(name) {
  return "Hello, " + name;
}
```

### `nudo-what-if`

设置类型假设并在其他位置观察推断类型。这是 AI 驱动类型探索的主要工具——它让代理可以问"如果 X 具有 Y 类型，Z 会是什么？"而无需修改任何源代码。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `bindings` | `Array<{ name: string, type: string }>` | 是 | 要应用的类型假设。`name` 是变量名；`type` 是类型表达式，如 `number` 或 `string \| null` |
| `target` | `string` | 是 | 要获取类型的变量或表达式 |

**示例场景**

代理准备在其他地方使用 `config` 对象，想先确认它的推断形状：

```json
{
  "file": "src/config.js",
  "bindings": [
    { "name": "config", "type": "{ retries: number, label: string }" }
  ],
  "target": "config"
}
```

**输出**

```
Type of "config": { retries: 3, label: "fast" }
```

响应始终为 `Type of "<target>": <type>` 的形式。如果 target 不是文件中的已知绑定，类型报告为 `unknown`。注意：当前实现返回的类型来自对文件本身的分析——`bindings` 假设不会覆盖它。

---

### `nudo-check`

使用 Nudo 的推断引擎检查 JavaScript 文件的类型错误。只返回 error 级别的诊断——目前来自失败的 `@nudo:` 断言，例如与推断返回类型不符的 `@nudo:returns` 声明。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | 要检查的 JavaScript 文件路径 |

**示例场景**

编辑文件后，让代理验证没有类型问题：

```json
{ "file": "src/config.js" }
```

**输出**

```
No type errors found
```

存在错误时，每条错误独占一行，格式为 `Line N: message`。给定下面这个 `@nudo:returns` 断言与推断结果矛盾的文件：

```js
// @nudo:case "double it" (5)
// @nudo:returns (T.string)
function double(x) {
  return x * 2;
}
```

响应为：

```
Line 3: @nudo:returns assertion failed for case "double it": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation
```

---

### `nudo-type-at`

获取文件中特定位置的推断类型。当代理需要了解某个变量或表达式在特定行列的类型时非常有用。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `line` | `number` | 是 | 行号（从 1 开始） |
| `column` | `number` | 是 | 列号（从 0 开始） |

**示例场景**

代理想获取 `src/config.js` 中 `config` 变量的类型。变量名从第 1 行第 6 列开始：

```json
{ "file": "src/config.js", "line": 1, "column": 6 }
```

**输出**

```
{ retries: 3, label: "fast" }
```

响应为该位置的推断类型；该位置没有类型信息时为 `unknown`。

---

### `nudo-suggest-case`

根据函数的参数类型建议 `@nudo:case` 指令。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `functionName` | `string` | 是 | 函数名 |

**示例场景**

代理正在为 `src/config.js` 编写文档，想检查 `greet` 的 `@nudo:case` 覆盖情况：

```json
{ "file": "src/config.js", "functionName": "greet" }
```

**输出**

```
Function "greet" already has 2 case(s)
```

由于全程序推断会为没有指令的函数合成用例，已存在的函数通常报告其当前用例数。其他可能的响应：函数名不存在时为 `Function "<functionName>" not found`；完全没有用例的函数则返回一行 `Suggested: /** @nudo:case */`，后跟 `function <functionName>(...) { ... }`。

---

### `nudo-trace`

追踪类型在函数中从输入到输出的转换——每个用例一行，显示参数类型和结果类型。

**参数**

| 参数 | 类型 | 必需 | 描述 |
|-----------|------|----------|-------------|
| `file` | `string` | 是 | JavaScript 文件路径 |
| `functionName` | `string` | 是 | 要追踪的函数 |

**示例场景**

代理需要理解 `greet` 如何转换其输入：

```json
{ "file": "src/config.js", "functionName": "greet" }
```

**输出**

```
Input: ("Ada") => Output: "Hello, Ada"
Input: ("") => Output: "Hello, "
```

每行的格式为 `Input: (<参数类型>) => Output: <结果类型>`。函数不存在时响应为 `Function "<functionName>" not found`；没有用例时响应为 `No cases found for "<functionName>"`。

---

## 为什么这对 AI 很重要

传统的 AI 辅助编码依赖于需要类型注解的静态分析工具，或者通过执行代码来观察行为。Nudo 的 MCP 服务器提供了第三条路径：**按需获取由抽象解释推导的类型信息**。

当 AI 代理遇到不熟悉的 JavaScript 代码时，它可以：

1. **查询推断类型**——使用 `nudo-what-if` 和 `nudo-type-at` 获取绑定或源代码位置的精确推断类型，无需编写或运行任何代码。
2. **理解函数行为**——使用 `nudo-trace` 查看每个用例的参数类型如何映射到结果类型。
3. **验证变更**——使用 `nudo-check` 在提交前捕获 error 级诊断，例如失败的 `@nudo:returns` 断言。
4. **检查用例覆盖**——使用 `nudo-suggest-case` 查看函数当前有多少用例，在覆盖不足处补充指令。

这与事后运行 linter 或类型检查器有本质区别。代理可以交互式地查询类型系统，在单个对话轮次中形成和测试关于代码行为的假设。结果是更准确的代码变更，以及代理与开发者之间更少的来回交互。
