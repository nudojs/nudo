---
sidebar_position: 1
slug: /intro
description: Nudo 是面向 JavaScript 的类型推断引擎——类型系统是 Abs（可计算值）；检查义务只来自 @nudo:refine / *.nudo.js 侧车契约。
---

# 简介

**Nudo** 是面向 JavaScript 的类型推断引擎。类型系统是 **Abs**（`shape × term × pred × conf`）：类型是可计算的值，约束参与代数（`x>0` ⇒ `x+1>1`）。生产分析路径是 Abs 原生——没有第二套 IR。也接受 TypeScript 源码：类型标注会被剥除，代码按纯 JS 语义推断。

## 工作原理

Nudo 在抽象解释下**执行**你的代码（B-path transpile+exec，必要时回落 ast-eval）。调用点事实驱动求值；可选的 `@nudo:case` 见证仅用于调试 / `nudo test`；引擎产出 Abs，按扩展面渲染用于展示（`formatShape`），需要时单向投影到 `.d.ts` / zod。

`nudo check` 的**义务**只来自显式契约：

- 源旁侧车模板 `*.nudo.js`（约束构建器：`number().gt(0)`、`shape({...})`、`fn({...}, …)`）
- 源内 `@nudo:refine` / `@nudo:interface`（同一约束语法；主产品路径是侧车）

无契约、无调用点证据 → `any` / 诚实的 `unknown`。Nudo **不会**从 body AST 扫描发明必填字段。

## Nudo 与 TypeScript

| TypeScript | Nudo |
|------------|------|
| 事先声明类型，编译器检查使用 | 写普通 JavaScript，引擎执行并推断 Abs |
| 需要 `.ts` 文件或 JSDoc 注解 | 侧车契约（`*.nudo.js` / `@nudo:refine` / `@nudo:interface`）可选；`@nudo:case` 仅调试 |
| 类型描述意图 | 推断 Abs 描述观察到的行为；契约描述义务 |

**示例：调用点 + 侧车契约**

```javascript
// process.js
export function process(x) {
  return x * 2;
}

process(5);
```

```javascript
// process.nudo.js —— 义务（check 门禁）
import { number, fn } from "@nudojs/core";
export const process = fn({ x: number().gt(0) }, number());
```

`nudo infer` 报告观测到的调用点（`call@L5: (5) => 10`）。`nudo check` 执法侧车：`process(0)` 报 `nudo:constraint-violated`（`actual ⊭ expected`）。可选的 `@nudo:case` 见证（`number()` 等约束构建器）**仅用于调试 / `nudo test`**——不是契约产品；分析始终跑在 Abs 上。

## 超越 TypeScript

Nudo 可以计算 TypeScript 类型系统难以表达的类型：

```javascript
// 字符串拼接保留结构
"0x" + string                   // → `0x${string}`（TS: string）

// 字面量字符串方法结果精确
"hello".toUpperCase()          // → "HELLO"（TS: string）
"hello".slice(1, 3)           // → "el"（TS: string）
"a,b,c".split(",")            // → ["a", "b", "c"]（TS: string[]）

// 循环在 Abs 上求值
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// sum → 10（TS: number）
```

同一套代数也支撑 **[`nudo check`](./guides/check.md)** —— Abs 上的精化门禁。报告使用 `actual ⊭ expected`，不是 TypeScript 诊断文案。TypeScript `.d.ts` 输出只是生态兼容通道，不是主类型模型。

## 下一步

- **[安装](./getting-started/installation.md)** — 安装 CLI、VS Code 扩展和 Vite 插件
- **[快速开始](./getting-started/quick-start.md)** — 在第一个文件上运行 `nudo infer`
- **[概念分层](./concepts/layers.md)** — Day-0 / Day-1 侧车 / 进阶 Abs
- **[Nudo vs TypeScript](./guides/vs-typescript.md)** — 何时可替代、何时不替代、如何共存
- **[与 TypeScript 共存](./guides/coexistence.md)** — monorepo 配方（JS=Nudo，TS=tsc）
- **[类型值 Abs](./concepts/type-values.md)** — shape × term × pred × conf
- **[调用点发现](./guides/callsite-discovery.md)** — 让 Nudo 从你的测试中挖掘真实调用形状
- **[nudo check](./guides/check.md)** — Abs 上的精化门禁
- **[语言语义](./guides/semantics.md)** — Nudo 精确建模的 JavaScript 行为，以及仍会退化为 `unknown` 的构造
