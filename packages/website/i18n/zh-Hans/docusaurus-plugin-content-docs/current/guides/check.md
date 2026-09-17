---
sidebar_position: 8
slug: /guides/check
description: nudo check — Abs 上的精化、赋值与传参结构门禁（类型即计算）。
---

# nudo check

`nudo check` 是 Nudo 在 **Abs 上的精化门禁**（类型即计算）。精化用 `@nudo:refine` 声明——Pred 进入 Abs 并参与代数。报告是 **Nudo 原生格式**（`actual ⊭ expected`），不是 TypeScript 诊断换皮。

```bash
npx nudojs check path/to/file.js
# 有 error 则退出码 1
```

## 检查什么

| code | 含义 |
|------|---------|
| `nudo:constraint-violated` | 调用/返回 ⊭ `@nudo:refine`（标量界 / shape 字段） |
| `nudo:assign-mismatch` | 赋值 ⊭ 原有绑定形状（`leqAbs`） |
| `nudo:arg-structure` | HOF：实参不是可调用 `fn` / arity 不匹配（**不是** body slot 推断） |
| `nudo:case-inconsistency` | `@nudo:case` 见证 ⊭ refine |
| `nudo:interface-param-mismatch` | 手写契约参数名不在形参表面（C4.5；默认参名/rest 裸名/解构绑定名合法） |
| `nudo:interface-conflict` | 手写契约合取不可满足（如 `x > 0 ∧ x < 0`） |
| `nudo:no-signature` | 无法归纳符号 Abs |
| `nudo:opaque-result` | 求值结果不透明 / 无信息 |
| `nudo:eval-error` | 函数体求值抛错 |
| `nudo:recursion-truncated` | 递归预算截断，结果 widen |
| `nudo:may-throw` | 路径可能抛出（warning） |
| `nudo:unreachable` | return/throw 之后不可达（info） |

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [ERROR] needsPositive[x]: 实参 ⊭ 前置
//   actual:   -1  #exact
//   expected: x > 0

let a = { x: 1 };
a = { y: 2 };
// [ERROR] a: 赋值 ⊭ 原有形状  (nudo:assign-mismatch)

// 结构义务来自显式 shape 契约，不是 body AST 扫描
/// @nudo:import { xy } from "./shapes.nudo.js"
/**
 * @nudo:refine p xy
 */
function readXY(p) { return p.x + p.y; }
readXY({ x: 1 });
// [ERROR] readXY[p]: 实参 ⊭ 前置  (nudo:constraint-violated)
// 无 refine 时同调用合法（调用点事实 / any）
```

**`if` 不是精化。** Clamp 式守卫接受越界输入：

```js
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — 未声明 @nudo:refine
```

它 **不** 替代 `tsc` 的完备结构检查。它做 tsc 在无注解 JS 上做不到的事：**声明式精化进入代数**，外加赋值/实参上的 **Abs leq**。

## interface 诊断

`*.nudo.js` 侧车契约（与生成的 `@generated` 段）有独立诊断族，按**执法分档**：手写 = 义务（**error**）；生成段 = 事实快照会漂移（**warning**）；观察到的调用点域本身永不执法。

| code | severity | 触发条件 |
|------|----------|---------|
| `nudo:interface-cycle` | error | 侧车互相 import 成环 |
| `nudo:interface-load` | error | 侧车加载/求值失败，或导出形态不识别 |
| `nudo:interface-param-mismatch` | error | 契约参数名 ∉ 形参表面（C4.5；默认参名/rest 裸名/解构绑定名合法） |
| `nudo:interface-conflict` | error | 源码 `@nudo:refine` 与侧车绑定同参（或返回位）矛盾（`x > 0 ∧ x < 0`）；矛盾位跳过执法，不把契约层矛盾误诊为函数体违例 |
| `nudo:interface-domain-exceeds` | error | **跨文件**注入的调用证据 ⊄ **手写**契约（接口被用穿） |
| `nudo:interface-drift` | warning | 固化的 `@generated` 段 ≠ 今日重算接口（语义比较，参数位与返回位）。`nudo doctor` 对侧车已含 `@generated` 的文件把同一 drift 作为 CI 门禁 |
| `nudo:interface-name-clash` | error | `nudo interface --emit` 目标名已是侧车手写绑定（手写优先，跳过写入） |
| `nudo:interface-underivable` | info | root 下行推不出下游契约（opaque / 截断 / 无证据）——只作 skip，不写垃圾 |

违例来源分流：写在**被分析文件里**的违例调用维持 `nudo:constraint-violated` 原码原语义；`nudo:interface-domain-exceeds` 只覆盖此前不查契约的路径——从使用现场文件注入的调用记录（`--callsites`）。证据门槛：字面量实参、conf `#exact`/`#path`、无截断记录。

示例（各自独立 fixture 目录实跑）：

```text
issues
  [ERROR] sidecar './cyc.nudo.js' for 'f' failed: sidecar import cycle: /tmp/…/cyc.nudo.js → /tmp/…/cyc2.nudo.js → /tmp/…/cyc.nudo.js  (nudo:interface-cycle)
```

```text
issues
  [ERROR] sidecar './broken.nudo.js' for 'broken' failed: Unexpected token, expected "," (2:0)  (nudo:interface-load)
```

```text
issues
  [ERROR f] f: 手写契约合取不可满足（x）  (nudo:interface-conflict)
      → 检查源码 @nudo:refine 与侧车同名绑定的常数界是否矛盾
```

```text
Diagnostics:

  [error] lib.js:1:7 clamp[x]: cross-file call-site domain evidence "hot" exceeds handwritten contract (nudo:interface-domain-exceeds)
```

```text
issues
  [WARNING L5 half] half[n]: 固化生成段 ≠ 今日调用点域  (nudo:interface-drift)
      actual:   number  = n  where n = 12  #path
      expected: lit(10)
      → 重跑 nudo interface --emit 刷新生成段，或核对 n 的调用点
  [WARNING L5 half] half[return]: 固化生成段 ≠ 今日推断返回  (nudo:interface-drift)
      actual:   number  = return  where return = 6  #path
      expected: lit(5)
      → 重跑 nudo interface --emit 刷新生成段，或核对返回值
```

drift warning 不使 `nudo check` 失败（退出码 `0`）。分码覆盖：`nudo:interface-drift` 与 `nudo:interface-domain-exceeds` 钉在 check-gold 夹具；`nudo:interface-load` / `nudo:interface-cycle` / `nudo:interface-conflict` 由 wiring、loader 与 emitter 套件覆盖（`check-interface-wiring`、`refine-loader`、`interface-emitter`）；`nudo:interface-name-clash` 在 emitter/agent 套件。契约形态见 [@nudo:refine](../concepts/directives.md#nudorefine--refinement-contract)。

## 报告形态（Abs 优先）

```
nudo check  file.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  needsPositive(x)  number  = x  where x > 0  #path
    number
    term: x
    pred: x > 0
    conf: path

issues
  [ERROR L12 needsPositive] needsPositive[x]: 实参 ⊭ 前置  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: x > 0
```

签名携带 **无损 Abs**（`shape` / `term` / `pred` / `conf`）。可选 `.d.ts` 输出是 TypeScript 生态 **兼容侧信道**，不是主线。

## 调用点覆盖

| 形态 | 示例 |
|---------|---------|
| 直接 | `needsPositive(-1)` |
| 别名 | `const f = needsPositive; f(-1)` |
| 对象属性 | `const api = { needsPositive }; api.needsPositive(-1)` |
| 无条件转发 | `function w(a) { return target(a); }` → `w(lit)` |
| CJS require | `const { fn } = require('./m')` |
| ESM import | `import { fn as x } from './m'` |
| 动态 import | `const { fn } = await import('./m')` |
| barrel（一跳） | `export { fn } from './v.js'` |
| 实参结构（HOF） | 回调实参须为可调用 `fn` 且 arity 匹配 |
| shape 契约 | 声明的 `shape({…})` vs 字面量 / 标识符实参 |

## 质量门禁

| 门禁 | 位置 | 标准 |
|------|--------|-----|
| 人工标注 recall | `check-recall-gold.test.ts` | recall = precision = **1.0** |
| shape 精化 | `check-shape-gold.test.ts` | 字段 / optional / 数值界 |
| case vs refine | `check-case-consistency.test.ts` | 见证 ⊆ D |
| 真实包精度 | `check-real-packages.test.ts` | commander / escape-string-regexp / is-plain-obj / debug / yocto-queue / p-limit / kleur / eventemitter3 / ms / lodash 零误报 |

## 编辑器集成

LSP **优先发布 `nudo-check` 诊断**（带 `actual` / `expected` 的 Abs 违例），然后才是评估器诊断（`source: nudo`）。Hover 与 inlay 读无损 Abs——中间不经过有损投影。

Agent 通过 **`nudo.check`**（CheckJson v1）使用同一门禁——见 [Agent API](../api/agent.md#nudocheck)。

## Service Abs 路径边界

`nudo check`（及 `checkSource`）始终在 Abs 上分析，含跨文件 require/import 转发。

**service 求值路径**（`infer` 用例输出、`call@` 合成、JSON `intension`）对被分析文件**自身定义**的函数始终走 Abs——即使该文件有 import。本地函数的每个 case 都带 `intension:` / `abs:` 行（见 [`docs/examples/mini-repo/user-service.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/mini-repo/user-service.js)：带 import 的文件，其 `fetchUser(7)` case 报告 `abs: promise<{ id: 7, name: "u7" }>  #path`）。来自**导入模块**的函数（`externalFunctions`、`--- path (imported) ---` 区块）只带调用证据——case 头，无 `intension`。`@nudo:mock` **不会**禁用 Abs——mock 会编译为 Abs seed。契约违例始终由 `nudo check` 捕获。

另见 monorepo `docs/nudo-check.md` 与 `docs/ci-nudo-check.md`。
