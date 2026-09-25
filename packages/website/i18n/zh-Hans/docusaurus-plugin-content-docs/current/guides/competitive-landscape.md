---
slug: /guides/competitive-landscape
description: Nudo 相对 TypeScript、Flow、Hegel、schema 库与 refinement types 的位置 —— 分工地图，不是功能清单。
---

# 竞争格局

**读完你能带走：** 一张诚实的地图——Nudo 用来做什么、相邻工具已经占了什么、以及什么时候你*不该*伸手拿 Nudo。

定位深潜：[Nudo vs TypeScript](./vs-typescript.md) · 产品面：[为什么选 Nudo](../why-nudo.md) · 引擎不宣称什么：[边界](../concepts/limits.md)。

## 定位地图

Nudo 是一道 **JS 工程门禁**：它通过执行代码计算 Abs 事实，再对照显式契约检查 **Pred 蕴含**。它不是第二套类型语言，不是运行时校验器，也不是定理证明器。

| | 源码里有类型语言 | 源码里没有类型语言 |
|---|---|---|
| **静态 / 编译期门禁** | TypeScript · Flow | **Nudo**（Abs + Pred + `nudo check`）· Hegel（已归档） |
| **运行时 / 边界校验** | — | Zod · ArkType · TypeBox · Valibot |
| **面向证明的精化** | LiquidHaskell / SMT 支撑的 refinement | *（不是 Nudo）* |

两条轴比功能清单更重要：

1. **义务在哪里检查** —— 静态地在 CI 里（`nudo check`），还是在运行时边界上（`parse` / `safeParse`）。
2. **类型是什么** —— 声明式标注 / schema 对象，还是带 Pred 约束的可计算 Abs 值。

## vs TypeScript

TypeScript 是类型化 JS/TS 的默认静态门禁。Nudo 只对 **JavaScript 优先**的包替代那道门——完整地图见 [Nudo vs TypeScript](./vs-typescript.md)。

最锐利的产品边界写在 Microsoft 自己的 [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals) 里。其中的 non-goals 包括：

> Apply a sound or "provably correct" type system. Instead, strike a balance between correctness and productivity.

> Add or rely on run-time type information in programs, or emit different code based on the results of the type system. Instead, encourage programming patterns that do not require run-time metadata.

Nudo 的 **throws** 轴（L2 入口 may-throw）与 **Pred** 轴（Abs 上的约束蕴含）恰好落在这些 non-goals 排除掉的地方：义务来自*运行时形态的行为*，而不只是可擦除的结构标注。那不是 TypeScript 的 bug——那是有意的范围选择。Nudo 取互补的范围。

另外：类型在 TypeScript 里会被擦除。Nudo 把 Abs 留作模型，并把 `.d.ts` 当作**单向、有损投影**（`nudo export --format dts`）。

## vs Flow

Flow 仍在活跃（近期 0.333.x 线、Rust 实现工作、带 `component` / `renders` / `match` 的类型化方言、exact objects、以及 `this` 接收者）。它的差异化是**语法与安全默认值**，不是无标注的契约推断。

| | Flow | Nudo |
|---|---|---|
| 表面 | `.js` / `.jsx` + Flow 标注 | 普通 `.js`（不需要类型语法） |
| 差异化 | 类型化方言、exact objects、检查器默认值 | 契约是可计算 Pred；事实来自**执行**代码 |
| 门禁 | Flow checker | `nudo check`（L1 契约 + L2 入口 throws） |
| 运行时类型 | 擦除 | Abs 保留；运行时产物是 `export` 投影 |

如果你要 Flow 的方言和它的安全默认值，用 Flow。如果你要 JS 保持 JS、义务来自行为加上你接受的契约，用 Nudo。

## vs Hegel

Hegel（GitHub 上的 `JSMonk/hegel`）曾是概念上最近的邻居：**无标注的强推断**，外加 Typed Errors 的想法。**它已于 2024-01-29 归档**；其 README 声明开发已停止。

这留下一个真实的空洞：「为无类型 JS 推断一道类型门禁、又不要求作者写一套类型语言」这个生态位，**没有活跃维护的工具占据**。Nudo 用不同的重心占据这个空洞——Abs 代数、显式侧车契约（`*.nudo.js` / `@nudo:contract`），以及一道打印签名与用例的 CI 门禁。

## vs schema 库（Zod、ArkType、TypeBox、Valibot）

这些库是**边界运行时校验**。它们 `parse` 或 `safeParse` *进入*系统的数据。它们不是对程序内部计算的静态 Pred 蕴含。

:::tip 分工
**schema 管跨边界的数据；Nudo 管内部算出来的事实。**
:::

| | Zod / ArkType / TypeBox / Valibot | Nudo |
|---|---|---|
| 何时 | 在 API / 表单 / IO 边缘 `parse` / `safeParse` | 在 CI 里对逻辑 + 契约跑 `nudo check` |
| 什么 | *进入*数据的形状 | 对*计算*结果的 Pred 义务 + 入口 throws |
| 真理 | schema 对象 | Abs（`shape × term × pred × conf`） |
| 编译期 | schema-as-type 辅助 | 完整 Abs 代数（`x>0` ⇒ `x+1>1`） |

它们可以组合：**`nudo export` 把 Abs 投影进 schema 方言**（Zod 方言、Standard Schema、守卫），让边界代码与 CI 对同一批事实达成一致。投影是单向且有损的——Abs 仍是真理源。见[运行时生成](./runtime-generation.md)。

ArkType 的库文档在 **arktype.io**。（`arktype.org` 是一家无关公司——不要把读者指到那里。）

## vs refinement types（LiquidHaskell 与 SMT 谱系）

LiquidHaskell 及相关系统使用由 SMT 求解器 discharge 的**谓词精化类型**——朝程序证明去。

引擎内部，Nudo 的 Pred 层是*类似的*：精化是 term 上的谓词，且参与蕴含。**对外，不要把 Nudo 描述成定理证明器。** Nudo 是一道 **JavaScript 工程门禁**：

- 没有 SMT 后端，没有证明证书，没有「已验证」宣称
- fail-closed 的求值预算（调用预算、widen 到 `unknown`），而不是把不完备性当作数学性质
- 产品是 CI 诊断、签名、用例和 `export` 投影——不是证明

需要机器检查的证明时，走 refinement-type 谱系。需要 JS 上一道实用的契约门禁时，用 Nudo。

## 什么时候*不要*用 Nudo

只要下列**任何一条**占主导，就留在别处：

1. **类型语言本身就是产品。** 重度泛型 / 条件类型 / 模板字面量类型*编程*、declaration merging、project references → TypeScript。
2. **你要 Flow 的方言或 checker 文化。** 类型化 `component` / `renders` / `match`、默认 exact 的对象类型 → Flow。
3. **你只需要边界 parse。** 对外部 JSON 的一次性校验 → 单靠 Zod / ArkType / TypeBox / Valibot 就够（当内部算术与契约也重要时再加 Nudo）。
4. **你要证明。** 可靠性 /「可证明正确」义务 → LiquidHaskell 式 refinement types，不是 Nudo。
5. **你想要零契约、零调用点的全自动类型。** Nudo 观察它能求值的部分，其余报告 `unknown`；它不发明义务。无约束的入口参数显示为 **`any`**。

## LLM 混合（SCAM 2026）

LLM 类型推断研究（例如 SCAM 2026）适合**混合**回路，而不是替代确定性门禁：

1. **LLM 起草** —— 从代码或散文生成契约（`*.nudo.js`）、`@nudo:contract`，或 `@nudo:case` 场景。
2. **Nudo 检查** —— `nudo check` / `nudo test` 用 Abs 代数做决定（CI 时刻不做采样）。
3. **修复** —— 机器可读的 `check --json`（`actual` / `expected` / `fix:` / `actions[]`）喂给下一轮草稿。

草稿从来不是静默义务：接受一份契约草稿，才会产生 L1 义务。见 [AI-native DX](./ai-native-dx.md) 与 [Agent 集成](./agent-integration.md)。

## 相关

- **[Nudo vs TypeScript](./vs-typescript.md)** —— Nudo 何时替代 `tsc`
- **[为什么选 Nudo](../why-nudo.md)** —— 产品面
- **[运行时生成](./runtime-generation.md)** —— `export` → Standard Schema / Zod / 守卫 / `.d.ts`
- **[nudo check](./check.md)** —— L1 契约 + L2 入口 throws
- **[边界](../concepts/limits.md)** —— 引擎不宣称什么
- **[心智模型](../getting-started/mental-model.md)** —— 10 分钟
