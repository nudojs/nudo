---
slug: /why-nudo
description: 为什么选 Nudo — 观察 JS 实际算出什么，不改写也能门禁契约，并把 Abs 投影到生态。
---

# 为什么选 Nudo

**欢迎重回 JS 世界。**

Nudo 面向**逻辑写在 JavaScript 里**的团队：需要**诚实的观察**与**显式的义务**，又不想把代码整仓改写成另一种语言表面。

## 你能得到什么

| 你需要 | Nudo |
|--------|------|
| 看清代码实际算出了什么 | `nudo check` 签名 · IDE 对 Abs 的 hover / inlay |
| 在 CI 里门禁 API 义务 | 侧车契约 → `nudo check`（`actual ⊭ expected`） |
| JS 仍是 JS | 逻辑是普通 JS；契约也是普通 JS 模块（`*.nudo.js`） |
| 给 TypeScript / Zod / mock 用 | `nudo export` 从 Abs 单向投影 |

`nudo check` **只负责校验**。`.d.ts`、Zod、Standard Schema、guards 等产物来自 **`export`**，不是校验器生成的。

## 两种工作模式

Nudo 不强迫你只有一种流程：

| 工作模式 | 顺序 | 常见场景 |
|----------|------|----------|
| **逻辑优先** | 先写逻辑与调用 →（可选）`contract --draft` → 审阅 → 落盘 `*.nudo.js` | 存量 JS 包、迁移、测试较全 |
| **契约优先** | 先写契约 / `@nudo:refine` → 在同一契约面下写逻辑 | 新 API、想尽早锁住的公开面 |

两种模式汇到**同一套 Abs 契约面**（`shape × term × pred × conf`）。`check` 校验该契约面，不会替你发明类型。

侧车 `*.nudo.js` 是**普通 JS 模块**——契约不引入第二套编程语言。

## 为什么不是「只加标注」

标注说的是你*写了*什么。Nudo 的引擎在抽象值上**执行**逻辑，从执行中记录事实（term、pred、conf）。调用点是证据。

```js
// logic.js
export function lineTotal(price, qty) {
  return price * qty;
}

// cart.nudo.js — 契约（同样是 JS）
import { number, fn } from "@nudojs/core";
export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check logic.js --from calls.js
```

- 无约束入口参数显示为 **`any`**（不是 `unknown`）。
- 违例在 Abs 上打印 **`actual ⊭ expected`**。
- 之后可用 `export` 投影 `.d.ts` / Zod / Standard Schema——**有损视图**，Abs 仍是真源。

诚实对比：[Nudo 与 TypeScript](./guides/vs-typescript.md)。

## 工作模式 → 生态

```text
逻辑优先 ──► 契约草稿 ──► *.nudo.js ──┐
                                       ├──► nudo check（只校验）
契约优先 ──► *.nudo.js / refine ───────┘         │
                                                  ▼
                         Abs（唯一真源）──► nudo export ──► .d.ts
                                                  │            Zod
                                                  │            Standard Schema
                                                  └──► IDE / LSP · Agent / MCP
```

## 谁更适合细看

- **JS-first 包**：不想为「类型门禁」整仓迁 TS
- 更在意**运行时形状义务**（边界、shape、入口 throws），而不是标注文风
- 需要 CI 检查与 **mock / schema** 出自同一套事实的流水线

更应让 TypeScript 做主的：标注优先的 `.ts` 代码库、重度泛型/条件类型编程、以 `tsc` 工程引用为中心的生态。见 [与 TypeScript 对比](./guides/vs-typescript.md)。

## 下一步

- [介绍](./intro.md) — 产品面 + 如何使用这些文档
- [快速开始](./getting-started/quick-start.md)
- [nudo contract](./guides/contract.md)
- [Recipes](./guides/recipes.md)
- [边界](./concepts/limits.md)
- [迁移现有 JS](./guides/migrating-js.md)
- [Playground](/playground)
