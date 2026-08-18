---
sidebar_position: 4
---

# CLI 参考

`nudo` CLI 对 JavaScript 文件运行类型推断。可全局安装或通过 `npx` 运行：

```bash
pnpm add -g @nudojs/cli
# 或
npx @nudojs/cli infer ./src/utils.js
```

---

## 命令

### nudo infer

从单个 JavaScript 文件推断类型。

```bash
nudo infer <file> [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<file>` | `.js` 文件路径（相对或绝对）。传目录会报 `EISDIR` 错误——目录请用 `nudo watch` |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--dts` | 在源文件旁生成 `.d.ts` 声明文件 |
| `--loc` | 在输出中显示源码位置（`file:line:column`） |
| `--json` | 以结构化 JSON 输出结果 |
| `--callsites <paths...>` | 使用处文件或目录（测试/应用），从中挖掘真实调用形状；它们对本文件导出的调用会合成为 `call@L` 用例——参见[调用点发现](/docs/guides/callsite-discovery) |

**输出格式：**

- 每个函数一个区块（`=== 名称 ===`）；来自导入模块的函数显示在 `--- 路径 (imported) ---` 标头下
- 每个用例：`Case "name": (arg1, arg2, ...) => result`
- 没有 `@nudo:case` 指令的函数同样会有用例：观察到的调用合成为 `call@L` 用例；没有调用时产出带 `unknown` 参数的 `entry@L` 用例并附 `# no call sites found` 注释
- 用例可能抛出时显示 `throws type`
- 多个用例时：组合类型显示为 `Combined: type`——字面量成员会保留（如 `2 | -9 | number`）
- 有诊断时，末尾输出 `Diagnostics:` 区块，条目格式为 `[severity] 路径:行:列 消息 (错误码)`
- 使用 `--dts`：在同一目录写入 `<basename>.d.ts` 并打印 `Generated: <basename>.d.ts`

**示例：**

```bash
nudo infer math.js
```

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

```bash
nudo infer math.js --dts --loc
```

```
=== subtract (math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number

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
      "loc": {
        "start": {
          "line": 6,
          "column": 0
        },
        "end": {
          "line": 8,
          "column": 1
        }
      },
      "cases": [
        {
          "name": "positive numbers",
          "args": [
            "5",
            "3"
          ],
          "result": "2",
          "throws": null,
          "source": null
        },
        {
          "name": "negative result",
          "args": [
            "1",
            "10"
          ],
          "result": "-9",
          "throws": null,
          "source": null
        },
        {
          "name": "symbolic",
          "args": [
            "number",
            "number"
          ],
          "result": "number",
          "throws": null,
          "source": null
        }
      ],
      "entryOnly": false
    }
  ],
  "diagnostics": []
}
```

字段说明：

- `source` ——用例来源：手写的 `@nudo:case` 指令和 `entry@L` 回退用例为 `null`；从记录的调用点合成的用例（`call@L…`）为 `"callsite"`。
- `entryOnly` ——函数没有收到任何调用点记录时为 `true`，此时其签名来自带 `unknown` 参数的 `entry@L` 回退用例。
- `diagnostics` ——与文本输出 `Diagnostics:` 区块相同的诊断列表（含 `range`、`severity`、`message`、`code`）。

---

### nudo check

检查单个 JavaScript 文件的类型错误。每条诊断输出一行，格式为 `[severity] 路径:行:列 消息 (错误码)`；存在 error 级诊断时以退出码 `1` 结束——仅有 warning 时退出码为 `0`。

```bash
nudo check <file>
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<file>` | `.js` 文件路径（相对或绝对） |

**示例：**

```bash
nudo check src/broken.js
```

```
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

- 无诊断的文件输出 `No issues found.`，退出码 `0`。
- 已知坏值来源时，会附提示行：`→ value originates at 行:列`。
- `@nudo:returns` 断言失败属于 error 级，`check` 以 `1` 退出：

```
[error] src/assert.js:5:0 @nudo:returns assertion failed for case "sample": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation (nudo-assertion-failed)
```

---

### nudo generate

从推断类型生成运行时验证器。输出打印到 stdout。

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
| `--output <dir>` | 已声明但**当前未实现**——输出总是打到 stdout，该选项无效果 |

**输出格式：**

- **`zod`** ——每个函数用例的 Zod schema 字符串（注释形式，含输入和输出）；输入参数命名为 `arg0`、`arg1`、…
- **`guard`** ——零依赖的运行时类型守卫函数，每个用例一个，命名为 `is<函数名><用例名>Output`
- **`dts`** ——TypeScript 声明；参数命名为 `arg0`、`arg1`、…（不保留真实参数名），无 JSDoc
- **`all`** ——以上所有格式

**示例：**

```bash
nudo generate src/user.js --format zod
```

```
// === createUser Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), age: z.number() }) }
// Output: z.object({ id: z.literal(123), name: z.string(), age: z.number() })
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

- **文件：** 监视该文件所在目录，追踪文件变更后重新分析
- **目录：** 递归监视**所有** `.js` 文件，排除 `node_modules`——不含 Nudo 指令的文件也会被分析（全程序推断：被监视文件之间的调用点合成 `call@L` 用例；未被调用的函数产出 `entry@L` 用例）
- **防抖：** 200ms 防抖以合并快速编辑
- **增量：** 只重新分析变更文件及其依赖方；每次运行打印 `Incremental: re-analyzed N, skipped M (…ms)`
- 每次运行会清空并重新打印输出

**示例：**

```bash
nudo watch .
nudo watch src/utils.js --dts
```

---

### nudo harvest

把已安装的 `@types/<pkg>` 的 `.d.ts` 声明转成 Nudo env 文件——用 `T.*` 构造器重建这些类型的 TypeScript 源码，通过 `/// @nudo:env` 指令加载。`@types` 包必须先安装。

```bash
nudo harvest <pkg> [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `<pkg>` | `@types` 下的包名（如 `node`） |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--out <file>` | 输出的 `.ts` env 文件（默认：`./nudo-harvest-<pkg>.ts`） |

**示例：**

```bash
pnpm add -D @types/node
nudo harvest node
```

```
Harvested @types/node → nudo-harvest-node.ts
  files:    80
  symbols:  1671
  skipped:  148

Usage — add this directive at the top of your JS file:
  /// @nudo:env nudo-harvest-node.ts
```

---

## 文件模式

- **输入：** 仅 `.js` 文件（通过 Babel 解析）
- **指令是可选的：** 不含任何 `@nudo:*` 指令的文件也会被分析——其函数类型来自观察到的调用点，没有调用时产出 `entry@L` 回退用例（`unknown` 参数）
- **监视模式：** 目录递归扫描所有 `.js` 文件，排除 `node_modules`

---

## 退出码

| 码值 | 含义 |
|------|---------|
| `0` | 成功 |
| `1` | 致命错误——文件缺失、解析失败，或给 `infer` 传了目录（`EISDIR`） |
| `1` | `nudo check` 发现至少一条 error 级诊断（仅有 warning 时退出码为 `0`） |

注意：`infer` 打印的诊断——包括 `[error]` 级的 `@nudo:returns` 断言失败——**不会**改变 `infer` 的退出码，`infer` 仍以 `0` 退出。要在 CI 中按诊断做门禁，请使用 `nudo check`。
