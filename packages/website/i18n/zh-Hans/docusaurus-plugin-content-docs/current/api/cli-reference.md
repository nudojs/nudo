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

| 命令 | 用途 |
|---------|---------|
| [`nudo infer`](#nudo-infer) | 从单个 JavaScript 文件推断类型 |
| [`nudo check`](#nudo-check) | 检查单个文件的类型错误（error 级诊断以退出码 `1` 结束） |
| [`nudo doctor`](#nudo-doctor) | 健康检查：调用点固化漂移、分析报错、无用例函数 |
| [`nudo generate`](#nudo-generate) | 从推断类型生成运行时验证器 |
| [`nudo watch`](#nudo-watch) | 监视文件或目录，变更时重新运行推断 |
| [`nudo harvest`](#nudo-harvest) | 把 `@types/<pkg>` 声明转成 Nudo env 文件 |

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
| `--emit-cases [mode]` | 把合成的调用点用例写回被分析文件，成为 `@nudo:case` 指令（保留名前缀 `call@`）。省略值即 `add`（只补尚无用例指令的函数）；传 `=update` 则全量重新同步已生成的指令——参见[固化 case 指令](/docs/guides/cli#固化-case-指令) |
| `--dry-run` | 搭配 `--emit-cases`：打印 unified diff 而不写盘 |
| `--exit-on-diff` | 搭配 `--dry-run`：diff 非空时以退出码 `1` 结束——可作使用处漂移的 CI 门禁 |

**输出格式：**

- 每个函数一个区块（`=== 名称 ===`）；来自导入模块的函数显示在 `--- 路径 (imported) ---` 标头下
- 每个用例：`Case "name": (arg1, arg2, ...) => result`
- 没有 `@nudo:case` 指令的函数同样会有用例：观察到的调用合成为 `call@L` 用例；没有调用时产出带 `unknown` 参数的 `entry@L` 用例并附 `# no call sites found` 注释
- 用例可能抛出时显示 `throws type`
- 多个用例时：组合类型显示为 `Combined: type`，并按吸收律化简——基类型已在联合中的字面量会被吸收（如 `2 | -9 | number` 坍缩为 `number`）；纯字面量联合保留全部成员
- 有诊断时，末尾输出 `Diagnostics:` 区块，条目格式为 `[severity] 路径:行:列 消息 (错误码)`
- 使用 `--dts`：在同一目录写入 `<basename>.d.ts` 并打印 `Generated: <basename>.d.ts`
- 使用 `--emit-cases`：末尾输出固化摘要——写盘后为 `Emitted cases → <file> (N directive(s) across M function(s))`；搭配 `--dry-run` 为 `Would emit cases → <file> (dry run)` 并附 unified diff；源码已同步时为 `No changes.`。摘要后跟逐函数行：写入的函数为 `fn: 用例名列表`，跳过的为 `fn: 原因`（如 `already-generated`）

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
=== subtract (math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number

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

### nudo doctor

对 JavaScript 文件做健康检查：调用点固化漂移（`--callsites`）、分析报错、无用例函数。任一文件漂移或报错即以退出码 `1` 结束——uncovered 函数仅为信息级，绝不影响退出码。

```bash
nudo doctor [paths...] [options]
```

**参数：**

| 参数 | 描述 |
|----------|-------------|
| `[paths...]` | 要检查的文件或目录。目录递归收集 `.js` 文件（排除 `node_modules`）；缺省为当前目录 |

**选项：**

| 选项 | 描述 |
|--------|-------------|
| `--callsites <paths...>` | 使用处文件或目录（测试/应用）。指定后，doctor 对每个文件重跑与 `infer --emit-cases=update` 相同的重新固化链路，生成的 `call@` 指令会变化时报告漂移——参见[健康检查与 CI 漂移门禁](/docs/guides/cli#健康检查与-ci-漂移门禁) |
| `--json` | 以结构化 JSON 输出报告 |

**检查项：**

- **漂移（drift）** ——搭配 `--callsites`：已生成的 `call@` 指令不再匹配使用处如今会产出的结果（与 `infer --emit-cases=update` 同一链路，逐文件判定）
- **报错（error）** ——分析失败，含文件缺失与语法错误
- **entry-only 计数 / uncovered 函数** ——信息级：有多少函数没有调用证据；`uncovered`（零用例）目前实际上恒为空——非 skipped 函数至少有 `entry@L` 回退用例——且绝不影响退出码

**退出码：**

| 码值 | 含义 |
|------|---------|
| `0` | 无漂移、无报错——仅有 uncovered 函数仍以 `0` 退出 |
| `1` | 任一文件有漂移或报错 |

**示例：**

健康（退出码 `0`）：

```bash
nudo doctor lib.js --callsites test.js
```

```
lib.js
  · 3 function(s), 1 entry-only

Summary: 1 file(s) · 0 drift · 0 error(s) · 0 uncovered function(s)
Result: OK (uncovered function(s) are informational only)
```

漂移——固化的 `call@` 指令已过期（退出码 `1`）；刷新命令直接打印、可原样复制：

```bash
nudo doctor lib.js --callsites test.js
```

```
lib.js
  · 3 function(s), 1 entry-only
  ✗ drift: 5 directive(s) changed (+3 new, -2 removed) — refresh with: nudo infer lib.js --callsites test.js --emit-cases=update

Summary: 1 file(s) · 1 drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

分析报错同样导致失败（退出码 `1`）：

```
missing.js
  ✗ error: File not found: <path>
```

```
broken.js
  ✗ error: Unexpected token (1:18)
```

CI 中一条命令即可对整个源码树做漂移门禁：

```bash
nudo doctor src/ --callsites tests/
```

**JSON 输出（`--json`）：**

```json
{
  "ok": false,
  "files": [
    {
      "file": "lib.js",
      "functions": 3,
      "entryOnly": 1,
      "uncovered": [],
      "drift": {
        "added": 3,
        "removed": 2
      }
    }
  ],
  "summary": {
    "files": 1,
    "drift": 1,
    "errors": 0,
    "uncovered": 0
  }
}
```

字段说明：

- `ok` ——与退出码一致：任一文件漂移或报错即为 `false`。
- `files[]` ——每文件一条：`file`、`functions`、`entryOnly`、`uncovered`；`drift: { added, removed }` 仅出现在漂移文件上，`error` 仅出现在失败文件上。
- `summary` ——总计：`files`、`drift`、`errors`、`uncovered`。

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
- **`dts`** ——TypeScript 声明；每个函数一条拓宽后的单一签名，使用真实参数名，每个 case 的精确结果保留在 JSDoc 中（与 `nudo infer --dts` 输出一致）
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

- **输入：** `.js`、`.mjs`、`.ts` 文件（通过 Babel 解析；TypeScript 类型标注在 parser 层剥除，按 JS 语义推断）；也接受目录——递归收集推断目标文件（`.js`/`.mjs`/`.ts`，排除 `.d.ts`）
- **指令是可选的：** 不含任何 `@nudo:*` 指令的文件也会被分析——其函数类型来自观察到的调用点，没有调用时产出 `entry@L` 回退用例（`unknown` 参数）
- **监视模式：** 目录递归扫描推断目标文件（`.js`/`.mjs`/`.ts`），排除 `node_modules` 与 `.d.ts`

---

## 退出码

| 码值 | 含义 |
|------|---------|
| `0` | 成功 |
| `1` | 致命错误——文件缺失、解析失败，或给 `infer` 传了目录（`EISDIR`） |
| `1` | `nudo check` 发现至少一条 error 级诊断（仅有 warning 时退出码为 `0`） |
| `1` | `nudo doctor` 发现漂移或分析报错——仅有 uncovered 函数时退出码为 `0` |
| `1` | `--emit-cases` 用法错误——与 `--json` 组合、mode 值非法、或 `--exit-on-diff` 未搭配 `--dry-run`；以及 `--exit-on-diff` 在 `--dry-run` diff 非空时触发 |

注意：`infer` 打印的诊断——包括 `[error]` 级的 `@nudo:returns` 断言失败——**不会**改变 `infer` 的退出码，`infer` 仍以 `0` 退出。要在 CI 中按诊断做门禁，请使用 `nudo check`。
