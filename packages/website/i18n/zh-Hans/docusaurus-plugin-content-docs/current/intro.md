---
slug: /intro
description: Nudo 让开发者在源码中看到变量接近运行时的样子 — 逐变量精确推导，而非宽泛类型名；契约比类型更精确；逻辑保持 JavaScript。
---

# 简介

**Nudo 要解决的一件事：在源码里，就能看到变量接近运行时的样子。**

阅读代码时，通常只能看到宽泛的类型名（`number`、`string`），或再叠一层标注。Nudo 在抽象值上执行 JavaScript，使每个变量携带它实际会算出的内容——字面量、形状、约束——并以签名、IDE inlay、调用点证据的形式呈现在源码旁。

```javascript
// calc.js
export function scale(x) {
  return x + 1;
}

scale(5);
scale(0); // 若契约要求 x > 0
```

在 IDE 中，中间量按行显示接近运行时的形态，而不是单一类型名：

```text
scale(x)          x: number · x > 0        // 契约或调用点带来的约束
  return x + 1    term (x + 1) · > 1       // 推导结果，而非「number」
scale(5)          => 6  #exact             // 调用点即运行时真值
scale(0)          ⊭ x > 0                  // actual 0 · expected x > 0
```

`nudo check` 在命令行给出同一观察面（成功时亦打印 signatures）。需要义务时，以侧车契约（`*.nudo.js` / `@nudo:contract`）声明必须成立的条件；违例输出为**值与谓词**，而非类型名。

```text
signatures
  scale(x: number) => number

issues
  [ERROR …] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
```

[在 Playground 中查看](/playground)。

**产品面：** **观察层**（Day 0）= `nudo check`（签名与诊断）。**契约层**（Day 1）= `nudo contract` + `nudo check`（显式契约）。生态 = `nudo export`（将 Abs 单向投影为 `.d.ts` / schema 等）。观察落在 check 签名与 IDE hover，不设独立观察动词。`nudo test` 为可选的调试用例报告。

## 如何实现：执行，而非标注

目标是「源码中可见接近运行时的变量」。实现路径是**在抽象值（Abs）上执行代码**：

1. **执行产生事实。** 引擎在符号值上求值，记录每个中间量的形状、值身份与约束（而非从标注推断）。
2. **调用点是证据。** `scale(5) => 6` 来自实际调用路径，不是注释中的声明。
3. **约束参与代数。** `x > 0` 可推出 `(x + 1) > 1`，故 inlay 上的不只是类型名，而是可推理的关系。
4. **标注非必写。** 源码保持普通 `.js`；契约同为 JS 模块。

原理展开：[抽象解释](./concepts/abstract-interpretation.md) · [Abs](./concepts/abs.md)。

## 如何使用这些文档

| 你是 | 从这里开始 |
|---------|------------|
| 评估类型/检查门禁的 JS 工程师 | [心智模型](./getting-started/mental-model.md) → [快速开始](./getting-started/quick-start.md) → [nudo check](./guides/check.md) |
| TypeScript 用户 | [Nudo vs TypeScript](./guides/vs-typescript.md) → [从 TS 迁移](./guides/migrating-from-typescript.md) |
| 现有 JS 包 | [迁移现有 JS](./guides/migrating-js.md) → [契约](./guides/contract.md) |
| 自动化流水线 / 平台 | [Recipes](./guides/recipes.md) → [诊断](./reference/diagnostics.md) → [错误对照](./guides/error-faces.md) |
| AI 编码 agent / 工具链 | [Agents](./reference/agents.md) → [Agent integration](./guides/agent-integration.md) → [API · agent](./api/agent.md) |

非目标：Nudo **不是** TypeScript 编译器；不从 body AST 扫描发明必填槽；`@nudo:case` 仅调试，不是契约产品。见[边界](./concepts/limits.md)。

## 观察层与契约层

| 层级 | 你写什么 | 你得到什么 |
|-------|----------------|--------------|
| **观察层**（Day 0） | 普通 JS + 调用点 | `check` 签名与 L2 入口 may-throw 诊断 |
| **契约层**（Day 1） | `*.nudo.js` / `@nudo:contract` | L1 义务（`actual ⊭ expected`） |
| **生态** | 无需额外 | `export` 投影 dts / guard / schema |
| **进阶** | Abs 代数、env、mock | 字符串/数字代数、高阶函数、模块图 |

![观察层 → 契约层 → 生态](/img/day0-day1-ecosystem.svg)

*义务递增；`any` 为无约束，`unknown` 为推导失败。*

## 与声明式类型的关系

| | TypeScript | Nudo |
|---|---|---|
| 变量呈现 | 声明类型名 | 接近运行时的值 / 形状 / 约束 |
| 契约 | 类型语言 + 可赋值性 | 侧车构建器 + L2 入口 throws |
| 精度 | 常拓宽为 `string` / `number` | 可保留字面量、模板结构、循环求和 |
| 真源 | 源码标注 | 执行所得 Abs；投影有损且单向 |

对照：[Nudo vs TypeScript](./guides/vs-typescript.md)。边界：[Nudo 不宣称什么](./concepts/limits.md)。

## 下一步

- **[为什么选 Nudo](./why-nudo.md)** — 需求与解法
- **[心智模型](./getting-started/mental-model.md)**
- **[安装](./getting-started/installation.md)**
- **[快速开始](./getting-started/quick-start.md)**
- **[nudo check](./guides/check.md)**
- **[契约](./guides/contract.md)**
- **[抽象解释](./concepts/abstract-interpretation.md)** — 如何执行出接近运行时的变量
- **[Abs](./concepts/abs.md)** — `shape × term × pred × conf`
- **[Playground](/playground)**
- **[诊断](./reference/diagnostics.md)**
- **[Agents](./reference/agents.md)**
