---
sidebar_position: 9
slug: /guides/vs-typescript
description: Nudo 何时替代 TypeScript、何时不替代、以及两者如何共存——诚实定位。
---

# Nudo vs TypeScript

Nudo 的目标是：**在 JavaScript 优先的代码库里，替代 TypeScript 作为日常类型门禁**——而不是重写一遍 tsc。本文说明何时这种替代成立、何时不成立，以及两者如何共仓。

## 定位

| | TypeScript | Nudo |
|---|---|---|
| **主表面** | `.ts` + 类型标注 | 纯 `.js`（传入 `.ts` 会剥掉类型语法） |
| **类型模型** | 声明式结构类型 | **Abs**（`shape × term × pred × conf`），可计算 |
| **契约** | `interface` / `type` 语言 | `*.nudo.js` 构建器（`fn` / `shape` / `number().gt(0)`）+ 可选 `@nudo:refine` |
| **推断** | 标注 + 局部推断 | **在符号 Abs 上执行代码**（B-path / ast-eval） |
| **CI 门禁** | `tsc --noEmit` | `nudo check`（Abs 上的 `actual ⊭ expected`） |
| **生态出口** | `.d.ts` 即模型 | `.d.ts` 是**有损投影**（`absToTSType`），不是真理源 |

目标不是「在 JS 上写 TS 语法」，而是：**JS 保持 JS**；义务只来自显式 interface 或调用点事实；引擎用求值推理，而不是第二门类型语言。

## 何时 Nudo 是正确的替代

以下条件**同时**成立时，优先 Nudo：

1. **包是 JS 优先**，不想为了类型再养第二套 IR（`.ts` + 标注）。
2. **行为比声明形状更重要**：分支、字符串代数、循环、精化比「结构是否匹配 interface」更关键。
3. **契约是产品要求**：CI 要 `nudo check`——界、shape 义务、HOF arity，来自侧车，而不是 body AST 扫描。
4. **拒绝第二门类型语言**：契约是类 JSON 的构建器，不是 `interface` / 映射 / 条件类型。

常见契合：工具链 CLI、脚本层、插件宿主、纯 JS 数据管道；测试丰富的仓库（便于调用点挖掘）。

## 何时应继续以 TypeScript 为主

以下情况**不要**指望 Nudo 替代 `tsc`：

1. **代码库是 `.ts` 优先**：标注、泛型、TS 语言服务就是产品本身。Nudo 能读剥掉类型的 TS，但不是 TS 编译器克隆。
2. **需要完整 TS 类型语言**：条件类型、模板字面量类型*编程*、declaration merging、全工程结构可赋值性是**非目标**。
3. **生态是类型化包**：Definitely Typed 风格 API、与第三方 `.d.ts` 的合并、`tsc` project references 仍在 TS 侧。
4. **门禁语义是「是否像 TS 那样赋值」**：Nudo 的门禁是 Abs 上的 Pred 蕴含与部分 `leqAbs`，不是 TS 可赋值性的逐位复刻。

这些情况真实存在。把 `nudo check` 指向整个 TS monorepo 不是产品路径。

## 这里的「替代 TypeScript」指什么

对 **JS 包**，严肃替代清单：

| 能力 | Nudo 路径 |
|---|---|
| 打开普通 `.js` 即有 hover / inlay | LSP + `package.json#nudo.analysis.mode`（默认 `directives`；可 `exports` / `all`） |
| CI 类型门禁 | `nudo check`——`error` 即退出码 1 |
| 显式契约 | `*.nudo.js` + `@nudo:refine`；手写 = 义务 |
| 生成事实 | `nudo interface --emit` → `@generated` 段（drift，不静默改写义务） |
| npm / 编辑器类型 | `nudo emit` / infer `--dts`——仅投影 |
| 性能叙事 | `benchmark` CI gate（cold / warm / LS-invalidated） |

**不宣称**：大型 TS monorepo 一键迁移；以完整结构类型为主模型；第二套 IR。

## 对照示例

**TypeScript（声明式）：**

```ts
export function needsPositive(x: number): number {
  return x > 0 ? x : 0;
}
needsPositive(-1); // tsc 允许
```

**Nudo（契约 + 门禁）：**

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
export function needsPositive(x) {
  return x > 0 ? x : 0;
}

needsPositive(-1);
// nudo check → nudo:constraint-violated
//   actual:   -1  #exact
//   expected: x > 0
```

TypeScript 把意图写在签名里；Nudo 把同一义务编码成**可计算**约束并让调用点失败。两者都合法；只有一者需要类型语言。

## 共存

Monorepo 里通常**按包拆分**，而不是在一个 TS 工程内部按特性拆：

- JS 包 → Nudo LSP + `nudo check`
- TS 包 → 仍用 `tsc` / ts-node

配方（include/exclude、渐进契约、CI 片段）：**[与 TypeScript 共存](./coexistence.md)**。

## 相关

- **[概念分层](../concepts/layers.md)** — Day-0 / Day-1 / Abs
- **[nudo check](./check.md)** — 诊断码与 interface 分档
- **[语言语义](./semantics.md)** — 何处精确、何处降级为 `unknown`
- **[快速上手](../getting-started/quick-start.md)** — 30 分钟路径
