---
slug: /guides/check
description: nudo check —— Abs 上的 L1 显式契约门禁 + L2 入口 throws；打印 signatures；CI 命令。
---

# nudo check

`nudo check` 是 Nudo 在 Abs 上的**门禁**。它执法：

1. **L1 显式契约** —— 来自 `*.nudo.js` / `@nudo:refine` 的精化（Abs 上的 Pred 蕴含；`@nudo:interface` 是精确别名）
2. **L2 默认 JS 契约** —— **入口/导出**函数上未消化的 may-throw

报告是 **Nudo 原生**的（`actual ⊭ expected`），不是 TypeScript 诊断的伪装。成功与失败都打印 signatures —— **不是静默**。

```bash
npx nudojs check path/to/file.js
# 任一 error 则 exit 1
```

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

## 默认输出（signatures + issues）

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
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or declare/catch throws
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> `[ERROR L1 getName]` 里的 `L1` 是**行号**（此处函数声明在第 1 行）—— 该诊断的层是 L2（`nudo:entry-may-throw`）。`L#` 永远是位置，不是契约层。

- 无约束入口参数显示为 **`any`**。
- **`unknown` 表示推导失败**（引擎债）—— 绝不是无约束入口参数的默认值。
- 存在 throws 时必须上屏。
- `[ERROR L# name]` —— `L#` 是违规调用/声明的**行号**，不是契约层（L1/L2 才是层；`L#` 是位置）。

## 检查什么

| 码 | 层 | 严重级别 | 含义 |
|----|----|----------|------|
| `nudo:constraint-violated` | L1 | error | 调用/返回 ⊭ `@nudo:refine`（标量界 / shape 字段） |
| `nudo:assign-mismatch` | L1 | error | 赋值 ⊭ 原绑定 shape（`leqAbs`） |
| `nudo:arg-structure` | L1 | error（显式契约）/ warning（body-promote） | HOF：实参不是可调用 `fn` / 元数不匹配。用法驱动的 body 提升是**警告建议**；只有显式关系契约才升级为 error |
| `nudo:case-inconsistency` | L1 | error | `@nudo:case` 见证 ⊭ refine |
| `nudo:interface-param-mismatch` | L1 | error | 手写契约参数名不在形式参数面上 |
| `nudo:interface-conflict` | L1 | error | 手写契约合取不可满足 |
| **`nudo:entry-may-throw`** | **L2** | **error**（默认） | 入口/导出函数有未消化 may-throw |
| `nudo:may-throw` | test / L2 线索 | warning | case 路径可能抛（含内部）；L2 可升格入口 throws |
| `nudo:unknown-inference` | 引擎债 | warning | 签名出现真 `unknown`（推导失败）——入口无约束参数是 `any`，不走此码 |
| `nudo:unknown-recv` | 引擎债 | warning | `unknown` 接收者成员访问 —— **不得**替代 L2 throws 建模 |
| `nudo:no-signature` | 引擎/L1 | warning | 函数无法泛化为符号 Abs（CJS/匿名形态仍走入口 fallback 执法 L2） |
| `nudo:opaque-result` | 引擎 | info | 求值返回 opaque / 无信息 Abs |
| `nudo:eval-error` | 引擎 | error | 分析期间 body 求值抛出 |
| `nudo:recursion-truncated` | 引擎 | warning | 递归预算用尽；结果拓宽 |
| `nudo-unreachable` | info | info | return/throw 之后的代码 |

## L1 —— 显式契约

精化由 `@nudo:refine` 声明 —— 进入 Abs、参与代数的 Pred。

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [ERROR L12 needsPositive] needsPositive[x]: argument ⊭ precondition  (nudo:constraint-violated)
//   actual:   -1  #exact
//   expected: x > 0
//   → use a value satisfying x > 0, or relax the precondition on x
```

**`if` 不是精化。** 未声明 refine 时，clamp 式守卫接受越界输入：

```js
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — 未声明 @nudo:refine
```

Nudo **不**从 body AST 扫描发明必填 slot。

## L2 —— 入口 throws

无显式契约时，契约退化为 **JS 运行时边界**：

> 入口参数为 `any`。对 `any`/可空值的操作可能抛。导出函数不得静默携带未声明、未捕获的 throws。

```js
export function getName(user) {
  return user.name;  // 对无约束 `user` 的属性访问
}
```

```text
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  getName(user: any) => any  throws TypeError

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or declare/catch throws
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> 提醒：报头里的 `L1` 是**行号** —— 该诊断的层是 L2。

### L2 门禁什么

- **仅入口/导出函数** —— `export` / `export default`、CJS `exports.x =` / `module.exports`。
- **内部 helper 不门禁。** 它们可以 throw；在 `nudo test` 中观察。
- `try`/`catch` 消化路径上的 throws（从出口效果中移除）。
- refine 把参数收成 shape 后，L2 消失或降为 L1。

### 过滤 L2

```bash
nudo check src/ --ignore-throws TypeError
nudo check src/ --ignore-throws TypeError,RangeError
nudo check src/ --entry-throws warning   # 迁移期降级 L2
nudo check src/ --entry-throws off
```

语义：

- `--ignore-throws` **只**过滤 L2 入口 throws —— 绝不吞 L1 契约违例。
- 默认：**不忽略**任何 throws。
- 过滤的是 throws 类型/形状，不是整个 check。

把这些持久化到 `package.json#nudo.check` —— 配置块见 [CLI 参考](../api/cli-reference.md#nudo-check)。

### 与 Node 类比

未捕获异常使 Node 进程以非零码退出。同样，**导出边界**上的未声明/未捕获 throws 使 `nudo check` 失败。内部调用栈中的 throw 是实现细节，由调用方或 L1 处理。

## 选项

| 选项 | 说明 |
|------|------|
| `--watch` / `-w` | 变更时重跑（旗标，不是动词） |
| `--json` | 机器可读签名 + 诊断 |
| `--verbose` | 额外细节 |
| `--abs` | 逐函数代数面（shape + conf；`--generalize` 附加符号 term/pred α）——观察面，仍对 L1/L2 执法 |
| `--fn <name>` | 搭配 `--abs`：限定单个函数 |
| `--assume <pred…>` | 搭配 `--abs`：对入口参数假设约束（如 `x>0 y>=1`） |
| `--generalize` | 搭配 `--abs`：符号执行的多态签名 |
| `--from <paths…>` | 使用处文件注入调用记录 |
| `--ignore-throws <names>` | 逗号分隔、可忽略的 L2 throws 类型 |
| `--entry-throws error\|warning\|off` | L2 严重级别（默认 `error`） |

## 接口诊断

| 码 | 严重级别 | 含义 |
|----|----------|------|
| `nudo:interface-drift` | warning | 固化 `@generated` 段 ≠ 今日重算接口。`nudo health` 也作为 CI 门禁上浮 |
| `nudo:interface-name-clash` | error | `nudo contract --emit` 目标已是手写侧车绑定（手写优先，跳过写入） |
| `nudo:interface-domain-exceeds` | error | 通过 `--from` 注入的调用记录超出声明域 |

写在**被分析文件内**的违例报告 `nudo:constraint-violated`。`nudo:interface-domain-exceeds` 覆盖从使用处文件注入的调用记录（`nudo check --from <paths...>`）。

## CI

```bash
nudo check src/
# 任一 error 级诊断 exit 1

# 机器可读（仅单文件）
nudo check src/lib.js --json
```

`nudo check` 是契约与入口 throws 的 CI 门禁 —— 与 `tsc --noEmit` 对齐，但 check **成功时仍打印 signatures**。`--abs` 仍是观察面，但 L1/L2 error 仍门禁。

## 下一步

- [CLI 使用指南](./cli.md) —— 全部一级动词
- [Abs](../concepts/type-values.md) —— `any` 与 `unknown`
- [诊断术语表](../reference/diagnostics.md) —— 稳定诊断码及读法
- [概念分层](../concepts/layers.md) —— Day 0 / Day 1
