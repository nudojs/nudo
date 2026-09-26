---
slug: /getting-started/mental-model
description: Nudo 心智模型 — 在抽象值上执行 JS，在源码中看到接近运行时的变量；观察与契约两层；调用点是证据。
---

# 心智模型

本页只回答：**Nudo 如何看待并计算你的 JavaScript**。命令面见 [CLI](../guides/cli.md)；迁移 `tsc` 另见文末链接。

## 一句话模型

Nudo 在抽象值上**执行**你的 JavaScript，使变量携带接近运行时的值、形状与约束，并报告代码真实计算出什么——再对你接受的**契约**做校验。源码保持普通 `.js`。

| 你写 | Nudo 做 |
|------|---------|
| 普通 `.js` + 调用点 | 执行并观察：签名、中间量、调用点真值 |
| 可选 `*.nudo.js` / `@nudo:contract` | 校验义务（`actual ⊭ expected`） |
| 什么都不写 | 仍诊断导出 may-throw（L2） |

**没有第二套类型语言。** 契约是普通 JS 模块 + `number().gt(0)` 这类构造器。

## 两层：观察与契约

| 层 | 你在读什么 | 来源 |
|----|------------|------|
| **观察** | 变量接近运行时的值 / 形状 / 约束 | 执行事实（调用点、路径） |
| **契约** | 必须成立的条件，违例给出 `actual` / `expected` | 你接受的声明（侧车 / `@nudo:contract`） |

观察不是注释，契约也不是类型标注。

```javascript verify
export function scale(x) {
  return x + 1;
}

scale(5);
```

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```text
signatures
  scale(x: number) => number

issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
```

`scale(5)` 的证据让入口不再是裸 `any`；契约把 `x > 0` 变成可校验义务。`if` **不是**契约——义务只来自你接受的声明。

## 为什么变量接近运行时

因为它们是**可计算的 Abs**（`shape × term × pred × conf`），不是类型名：

| 组件 | 在产品面看到的 | 含义 |
|------|----------------|------|
| **shape** | 签名里的形状 | `prim` / `obj` / `arr` / `fn` / `sum` / … |
| **term** | 值身份 | `lit`（`42`）、`var`（符号 `A1`）、`app`（`x+1`） |
| **pred** | 违例里的 `expected:` | 约束（`x > 0`）；参与代数（`x>0` ⇒ `x+1>1`） |
| **conf** | `#exact` / `#path` | 抽象精确度 |

调用点是**证据**：真实调用越多，签名越接近运行时。`nudo test` 可查看逐调用见证；`@nudo:case` 仅调试，不产生契约义务。

深潜：[Abs](../concepts/abs.md) · [抽象解释](../concepts/abstract-interpretation.md) · `nudo check --abs`。

## 四条模型规则

1. **调用点是证据。** 真实调用越多，签名越接近运行时。
2. **`any` ≠ `unknown`。** `any` = 入口无约束（可由你细化）。`unknown` = 推导失败（引擎债）。
3. **契约是义务，不是注解。** 约束参与代数，不是注释里的意图。
4. **投影不是真源。** `.d.ts` / schema 是 Abs 的有损视图；真源是执行得到的 Abs。

## 现在可以先不管

- Abs 代数细节 — 需要 `--abs` 时见 [Abs](../concepts/abs.md)
- Harvest / env 内部 — [依赖类型](../guides/env-harvest.md)
- 导出方言 — 消费方要 `.d.ts` 或校验器时再看
- 迁移 `tsc` — [Nudo vs TypeScript](../guides/vs-typescript.md) · [从 TypeScript 迁移](../guides/migrating-from-typescript.md)

## 下一步

- [快速开始](./quick-start.md) — 动手跑一遍
- [概念分层](../concepts/layers.md) — 观察层 / 契约层 / 进阶
- [CLI](../guides/cli.md) — 命令面
- [错误对照](../guides/error-faces.md)
- [Playground](/playground)
