---
sidebar_position: 1
description: "从终端驱动 Nudo：check 签名、test 用例、contract 契约、export 投影 —— 六个一级动词。"
---

# CLI 使用指南

`nudo` CLI 是对 `.js` / `.mjs` / `.ts` 运行类型推断的产品命令面。全局安装或通过 `npx` 使用：

```bash
npm install -g @nudojs/cli
# 或
pnpm add -g @nudojs/cli
```

## 一级动词

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # 门禁契约 + 入口 throws；打印 signatures
  nudo test <path> [--watch|-w]    # 报告全部推断用例；断言已声明期望
  nudo contract <path>             # 契约：打印 / draft / emit 侧车接口
  nudo export <path>               # 投影：dts / guard / zod
  nudo health [paths]              # 体检：分析错误 + 固化漂移
  nudo env harvest <pkg>           # 环境：@types → env 模块
```

**没有**观察动词：没有 `nudo infer` / `nudo show` / `nudo types` 一级命令，也**没有**一级 `nudo watch`。观察落在 `check` / `test` 的输出与 IDE hover。

**Day 0：** `nudo check`（签名）与 `nudo test`（用例）。  
**Day 1：** `nudo contract` + `nudo check`。  
**生态：** `nudo export`。

| 想知道什么 | 跑什么 |
|------------|--------|
| 入口签名 / any / unknown / throws | `nudo check <path>`（成功也打印 `signatures`） |
| 逐调用点真值 / 窄化结果 | `nudo test <path>`（打印全部 case，含合成 `call@` / `entry@`） |
| 使用处实参形态 | `nudo check` / `test` / `contract` `--from <paths…>` |
| 代数面 term/pred/conf | `nudo check --abs`（或 `test --abs`） |
| 机器可读 | `nudo check --json` / `nudo test --json` |
| 交互 | IDE hover / inlay |

---

## `nudo check`

门禁契约与入口 throws。成功与失败都会打印 signatures —— **不是静默**。

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

给定 `user.js`：

```js
export function getName(user) {
  return user.name;
}

export function subtract(a, b) {
  return a - b;
}
```

```bash
nudo check user.js
```

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

无约束入口参数显示为 **`any`**。`unknown` 表示推导失败（引擎债）—— 绝不是无约束入口参数的默认值。

### 义务分层

| 层 | 来源 | `check` 行为 |
|----|------|--------------|
| **L1 显式** | `*.nudo.js` / `@nudo:refine` / `@nudo:interface`；调用点证据可作 domain | 违例 → **error** |
| **L2 默认 JS 契约** | 未收窄时的运行时边界语义 | **入口/导出**函数未消化 may-throw → **error**（`nudo:entry-may-throw`） |

无显式契约时，契约退化为 JS 运行时边界：入口参数为 `any`，对 `any`/可空值的操作可能抛，导出函数不得静默携带未声明、未捕获的 throws。

**L2 只门禁入口/导出函数。** 内部 helper 允许 throw；`check` 不因内部 may-throw 失败。`try`/`catch` 与 refine 可清除路径上的 L2。

### 选项

| 选项 | 说明 |
|------|------|
| `--watch` / `-w` | 变更时重跑（watch 是**旗标**，不是动词） |
| `--json` | 机器可读诊断 + 签名 |
| `--verbose` | 额外诊断细节 |
| `--abs` | 打印 Abs 代数面（term / pred / conf） |
| `--from <paths…>` | 使用处文件（测试/应用），注入调用记录 —— 由 `--callsites` 更名 |
| `--ignore-throws <names>` | 逗号分隔、可忽略的 L2 throws 类型（如 `TypeError`）；**不**吞 L1 契约违例 |
| `--entry-throws error\|warning\|off` | L2 入口 may-throw 严重级别（默认 `error`） |

`package.json` 配置：

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

任一 error 级诊断（L1 或未 ignore 的 L2）时退出码为 `1`。

`nudo check` 是 CI 门禁。优先于遗留观察命令。

---

## `nudo test`

报告全部推断用例，并运行已声明的 `@nudo:case` 断言。

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=update]] [--json] [--abs]
```

给定 `math.js`：

```js
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
  call@L6  (5, 3) => 2
  call@L7  (1, 10) => -9
assertions
  — 0 passed · 0 failed · 2 unchecked (no declared @nudo:case expectations)
```

- 合成 `call@` / `entry@` **默认打印** —— 这就是调用点观察面。
- 已有使用处 `call@` 时，分析器**不会**再合成 `entry@`。
- 仅 `@nudo:case` 且带 `=> expected` 的进入 pass/fail；失败影响退出码。
- `--from <paths…>` 挖掘使用处调用形状（原 `--callsites`）。
- `--freeze[=update]` 把合成用例固化为指令（原 `infer --emit-cases`）。
- `--json` / `--abs` 与 `check` 对齐；`test --json` 含 `assertions` 摘要，声明断言失败仍 exit 1。

---

## `nudo contract`

打印、草稿或固化有效接口（handwritten / generated / implicit 分层）。取代旧的 `nudo interface` / `nudo refine`。

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

把 Abs 投影为生态产物。这是 CLI 上 `.d.ts` / guard / Zod 的**唯一**路径。

```bash
nudo export <path> [--format dts|guard|zod|all] [--out dir]
```

```bash
nudo export src/user.js --format dts --out dist/types
nudo export src/user.js --format zod
nudo export src/user.js --format all --out dist
```

| 格式 | 产物 |
|------|------|
| `dts` | TypeScript 声明（每函数一条拓宽签名；case 精度保留在 JSDoc） |
| `guard` | 运行时类型守卫 |
| `zod` | Zod schema |
| `all` | 以上全部 |

`.d.ts` 是**单向、有损投影** —— Abs 才是真理源。export 是一次性出货命令，不接受 `--watch`。

---

## `nudo health`

项目体检：分析错误与固化漂移。由 `nudo doctor` 更名。

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

## `nudo env harvest`

把 `@types/<pkg>` 收割为 Nudo env 模块。

```bash
nudo env harvest <pkg> [--out dir]
```

```bash
nudo env harvest node
```

在源码中引用生成的 env：

```ts
/// @nudo:env ./nudo-harvest-node.ts
```

---

## 迁移 / 废弃动词

旧动词在过渡期保留，stderr 打印 **deprecation 警告**，映射到新命令面。下一 major 删除，**不是**永久静默同义词。

| 废弃 | 改用 |
|------|------|
| `nudo infer <path>` | 签名 → `nudo check <path>`；用例报告 → `nudo test <path>`；dts → `nudo export --format dts` |
| `nudo types <path>` | `nudo check --abs` |
| `nudo interface` / `nudo refine` | `nudo contract` |
| `nudo generate` / `nudo emit` / `nudo guard` | `nudo export --format dts\|guard\|zod\|all` |
| `nudo doctor` | `nudo health` |
| `nudo watch` | `nudo check --watch` / `nudo test --watch` |
| `nudo harvest <pkg>` | `nudo env harvest <pkg>` |
| `--callsites` | `--from` |
| `--emit-cases[=update]` | `nudo test --freeze[=update]` |
| `infer --dts` | `nudo export --format dts` |

`infer --json` 按消费者拆分：诊断/签名 → `check --json`；用例 → `test --json`。**没有** `check --cases` —— 观察与执法保持分离。

---

## 典型工作流

### Day 0 —— 从现有 JS 读类型

```bash
nudo check src/app.js          # 签名 + L2 入口 throws
nudo test src/app.js           # 全部调用点用例
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

## `any` 与 `unknown`

| | `any` | `unknown` |
|---|-------|-----------|
| 含义 | 无约束：JS 值的并集；**开发者**负责细化 | **推导失败** / 引擎无信息；**Nudo** 负责修 |
| 来源 | 未标注入口参数、显式 `any()`、refine 解析失败回退 | 求值失败、native 未建模、截断、泄漏、opaque |
| 展示 | `any`（可带 type-var 如 `A1`） | `unknown` + conf 标注 |
| 产品话术 | 「未写契约 ⇒ 默认约束为 any + JS 运行时效果」 | 「Nudo 遇到无法处理的场景」 |

**绝不**把无约束入口参数叙述为 `unknown`。详见 [Type Values](../concepts/type-values.md#any-vs-unknown)。

---

## 退出码

| 命令 | exit `1` |
|------|----------|
| `check` | 任一 error 级诊断（L1 或未 ignore 的 L2） |
| `test` | 任一**已声明**断言失败（合成 `call@`/`entry@` 不挡 exit） |
| `contract`（只读）/ `export` | 仅用法 / IO 错误 |
| `contract --emit --exit-on-diff` | 将写盘且有 diff |
| `health` | 漂移或分析错误 |

CI 门禁只认 `check`（及 `test` 的声明断言、`health` 的 drift）。
