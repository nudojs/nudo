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

```typescript
import { createServer } from "@nudojs/mcp";

const server = createServer();
server.start();
```

## 工具

### nudo-what-if

设置类型假设并在其他位置观察推断类型。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `bindings` | `Array<{name: string, type: string}>` | 要应用的类型假设 |
| `target` | `string` | 要获取类型的变量或表达式 |

**返回：** 在给定假设下目标变量的类型。

### nudo-check

检查文件的类型错误和诊断。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |

**返回：** 找到的类型错误列表，或 "No type errors found"。

### nudo-type-at

获取文件中特定位置的推断类型。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `line` | `number` | 行号（从 1 开始） |
| `column` | `number` | 列号（从 0 开始） |

**返回：** 给定位置的推断类型，或 "unknown"。

### nudo-suggest-case

根据函数的参数类型建议 @nudo:case 指令。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `functionName` | `string` | 函数名 |

**返回：** 建议的 @nudo:case 指令或现有用例信息。

### nudo-trace

追踪类型在函数中从输入到输出的转换过程。

**参数：**

| 名称 | 类型 | 描述 |
|------|------|-------------|
| `file` | `string` | JavaScript 文件路径 |
| `functionName` | `string` | 要追踪的函数 |

**返回：** 每个用例从输入到输出的类型转换追踪。
