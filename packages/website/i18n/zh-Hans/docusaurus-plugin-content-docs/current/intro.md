---
sidebar_position: 1
slug: /intro
description: Nudo 执行 JavaScript，在 check/test 上打印签名，并门禁契约 + 入口 throws。
---

# 简介

**欢迎重回 JS 世界。**

**Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。**

写普通 `.js`。需要义务时再补侧车契约（`*.nudo.js` / `@nudo:refine` / `@nudo:interface`）。即便没有显式契约，导出边界上的 may-throw 仍会被门禁（L2）。

## 读完你能带走

- 观察 vs 义务：`nudo check` 签名 + `nudo test` 用例（没有 `nudo infer` 动词）
- Day-0 / Day-1 分层：先 check/test，需要更强门禁时再 contract
- 可直接跑的命令，以及 Playground 入口

## 从源码到门禁

```javascript
// calc.js
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);
```

```javascript
// calc.nudo.js — 显式义务
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs check calc.js
npx nudojs test calc.js
```

```text
signatures
  formatName(first: any, last: any) => any
  scale(x: any) => any
issues
  (L1) scale(0) → actual 1 #exact ⊭ expected x > 0  (nudo:constraint-violated)

npx nudojs test:
=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"
=== scale ===
  call@L12  (5) => 6
```

在 IDE 里，同一套 Abs 会以 inlay 形式出现在中间值上——不只是返回“类型”。

## Day 0 与 Day 1

| 层级 | 你写什么 | 你得到什么 |
|------|----------|------------|
| **Day 0** | 普通 JS + 调用点 | `nudo check` 签名 · `nudo test` 用例 |
| **Day 1** | `*.nudo.js` / `@nudo:refine` | `nudo check` L1 义务（`actual ⊭ expected`） |
| **生态** | 无需额外 | `nudo export` dts/guard/schema/standard |
| **进阶** | Abs 代数、env、mock | 字符串/数字代数、高阶函数、模块图 |

`@nudo:case` 仍可用于**调试见证**（场景执行、`nudo test`、LSP 用例切换）——它不是契约产品。符号化的 `T.*` case 实参属于遗留语法，已不进入产品叙事。

## 为什么不只是 TypeScript

| | TypeScript | Nudo |
|---|---|---|
| 主产物 | `.ts` 上的声明类型 | 执行 `.js` 得到的观测 Abs |
| 精度 | 常被加宽（`string` / `number`） | 可保留字面量、模板结构、循环求和 |
| 义务 | 类型语言 + 赋值兼容 | L1 显式契约 + L2 入口 throws + Abs 上的 Pred 蕴含 |
| 可观测性 | 悬停显示声明类型 | check 签名 / test 用例 / 悬停可显示 term / pred / conf |
| CI 门禁 | `tsc --noEmit` | `nudo check`（成功时也打印 signatures） |
| 观察命令 | （无 —— hover） | 没有 `nudo infer`；观察是 check/test/IDE 输出 |

`"a,b,c".split(",")` → `["a", "b", "c"]`。声明 `x > 0` 后，`scale` 会带上 `(x + 1) > 1`。这是校验 + 可观测，不是第二套类型语言。

诚实的替代边界：[Nudo vs TypeScript](./guides/vs-typescript.md)。

## 下一步

- **[安装](./getting-started/installation.md)** — CLI、VS Code 扩展、Vite 插件
- **[快速开始](./getting-started/quick-start.md)** — 第一次 check + test
- **[Playground](/playground)** — 浏览器里执行
- **[概念分层](./concepts/layers.md)** — Day-0 / Day-1 / 进阶
- **[nudo check](./guides/check.md)** — Abs 上的精化门禁
- **[指令](./concepts/directives.md)** — `@nudo:refine` / `@nudo:interface` / 侧车
- **[类型值 Abs](./concepts/type-values.md)** — `shape × term × pred × conf`
- **[语言语义](./guides/semantics.md)** — 精确建模与仍会 `unknown` 的构造
