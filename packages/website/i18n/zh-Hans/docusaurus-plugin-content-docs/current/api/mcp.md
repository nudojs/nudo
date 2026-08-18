---
sidebar_position: 5
---

# @nudojs/mcp

Nudo MCP 服务器包的 API 参考。此包将 Nudo 的类型推断能力暴露为 MCP 工具，使 AI 助手能够查询类型信息和诊断。

## 安装

```bash
pnpm add @nudojs/mcp
```

## 服务器配置

`@nudojs/mcp` 是一个开箱即用的 stdio 服务器。它的入口点创建 MCP 服务器、注册全部五个工具并通过 stdio 连接——没有可导入的 `createServer()` 之类的编程式 API：

```typescript
// 包入口（src/index.ts）
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

const server = new McpServer({ name: "nudo", version: "0.1.0" });
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

使用时，将 MCP 客户端配置为通过 stdio 启动服务器。Claude Code、Cursor 及通用客户端的配置见 [MCP 服务器指南](../guides/mcp-server.md)。

## 工具

### nudo-what-if

设置类型假设并在其他位置观察推断类型。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `bindings` | `Array<{ name: string, type: string }>` | 要应用的类型假设。`name` 是变量名；`type` 是类型表达式，如 `number` 或 `string \| null` |
| `target` | `string` | 要获取类型的变量或表达式 |

**返回：** `Type of "<target>": <type>`——目标的推断类型；不是已知绑定时为 `unknown`。类型来自对文件本身的分析；`bindings` 假设不会覆盖它。

### nudo-check

检查文件的类型错误和诊断。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |

**返回：** 每条 error 级诊断一行 `Line N: message`（例如失败的 `@nudo:returns` 断言）；没有错误时为 `No type errors found`。

### nudo-type-at

获取文件中特定位置的推断类型。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `line` | `number` | 行号（从 1 开始） |
| `column` | `number` | 列号（从 0 开始） |

**返回：** 给定位置的推断类型，或 `unknown`。

### nudo-suggest-case

根据函数的参数类型建议 @nudo:case 指令。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `functionName` | `string` | 函数名 |

**返回：** 以下三者之一：`Function "<functionName>" not found`、`Function "<functionName>" already has N case(s)`，或一行 `Suggested: /** @nudo:case */` 后跟 `function <functionName>(...) { ... }`。

### nudo-trace

追踪类型在函数中从输入到输出的转换过程。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `functionName` | `string` | 要追踪的函数 |

**返回：** 每个用例一行 `Input: (<参数类型>) => Output: <结果类型>`，或 `Function "<functionName>" not found` / `No cases found for "<functionName>"`。
