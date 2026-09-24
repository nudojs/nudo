---
description: "nudo CLI 参考 —— check、test、contract、export、health 的参数、选项、输出格式与退出码。"
---

# CLI 参考

`nudo` CLI 对 `.js` / `.mjs` / `.ts` 运行类型推断。安装方式见[安装](../getting-started/installation.md)。

```bash
npx nudojs check ./src/utils.js
# 全局安装后也可直接：
nudo check ./src/utils.js
```

本页是**旗标 / 选项 / 退出码的规范定义**。教程式走读见 [CLI 使用指南](../guides/cli.md)。

---

## 命令

| 命令 | 用途 |
|------|------|
| [`nudo check`](#nudo-check) | 门禁契约 + 入口 throws；成功与失败都打印 signatures（CI 门禁） |
| [`nudo test`](#nudo-test) | 报告全部推断用例；断言已声明的 `@nudo:case` 期望 |
| [`nudo contract`](#nudo-contract) | 打印 / draft / emit 有效接口 —— `[handwritten]` / `[generated]` / `[implicit]` 分层 |
| [`nudo export`](#nudo-export) | 把 Abs 投影为 `dts` / `guard` / `schema` / `standard` |
| [`nudo health`](#nudo-health) | 健康检查：分析错误、调用点固化漂移 |

观察 = `check` 签名 + `test` 用例报告 + IDE hover。

**Day 0：** `check` / `test`。**Day 1：** `contract` + `check`。**生态：** `export`。

---

### nudo check

门禁契约（L1）与入口 throws（L2）。成功时也打印 signatures。

```bash
nudo check <paths...> [options]
```

**参数：**

| 参数 | 说明 |
|------|------|
| `<paths...>` | 一个或多个 `.js` / `.mjs` / `.ts` 文件或目录（递归扫描；排除 `.d.ts`）。TS 注解在解析层剥离，按 JS 语义分析。`--json` 只支持单文件。 |

**选项：**

| 选项 | 说明 |
|------|------|
| `--watch` / `-w` | 变更时重跑（旗标，不是动词） |
| `--json` | 结构化诊断 + 签名（单文件；不能与 `--abs` 组合） |
| `--verbose` | 额外诊断细节 |
| `--abs` | 每函数代数面（shape + conf）；`--generalize` 附加符号 term/pred α |
| `--fn <name>` | 搭配 `--abs`：限定单个函数 |
| `--assume <pred…>` | 搭配 `--abs`：假设约束，如 `x>0 y>=1` |
| `--generalize` | 搭配 `--abs`：经符号执行得到多态签名 |
| `--from <paths…>` | 使用处文件（tests/apps）；其调用记录并入分析 |
| `--ignore-throws <names>` | 逗号分隔、可忽略的 L2 throws 类型（如 `TypeError,RangeError`）。不吞 L1 契约违例。 |
| `--entry-throws error\|warning\|off` | L2 入口 may-throw 严重级别（默认 `error`） |

**配置（`package.json`）：**

```json
{
  "nudo": {
    "check": {
      "ignoreThrows": ["TypeError"],
      "entryThrows": "error"
    }
  }
}
```

**输出格式：**

```text
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> 报头里的 `L1` 是**行号**（此处函数声明在第 1 行）—— 该诊断的层是 L2。

- 无约束入口参数打印为 **`any`**，绝不是 `unknown`。
- 真 `unknown` 表示推导失败（引擎债），并带 conf 标注。
- 存在 throws 时签名行必须上屏。
- 成功也打印 `signatures` —— `check` 不是静默。

**义务分层：**

| 层 | 来源 | 行为 |
|----|------|------|
| L1 显式 | `*.nudo.js` / `@nudo:refine`（别名 `@nudo:interface`） | 违例 → error |
| L2 默认 JS 契约 | **入口/导出**函数的运行时边界 | 未消化 may-throw → error（`nudo:entry-may-throw`）；`--ignore-throws` 过滤 |

L2 **不**门禁内部 helper。`try`/`catch` 与 refine 可清除 L2。

**示例：**

```bash
nudo check user.js
nudo check src/lib.js --ignore-throws TypeError --from tests/
# --json 仅支持单文件；目录目标走人类可读报告
nudo check src/lib.js --json
```

**退出码：**

| 码 | 含义 |
|----|------|
| `0` | 无 error 级诊断 |
| `1` | 任一 error 级诊断（L1 或未 ignore 的 L2） |

---

### nudo test

报告全部推断用例（含合成 `call@` / `entry@`），并运行已声明断言。

```bash
nudo test <paths...> [options]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--watch` / `-w` | 变更时重跑 |
| `--from <paths…>` | 使用处文件，其调用合成为 `call@L` 用例 |
| `--freeze[=mode]` | 把合成用例写回为 `@nudo:case` 指令。模式：`update` 重新同步已生成指令；不给值 = add 模式，保留既有指令 |
| `--json` | 结构化用例报告（单文件；不能与 `--abs` 或 `--freeze` 组合） |
| `--abs` | 打印用例的 Abs 代数 |
| `--dry-run` | 搭配 `--freeze`：打印 unified diff 而不写盘 |
| `--exit-on-diff` | 搭配 `--freeze --dry-run`：diff 非空时退出 `1` |

**输出格式：**

```text
=== getName ===
  call@L42  ({ name: "Ada" }) => "Ada"
  debug "empty"  ({}) => undefined

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 1 synthetic case(s) printed above)
```

找不到使用处调用的入口导出时：

```text
=== getName ===
  entry@L6  (any) => any   throws TypeError
```

- 合成 `call@` / `entry@` **默认打印** —— 这就是调用点观察。
- 已有使用处 `call@` 时，分析器**不会**再为该函数合成 `entry@`。
- 仅 `@nudo:case` 且带 `=> expected` 的进入 pass/fail。
- 声明断言失败 → exit `1`；合成用例不影响。
- `test --json` 含 `assertions` 摘要（`passed`/`failed`/`unchecked`），声明断言失败仍 exit 1。

声明断言失败（`nudo:case-expected`）呈现为：

```text
=== double ===
  debug "bad"  (2) => 4

assertions
  ✗ 0 passed · 1 failed · 0 unchecked
  [FAIL] double  case "bad"
         expected: 5
         actual:   4
```

**示例：**

```bash
nudo test math.js
```

```text
=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

```bash
nudo test lib.js --from test.js --freeze=update
```

**退出码：**

| 码 | 含义 |
|----|------|
| `0` | 全部声明断言通过（或无声明断言） |
| `1` | 任一声明断言失败 |

---

### nudo contract

打印、草稿或固化每个函数的有效接口及其来源分层。

```bash
nudo contract <paths...> [--from <paths...>]
nudo contract --emit <paths...> [--fn <name>] [--all] [--dry-run] [--exit-on-diff] [--from <paths...>]
nudo contract --draft <paths...> [--write] [--fn <name>] [--dry-run] [--from <paths...>]
```

**分层：**

- `[handwritten]` —— 源码 `@nudo:refine` / 侧车绑定（产品术语：**contract**）
- `[generated]` —— 固化的 `@generated` 侧车段
- `[implicit]` —— 调用点推断

**选项：**

| 选项 | 说明 |
|------|------|
| `--emit` | 把推断域固化为侧车 `@generated` 段 |
| `--draft` | 从已有逻辑生成可审阅契约草稿（代码优先 / 迁移） |
| `--write` | 搭配 `--draft`：写入 `*.nudo.draft.js` |
| `--fn <name>` | 限定单个函数（**可重复**；有手写根时可命名下游派生目标） |
| `--all` | emit 所有合格函数 |
| `--dry-run` | 打印 unified diff 而不写盘 |
| `--exit-on-diff` | 搭配 `--emit --dry-run`：diff 非空时退出 `1` |
| `--from <paths…>` | 使用处证据，供域投影 |

**示例：**

```bash
nudo contract calc.js
nudo contract --draft double.js --write
nudo contract --emit lib.js --fn add2
```

生成段注释形式：

```js
// @generated by nudo — do not edit; regenerate with `nudo contract --emit`
```

手写绑定始终优先；emit 拒绝覆盖（`nudo:interface-name-clash`）。证据未变时重跑 emit 是 no-op。

**退出码：**

| 码 | 含义 |
|----|------|
| `0` | 成功 |
| `1` | 用法 / IO 错误；或 `--exit-on-diff` 且将写盘有 diff |

---

### nudo export

把 Abs 投影为生态产物。CLI 上 `.d.ts` / guard / schema 投影的**唯一**路径。

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--format` | `dts`（默认）\| `guard` \| `schema` \| `standard` \| `all` |
| `--dialect` | schema dialect；当前为 `zod`。仅对 `schema` / `all` 有意义 |
| `--out <dir>` | 把产物写入该目录，而非 stdout |

**格式：**

| 格式 | 产物 |
|------|------|
| `dts` | TypeScript 声明 —— 每函数一条拓宽签名；case 精度保留在 JSDoc |
| `guard` | 运行时类型守卫（有无损 Abs 路径时优先） |
| `schema` | `--dialect` 对应的 schema 源码 → `*.nudo.schema.<dialect>.ts` |
| `standard` | Standard Schema v1 模块（`~standard`，vendor `nudo`）→ `<fn>.nudo.standard.ts` |
| `all` | dts + guard + schema + standard |

可表达的 Abs pred（常数界 / `int` / 字符串长度）会进入 schema；符号 pred 落在基类型上并在 `dropped preds` 注释列出。`standard` 在运行时 `validate` 中执法同一 refinement 集合——仍是单向投影，**CI 门禁仍是 `nudo check`**。

`.d.ts` / schema 是 Abs 的单向有损投影。export 不接受 `--watch`。

**退出码：**

| 码 | 含义 |
|----|------|
| `0` | 成功 |
| `1` | 用法 / IO 错误 |

---

### nudo health

健康检查：分析错误与调用点固化漂移。

```bash
nudo health [paths...] [--watch] [--from <paths...>] [--json]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--watch` | 变更时重跑 |
| `--from <paths…>` | 使用处文件；health 重跑与 `test --freeze=update` 相同的重新固化链路，生成 `call@` 指令会变化时报告漂移 |
| `--json` | 结构化健康报告 |

**示例：**

```bash
nudo health src/ --from tests/
```

```text
src/lib.js
  · 1 function(s)
  ✗ drift: 3 witness directive(s) changed (+2 new, -1 removed) — refresh: nudo test src/lib.js --from tests/ --freeze=update

Summary: 1 file(s) · 1 case drift · 0 contract drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

**退出码：**

| 码 | 含义 |
|----|------|
| `0` | 无漂移、无分析错误 |
| `1` | 漂移或分析错误（uncovered 函数仅为信息级） |

---

## JSON 输出

`check --json` 与 `test --json` 是机器可读面。

- **check --json** —— 签名（含 `any` 入口参数与 throws）、诊断码（如 `nudo:entry-may-throw`）、汇总计数。
- **test --json** —— 逐函数用例（`entry@` / `call@` / 指令）、`assertions` 摘要（`passed`/`failed`/`unchecked`）、诊断、可选 Abs intension 块；声明断言失败仍 exit 1。
- **check --json** —— 仅支持单文件（目录目标报 `--json requires a single file, not multiple targets`）；`test --json` 报 `--json requires a single file`。

---

## 退出码汇总

| 命令 | exit `1` |
|------|----------|
| `check` | 任一 error 级诊断（L1 或未 ignore 的 L2）；`--abs` 仍门禁 |
| `test` | 任一**声明**断言失败 |
| `contract` / `export`（只读） | 用法 / IO 错误 |
| `contract --emit --exit-on-diff` | 将写盘且有 diff |
| `health` | 漂移或分析错误 |
