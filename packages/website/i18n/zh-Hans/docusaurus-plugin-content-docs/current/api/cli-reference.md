---
sidebar_position: 4
---

# CLI 参考

`nudo` CLI 对使用 `@nudo:*` 指令的 JavaScript 文件运行类型推断。可全局安装或通过 `npx` 运行：

```bash
pnpm add -g @nudojs/cli
# 或
npx @nudojs/cli infer ./src/utils.js
```

---

## 命令

### nudo infer

从 JavaScript 文件推断类型。

```bash
nudo infer <file> [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<file>` | `.js` 文件路径（相对或绝对） |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--dts` | 在源文件旁生成 `.d.ts` 声明文件 |
| `--loc` | 在输出中显示源码位置（`file:line:column`） |
| `--json` | 以结构化 JSON 输出结果 |

**输出格式：**

- 每个带有 `@nudo:case` 指令的函数一个区块
- 每个用例：`Case "name": (arg1, arg2, ...) => result`
- 用例可能抛出时显示 `throws type`
- 多个用例时：组合类型显示为 `Combined: type`
- 使用 `--dts`：在同一目录写入 `<basename>.d.ts`

**示例：**

```bash
nudo infer math.js
```

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

```bash
nudo infer math.js --dts --loc
```

```
=== subtract (math.js:12:1) ===

Case "positive numbers": (5, 3) => 2
...

Generated: math.d.ts
```

**JSON 输出（`--json`）：**

```bash
nudo infer math.js --json
```

```json
{
  "functions": [
    {
      "name": "subtract",
      "loc": { "start": { "line": 5, "column": 0 }, "end": { "line": 7, "column": 1 } },
      "cases": [
        { "name": "positive numbers", "args": ["5", "3"], "result": "2", "throws": null },
        { "name": "symbolic", "args": ["number", "number"], "result": "number", "throws": null }
      ]
    }
  ],
  "diagnostics": []
}
```

---

### nudo generate

从推断类型生成运行时验证器。

```bash
nudo generate <file> [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<file>` | `.js` 文件路径（相对或绝对） |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--format <format>` | 输出格式：`zod`、`guard`、`dts`、`all`（默认：`all`） |
| `--output <dir>` | 输出目录（默认：`.`） |

**输出格式：**

- **`zod`** ——每个函数用例的 Zod schema 字符串（输入和输出）
- **`guard`** ——零依赖的运行时类型守卫函数
- **`dts`** ——带真实参数名和 JSDoc 的 TypeScript 声明文件
- **`all`** ——以上所有格式

**示例：**

```bash
nudo generate src/utils.js --format zod
```

```
// === parseUser Zod Schemas ===
// Case "string-input":
// Input: { arg0: z.string() }
// Output: z.object({ name: z.string(), age: z.number() })
```

---

### nudo watch

监视文件或目录，在变更时重新运行推断。

```bash
nudo watch <path> [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<path>` | 要监视的文件或目录 |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--dts` | 每次运行都生成 `.d.ts` 文件 |

**行为：**

- **文件：** 监视该文件及其所在目录
- **目录：** 递归监视，排除 `node_modules`
- **文件过滤：** 仅处理包含 Nudo 指令的 `.js` 文件
- **防抖：** 200ms 防抖以合并快速编辑
- 每次运行会清空并重新打印输出

**示例：**

```bash
nudo watch .
nudo watch src/utils.js --dts
```

---

## 文件模式

- **输入：** 仅 `.js` 文件（通过 Babel 解析 TypeScript/JSX）
- **Nudo 文件：** 包含 `@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample` 或 `@nudo:returns` 的文件
- **监视模式：** 在目录中仅分析 Nudo 文件

---

## 退出码

| 码值 | 含义 |
|------|---------|
| `0` | 成功 |
| 非零 | 解析错误、文件缺失或其他致命错误 |

注意：类型推断错误（如 `@nudo:returns` 失败）会打印到 stderr，但不会改变退出码。
