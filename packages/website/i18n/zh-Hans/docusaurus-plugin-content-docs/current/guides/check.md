---
sidebar_position: 8
slug: /guides/check
description: nudo check — Abs 上的精化、赋值与传参结构门禁（类型即计算）。
---

# nudo check

`nudo check` 是 Nudo 在 **Abs 上的精化门禁**（类型即计算）。精化用 `@nudo:refine` 声明——Pred 进入 Abs 并参与代数。报告是 **Nudo 原生格式**（`actual ⊭ expected`），不是 TypeScript 诊断换皮。

```bash
npx tsx packages/cli/src/index.ts check path/to/file.js
# 有 error 则退出码 1
```

## 检查什么

| code | 含义 |
|------|---------|
| `nudo:constraint-violated` | 调用/返回 ⊭ `@nudo:refine`（标量界 / shape 字段） |
| `nudo:assign-mismatch` | 赋值 ⊭ 原有绑定形状（`leqAbs`） |
| `nudo:arg-structure` | 实参结构 ⊭ body 访问的 slot（`p.foo`） |
| `nudo:case-inconsistency` | `@nudo:case` 见证 ⊭ refine |

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

function readXY(p) { return p.x + p.y; }
readXY({ x: 1 });
// [ERROR] readXY[p]: 实参结构 ⊭ 形参  (nudo:arg-structure)
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

## 报告形态（Abs 优先）

```
nudo check  file.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  needsPositive(x)  number  = x  where x > 0  #path

issues
  [ERROR L12 needsPositive] needsPositive[x]: 实参 ⊭ 前置
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
| 实参结构 | 字面量 `{…}` 或标识符绑定 vs `p.foo` slot |

## 质量门禁

| 门禁 | 位置 | 标准 |
|------|--------|-----|
| 人工标注 recall | `check-recall-gold.test.ts` | recall = precision = **1.0** |
| shape 精化 | `check-shape-gold.test.ts` | 字段 / optional / 数值界 |
| case vs refine | `check-case-consistency.test.ts` | 见证 ⊆ D |
| 真实包精度 | `check-real-packages.test.ts` | commander / debug 等零误报 |

## 编辑器集成

LSP **优先发布 `nudo-check` 诊断**（带 `actual` / `expected` 的 Abs 违例），然后才是评估器诊断（`source: nudo`）。Hover 与 inlay 读无损 Abs——不走有损 TypeValue bridge。

Agent 通过 **`nudo.check`**（CheckJson v1）使用同一门禁——见 [Agent API](../api/agent.md#nudocheck)。

## Service Abs 路径边界

`nudo check`（及 `checkSource`）始终在 Abs 上分析，含跨文件 require/import 转发。

**service 求值路径**（`call@` 合成、hover 内涵、entry 重求值）仅对**自包含**源码优先 Abs：无 `import`/`require`、无 `@nudo:env`。`@nudo:mock` **不会**禁用 Abs——mock 会编译为 Abs seed。含 import 的文件在这些视图上回落 TypeValue 求值器；契约违例仍由 `nudo check` 捕获。

另见 monorepo `docs/nudo-check.md` 与 `docs/ci-nudo-check.md`。
