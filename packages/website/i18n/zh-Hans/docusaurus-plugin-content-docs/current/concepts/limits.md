---
slug: /concepts/limits
description: 诚实边界与非目标 —— Nudo 不宣称什么、调用点上限，以及何时仍应以 TypeScript 为主。
---

# 边界与非目标

**读完你能带走：** 哪里 Nudo 是合适的 JS-first 门禁、哪里不是，以及哪些边界是产品纪律（不是 bug）。

年轻的工具靠明确边界赢得信任。本页是面向用户的边界摘编 —— 完整工程笔记在 monorepo（`docs/design/limitations.md`）。

## 非目标

1. **不是 TypeScript 编译器。** Nudo 不重实现 `tsc` 的工程引用、声明合并或完整可赋值性。
2. **不从 body-AST 发明槽位。** 义务来自显式契约（`*.nudo.js` / `@nudo:contract`）或调用点事实 —— 绝不通过扫描函数体「必填字段」产生 check 错误。
   - **`nudo:missing-slot` 是观察，不是义务。** 打开 `analysis.evalMissingSlot: "warning"`（默认 `"off"`）时，求值实际命中已知 shape 缺字段只发 **warning** —— 绝不凭空产生 check 错误；契约仍经 `nudo:constraint-violated` 门禁。
3. **`@nudo:case` 仅调试。** 它喂 `nudo test` / LSP 场景，不是契约产品。
4. **`check` 只校验。** 产物（`.d.ts`、Zod、guards）来自 `nudo export` —— Abs 的单向有损投影。
5. **HOF promote ≠ check 错误。** HOF 关系的 body 用法提升是 **warning**（建议）。只有显式 refine / relation 契约才是 L1 错误。
6. **没有观察动词。** 签名与用例从 `check` / IDE 打印；产品没有 `nudo infer` 动词。

## `any` 与 `unknown`

无约束入口参数显示为 **`any`**；真 `unknown` 表示推导失败（引擎债）。完整契约（来源、运算、窄化）：[Abs — any vs unknown](./type-values.md#any-vs-unknown)。


## 调用点发现上限

`--from` 挖掘使用证据。诚实边界：

| 类别 | 行为 |
|----------|----------|
| 运行时 / 原生回调 | 无调用记录 → `entry@` 回退 |
| 测试从未触及的函数 | `entry@`（`any` 参数）—— 覆盖缺口，不是推导失败 |
| 嵌套函数 | 不从外层调用记录归因（正确性优先） |
| 双入口包 | browser/node 记录不跨文件。**现已上信号** —— 分析/check 其一入口变体时发 `nudo:dual-entry`（info；单入口包零误报）。仍是天花板，只是不再静默 |
| 动态 `require` / 原生 | 字面量 / 常量折叠子集已解析；计算说明符诚实 `unknown`。Env 可为名称提供类型；副作用需要 mock |

## 求值器缺口（摘要）

部分构造仍会退化为 `unknown`（带引擎债诊断）。优先使用[语言语义](../concepts/semantics.md)中已建模的替代：例如 `Object.keys` 而非 `Object.prototype` 方法、对 `new Promise` 内部用 `@nudo:mock` + 异步包装。

Env harvest 覆盖率**不是**完备性承诺。

**`/// @nudo:env <name>` 命名 env 会同时注入 `check` 与 `test` 路径。** 命名 env（`es` / `web` / `node`）注入符号面，`nudo check` 与 `nudo test` 打印一致的签名。不碰 env API 的函数不受牵连。当 env 无法解析（例如 path 型 `@nudo:env ./missing.ts`）时，只有实际引用自由标识符（env 提供的全局名）的函数 fail-closed 为 `unknown`——纯函数保持精确。

## Pred 蕴含（有界）

`nudo check` 的 L1 门禁是 Abs 上的 Pred 蕴含（`actual ⊭ expected`）。内建判定**故意有界** —— 覆盖线性片段与等式类目标，不是全部算术：

| 片段 | 内建 |
|----------|----------|
| 线性形（`+` / `-` / `*const`）、跨项区间合成 | 是 |
| 等式类（`x = y`）、`ne` 收紧为严格界 | 是 |
| 合取目标；and/or 交换律相等 | 是 |
| 非线性（`x * y`、幂）/ 量词 | **故意不完整** —— fail-closed |

内建证不出时，目标直接不抬升。嵌入方可选外接：

```js
import { setImplicationOracle, getImplicationOracle } from "@nudojs/core";

// ImplicationOracle = (phi, pred) => boolean | undefined
// true → 抬升目标；false / undefined → 保持 fail-closed
setImplicationOracle((phi, pred) => mySolverImplies(phi, pred));
```

- **默认关闭。** Nudo 不带 solver 依赖；内建片段才是产品门禁。仅当内建证不出时才调 oracle，且只有返回 `true` 才抬升。
- **Power feature，不是对外产品面。** 对外 Nudo 是一道 JS 工程门禁 —— 不是定理证明器 / SMT 产品。没有证明证书，没有「已验证」宣称。
- **两边都 fail-closed。** 没有 oracle（或返回 `false` / `undefined`）时，证不出的目标就保持未证。

这道门禁所在的代数：[Abs](./type-values.md)。为什么这不是 prover：[竞争格局](../guides/competitive-landscape.md)。

## 何时应继续以 TypeScript 为主

- 代码库是 `.ts`-first，标注/泛型就是产品
- 你需要完整 TS 类型语言（条件/映射类型作为编程）
- 生态是 DefinitelyTyped / 工程引用
- 你需要的门禁语义是「像 tsc 一样赋值」

诚实地图：[Nudo vs TypeScript](../guides/vs-typescript.md)。共存：[指南](../guides/coexistence.md)。

## 什么是有纪律的产品行为（不要当 bug「修掉」）

- 成功时 `check` 仍打印 `signatures`（不静默）
- L2 只门禁**入口/导出** may-throw，不管每个内部 helper
- 草稿绝不自动绑定为契约
- 投影绝不回读进分析

## 下一步

- [Abs](./type-values.md)
- [nudo check](../guides/check.md)
- [诊断](../reference/diagnostics.md)
- [vs TypeScript](../guides/vs-typescript.md)
