---
description: "从终端驱动 Nudo —— 产品动词的任务型工作流（check / test / contract / export / health / migrate）。"
---

# CLI 使用指南

`nudo` CLI 在 `.js` / `.mjs` / `.ts` 上的任务型导览。通过 `npx` 使用——见[安装](../getting-started/installation.md)。**完整 flag / 退出码表：** [CLI 参考](../api/cli-reference.md)。

## 一级动词

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # 门禁契约 + 入口 throws；打印 signatures
  nudo test <path> [--watch|-w]    # 报告全部推断用例；断言已声明期望
  nudo contract <path>             # 契约：打印 / draft / emit 侧车接口
  nudo export <path>               # 投影：dts / guard / schema / standard
  nudo health [paths]              # 体检：分析错误 + 固化漂移
```

观察落在 `check` / `test` 的输出与 IDE hover，不设独立观察动词。

**Day 0：** `nudo check`（签名 + 门禁）。可选调试：`nudo test`（用例见证）。
**Day 1：** `nudo contract` + `nudo check`。
**生态：** `nudo export`。
**离 tsc：** `nudo migrate`（单向 `status` → `strip` → `verify` → `retire`）。

| 想知道什么 | 跑什么 |
|------------|--------|
| 入口签名 / any / unknown / throws | `nudo check <path>`（成功也打印 `signatures`） |
| 逐调用点真值 / 窄化结果 | `nudo test <path>`（打印全部 case，含合成 `call@` / `entry@`） |
| 使用处实参形态 | `nudo check` / `test` / `contract` `--from <paths…>` |
| 代数面（shape + conf；`--generalize` 附加 term/pred α） | `nudo check --abs`（或 `test --abs`） |
| 机器可读 | `nudo check --json` / `nudo test --json` |
| 交互 | IDE hover / inlay |

---

## `nudo check`

门禁契约与入口 throws。成功与失败都会打印 signatures —— **不是静默**。

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

```bash
nudo check user.js
```

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

无约束入口参数显示为 **`any`**。`unknown` 表示推导失败（引擎债）—— 绝不是无约束入口参数的默认值。`[ERROR L# name]` 中 `L#` 是违规调用/声明的**行号**，不是契约层（L1/L2 才是层）。上方示例打印 `L1` 是因为该文件中 `getName` 声明在第 1 行 —— 其层是 L2。

- **语义**（L1 显式契约 / L2 入口 throws、退出码、过滤）：[nudo check](./check.md)
- **选项与配置**（`--watch` / `--json` / `--abs` / `--from` / `--ignore-throws` / `--entry-throws`、`package.json#nudo.check`）：[CLI 参考](../api/cli-reference.md#nudo-check)

`nudo check` 是 CI 门禁。

---

## `nudo test`

报告全部推断用例，并运行已声明的 `@nudo:case` 断言。

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=mode]] [--dry-run] [--exit-on-diff] [--json] [--abs]
```

给定 `math.js`：

```js verify
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

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

- 合成 `call@` / `entry@` **默认打印** —— 这就是调用点观察面。
- 已有使用处 `call@` 时，分析器**不会**再合成 `entry@`。
- 仅 `@nudo:case` 且带 `=> expected` 的进入 pass/fail；失败影响退出码。
- `--from <paths…>` 挖掘使用处调用形状。
- `--freeze[=mode]` 把合成用例固化为指令：`--freeze`（不给值，add 模式）新增见证；`--freeze=update` 重同步此前生成的指令。
- `--dry-run`（配合 `--freeze`）打印 unified diff 而非写盘；`--exit-on-diff`（配合 `--freeze --dry-run`）在 diff 非空时 exit 1。
- `--json` / `--abs` 与 `check` 对齐；`test --json` 含 `assertions` 摘要，声明断言失败仍 exit 1。

### 带声明断言的示例

```js verify
/**
 * @nudo:case "double" (2) => 4
 */
export function double(x) {
  return x * 2;
}
```

```bash
nudo test file.js
```

```text
=== double ===
  debug "double"  (2) => 4

assertions
  ✓ 1 passed · 0 failed · 0 unchecked
  [ok]   double  case "double" → 4
```

---

## `nudo contract`

打印、草稿或固化有效接口（handwritten / generated / implicit 分层）。

```bash
nudo contract <path> [--emit] [--draft] [--write] [--fn name] [--all]
              [--dry-run] [--exit-on-diff] [--from paths…]
```

```bash
nudo contract src/lib.js                     # 打印有效接口
nudo contract --draft src/lib.js             # 可审阅的 *.nudo.draft.js
nudo contract --draft --write src/lib.js     # 写盘草稿
nudo contract --emit src/lib.js --fn add2    # 持久化 @generated 侧车段
nudo contract --emit src/lib.js --all --dry-run --exit-on-diff  # CI 漂移门禁
```

- 手写侧车绑定始终优先于生成段。
- `--emit --exit-on-diff`：将写盘且有 diff 时退出 `1`。
- 使用处证据：`--from <paths…>`。

---

## `nudo export`

把 Abs 投影为生态产物。这是 CLI 上 `.d.ts` / guard / schema 投影的**唯一**路径。

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

```bash
nudo export src/user.js --format dts --out dist/types
nudo export src/user.js --format schema --dialect zod
nudo export src/user.js --format standard --out dist
nudo export src/user.js --format all --out dist
```

| 格式 | 产物 |
|------|------|
| `dts` | TypeScript 声明（每函数一条拓宽签名；case 精度保留在 JSDoc） |
| `guard` | 运行时类型守卫 |
| `schema` | 某 dialect 的 schema **源码**投影（默认 dialect：`zod`）→ `*.nudo.schema.<dialect>.ts` |
| `standard` | **Standard Schema v1** 运行时模块（`~standard`，vendor `nudo`）→ `<fn>.nudo.standard.ts` |
| `all` | dts + guard + schema + standard |

`--dialect` 当前接受 `zod`。Abs 上可表达的常数界 / `int` / 字符串长度界会落入 schema；落不了的 pred 保留在基类型上，并列在 `dropped preds` 注释里。

`standard` 是生态互操作出口：生成模块实现 [Standard Schema](https://standardschema.dev) 的 `validate`，不依赖 Zod/Valibot。存在侧车 / `@nudo:contract` 契约时，参数校验器使用**契约域**（`<fn>_<param>`）；无契约时参数位取各调用点 Abs 的 **join**（不钉死单次字面量）。它是运行时挡板，**不能**替代 `nudo check`。

`.d.ts` 与 schema 都是**单向、有损投影** —— Abs 才是真理源。export 是一次性出货命令，不接受 `--watch`。

逐格式语义与退出码：[CLI 参考](../api/cli-reference.md#nudo-export)。

---

## `nudo health`

项目体检：分析错误与固化漂移。

```bash
nudo health [paths…] [--watch] [--from paths…] [--json]
```

漂移或分析错误时退出 `1`。uncovered 函数仅为信息级。

```bash
nudo health src/ --from tests/
```

生成的 `call@` 指令会变化时，health 报告漂移并建议：

```text
nudo test lib.js --from test.js --freeze=update
```

---

## 典型工作流

### Day 0 —— 从现有 JS 读类型

```bash
nudo check src/app.js          # 签名 + L2 入口 throws（门禁）
nudo test src/app.js           # 可选调试：全部调用点用例
```

### Day 1 —— 显式契约

```bash
nudo contract --draft src/lib.js --write   # 可审阅草稿
nudo check src/lib.js                      # L1 + L2 门禁
```

### CI

```bash
nudo check src/ --json
# 迁移期可忽略噪声 L2 类型
nudo check src/ --ignore-throws TypeError
```

### 生态类型

```bash
nudo export src/api.js --format dts --out dist/types
```

### 持续开发

```bash
nudo check src/ --watch
# 或
nudo test src/ --watch
```

---

## `any` 与 `unknown` {#any-vs-unknown}

无约束入口参数显示为 **`any`**；**`unknown`** 表示推导失败（引擎债），绝不能被叙述为无约束参数的默认值。完整契约（来源、运算、窄化、产品话术）见 [Abs — any vs unknown](../concepts/abs.md#any-vs-unknown)。

---

## 退出码

逐命令退出契约：[CLI 参考](../api/cli-reference.md)。CI 门禁只认 `check`（及 `test` 的声明断言、`health` 的 drift）。

## 下一步

- [十分钟心智模型](../getting-started/mental-model.md) —— 产品面
- [nudo check](./check.md) —— CI 门禁详解
- [CLI 参考](../api/cli-reference.md) —— 每个 flag 与退出码
- [示例](./examples.md) —— 真实 check/test 输出
