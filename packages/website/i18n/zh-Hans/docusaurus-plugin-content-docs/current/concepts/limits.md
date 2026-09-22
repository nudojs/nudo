---
slug: /concepts/limits
description: 诚实边界与非目标 —— Nudo 不宣称什么、调用点上限，以及何时仍应以 TypeScript 为主。
---

# 边界与非目标

**读完你能带走：** 哪里 Nudo 是合适的 JS-first 门禁、哪里不是，以及哪些边界是产品纪律（不是 bug）。

年轻的工具靠明确边界赢得信任。本页是面向用户的边界摘编 —— 完整工程笔记在 monorepo（`docs/design/limitations.md`）。

## 非目标

1. **不是 TypeScript 编译器。** Nudo 不重实现 `tsc` 的工程引用、声明合并或完整可赋值性。
2. **不从 body-AST 发明槽位。** 义务来自显式契约（`*.nudo.js` / `@nudo:refine`）或调用点事实 —— 绝不通过扫描函数体「必填字段」产生 check 错误。
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
| 双入口包 | browser/node 记录不跨文件 |
| 动态 `require` / 原生 | Env 可为名称提供类型；副作用需要 mock |

## 求值器缺口（摘要）

部分构造仍会退化为 `unknown`（带引擎债诊断）。优先使用[语言语义](../concepts/semantics.md)中已建模的替代：例如 `Object.keys` 而非 `Object.prototype` 方法、对 `new Promise` 内部用 `@nudo:mock` + 异步包装。

Env harvest 覆盖率**不是**完备性承诺。

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
