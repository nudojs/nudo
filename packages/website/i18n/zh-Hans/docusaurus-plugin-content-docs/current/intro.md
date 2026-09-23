---
slug: /intro
description: Nudo 执行 JavaScript，在 check 上打印签名，并门禁契约 + 入口 throws —— 比声明类型更精确。
---

# 简介

**欢迎重回 JS 世界。**

你的 JS 仍是 JS。**Nudo** 不限制你如何写 JavaScript —— 它忠实观察中间值与结果，并执法比普通 TypeScript 类型更精确的**契约**。

写普通 `.js`。需要义务时再补侧车契约（`*.nudo.js` / `@nudo:refine`）。即便没有显式契约，导出边界 may-throw 仍会被门禁（L2）。入口无约束参数显示为 **`any`**；真 **`unknown`** 表示推导失败。

**产品面：** Day 0 = `nudo check`（签名 + 门禁）。Day 1 = `nudo contract` + `nudo check`。生态 = `nudo export`。观察是 check 签名 + IDE hover —— **没有**观察动词。`nudo test` 是可选的调试用例报告器，不是主路径。

## 如何使用这些文档

| 你是 | 从这里开始 |
|---------|------------|
| 评估类型/CI 门禁的 JS 工程师 | [快速开始](./getting-started/quick-start.md) → [nudo check](./guides/check.md) |
| TypeScript 用户 | [Nudo vs TypeScript](./guides/vs-typescript.md) → [从 TS 迁移](./guides/migrating-from-typescript.md) |
| 现有 JS 包 | [迁移现有 JS](./guides/migrating-js.md) → [契约](./guides/contract.md) |
| CI / 平台 | [Recipes](./guides/recipes.md) → [诊断](./reference/diagnostics.md) |
| AI 编码 agent / 工具链 | [Agents](./reference/agents.md) → [Agent integration](./guides/agent-integration.md) → [API · agent](./api/agent.md) |

非目标：Nudo **不是** TypeScript 编译器；不从 body AST 扫描发明必填槽；`@nudo:case` 仅调试，绝不是契约产品。见[边界](./concepts/limits.md)。

## 从源码到门禁

```javascript verify
// calc.js
export function scale(x) {
  return x + 1;
}

scale(5);
```

```javascript verify-sidecar
// calc.nudo.js — 显式契约（义务）
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs check calc.js
```

```text
signatures
  scale(x: number) => number
```

若有违例调用 `scale(0)`：

```text
issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
```

[在 Playground 打开这个想法](/playground)。

在 IDE 中，同一套 Abs 以 inlay 形式出现在中间值上 —— 不只是返回「类型」。

## Day 0 与 Day 1

| 层级 | 你写什么 | 你得到什么 |
|-------|----------------|--------------|
| **Day 0** | 普通 JS + 调用点 | `nudo check` 签名 + L2 入口 may-throw |
| **Day 1** | `*.nudo.js` / `@nudo:refine` | `nudo check` L1 义务（`actual ⊭ expected`） |
| **生态** | 无需额外 | `nudo export` dts / guard / schema（Abs 的有损投影） |
| **进阶** | Abs 代数、env、mock | 字符串/数字代数、高阶函数、模块图 |

`@nudo:case` 仍可作为场景执行的**调试见证**（`nudo test`、LSP 用例切换）—— 它不是契约产品。

## 为什么不只是「就用 TypeScript」

| | TypeScript | Nudo |
|---|---|---|
| 主产物 | `.ts` 上的声明类型 | 执行 `.js` 得到的观测 Abs |
| 契约 | 类型语言 + 可赋值性 | 侧车 `*.nudo.js` / `@nudo:refine` + L2 入口 throws |
| 精度 | 常被拓宽（`string`、`number`） | 可保留字面量、模板结构、循环求和 |
| 观察 | hover 显示声明类型 | `check` 签名 / IDE hover 显示 term / pred / conf |
| CI 门禁 | `tsc --noEmit` | `nudo check`（成功时也打印 signatures） |

`"a,b,c".split(",")` → `["a", "b", "c"]`。有了 `@nudo:refine x positive`，`scale` 会带上 `(x + 1) > 1`。这是校验 + 可观测，不是第二套类型语言。

诚实对比：[Nudo vs TypeScript](./guides/vs-typescript.md)。边界：[Nudo 不宣称什么](./concepts/limits.md)。

## 下一步

- **[为什么选 Nudo](./why-nudo.md)** — 工作模式、Abs 契约面、生态
- **[安装](./getting-started/installation.md)** — CLI、VS Code 扩展、Vite 插件
- **[快速开始](./getting-started/quick-start.md)** — 第一次 check + 第一份契约
- **[契约](./guides/contract.md)** — 草稿 / 接受 / `nudo contract`
- **[nudo check](./guides/check.md)** — Abs 上的 L1 + L2 门禁
- **[Abs](./concepts/type-values.md)** — `shape × term × pred × conf`
- **[指令](./concepts/directives.md)** — `@nudo:refine` / 侧车文法（参考）
- **[Playground](/playground)** — 浏览器观察
- **[Recipes](./guides/recipes.md)** — CI、monorepo、export
- **[诊断](./reference/diagnostics.md)** — 稳定诊断码
- **[Agents](./reference/agents.md)** — 面向 agent 的产品规则
