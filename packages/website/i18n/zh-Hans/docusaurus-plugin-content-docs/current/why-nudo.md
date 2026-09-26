---
slug: /why-nudo
description: 为什么选 Nudo — 逐变量精确推导以理解代码；以比类型系统更精确的契约增强健壮性；逻辑与契约保持 JavaScript，不引入第二套类型语言。
---

# 为什么选 Nudo

JavaScript 开发所需的通常不是另一门类型语言，而是三类能力：

1. **代码理解** — 获得每个变量的精确推导，而非宽泛的类型名。源码不受类型标注干扰，亦无需同时掌握值语言与类型语言。
2. **代码健壮性** — 以比类型系统更精确的契约描述必须成立的条件，并在开发期完成检查与诊断。
3. **语言延续** — 逻辑继续以 JavaScript 编写。工具适配代码，而非将代码库改写为另一种语言表面。

下文先辨析「是否需要一套类型系统」，再说明 Nudo 的解法。

## 是否需要一套类型系统

开发者提出「需要类型」时，所指通常是结果，而非手段：

| 实际目标 | 常见手段 | 局限 |
|---|---|---|
| 阅读时可见各中间量的来龙去脉 | 源码类型标注 | 标注构成第二套语言，干扰阅读；仅给出宽泛类型，无法展示推导过程 |
| 在合入前发现明显错误 | `tsc --noEmit` | 结构可赋值不等于运行时义务（`0` 对 `number` 合法，对 `ms > 0` 不合法） |
| 约束 API 边界输入 | Zod 等运行时校验 | 仅覆盖运行时边界，不描述函数内部计算 |
| 长期维护时仍可理解实现 | 注释与测试 | 测试提供样例而非签名；注释易失效 |

**结论：所需的是精确的行为事实与可校验的义务，未必需要第二套类型语言。**

- **可读性**来自逐变量推导观察，而非标注文本。
- **健壮性**来自可校验的精确约束（边界、shape、入口 may-throw），而非结构可赋值性。
- **开发效率**来自 JavaScript 保持为 JavaScript；契约同为 JS 模块，无需迁移到类型语言。

TypeScript 将义务写入源码标注，能力完整，并具有明确的非目标（不承诺健全性、不依赖运行时类型信息）。Nudo 采取互补路径：**在 JavaScript 上执行，从事实中观察，以显式契约完成检查诊断。**

## Nudo 的解法

**Nudo 在抽象值上执行 JavaScript，报告代码实际计算结果，并对已接受的契约进行校验。源码保持普通 `.js`。**

| 目标 | 代码理解 | 代码健壮性 | 语言延续 |
|---|---|---|---|
| **Nudo** | 逐变量精确推导 · `check` 签名 · 调用点证据 | 比类型更精确的契约 · `actual ⊭ expected` | 逻辑与契约均为 JS · 无标注干扰 · Abs 为唯一真源 |

### 1. 代码理解 — 逐变量精确推导

理解代码时，Nudo 提供的是**每个变量的精确推导**，而非宽泛类型名：

- IDE hover / inlay 展示中间量的计算过程：term、约束、置信度——观察粒度接近断点调试中的监视窗口，且无需实际运行。
- **调用点即证据**：`call@L18 (12, 3) => 36`，而非「大致为 number」。
- `nudo check` **在成功时亦打印 signatures**（入口 / 返回 / may-throw），观察不依赖额外命令。
- **源码不受类型标注干扰**：保持普通 JavaScript，阅读时无需在值语言与类型语言之间切换。
- 无约束入口参数显示为 **`any`**；真正的 **`unknown`** 表示推导失败（引擎债），与书写方式无关。

### 2. 代码健壮性 — 比类型更精确的契约

类型系统通常只能表达「大致是什么」。契约直接描述**必须成立的条件**：

| 类型系统可表达 | 契约可表达 |
|---|---|
| `number` | `ms > 0` |
| `{ host: string; port: number }` | `port ∈ [1, 65535]`；缺字段直接拒绝 |
| 返回 `number` | 返回 `> 0` |
| （不展示 throws） | 入口可能抛出 `TypeError`，并纳入诊断 |

契约位于侧车 `*.nudo.js` 或 `@nudo:contract`，是**普通 JS 模块**：

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

违例输出为**值与谓词**，而非类型名：

```text
actual:   0  #exact
expected: price > 0
→ use a value satisfying price > 0, or relax the precondition on price
fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

诊断分两层，均不要求预先掌握类型语言：

| 层 | 来源 | 示例 |
|---|---|---|
| **L1 显式契约** | 已接受的 `*.nudo.js` / `@nudo:contract` | `price > 0`、shape 缺字段、返回约束 |
| **L2 入口 may-throw** | JavaScript 运行时导出边界（默认 error） | `user.name` 在 `any` 上可能抛出 `TypeError` |

无显式契约不等于无义务：退化契约为 JavaScript 运行时边界语义。入口 may-throw 默认报错，可按需 `--ignore-throws`。`nudo check` 提供检查与诊断能力，可接入本地工作流或自动化流水线。

### 3. 语言延续 — 单一真源，生态按需投影

- 逻辑为普通 JavaScript；契约亦为普通 JavaScript。**类型标注非必写**，无需训练第二套类型语言。
- `nudo check` **仅负责校验**。
- `.d.ts` / Zod / Standard Schema / guards 来自 **`nudo export`** —— 自 Abs **单向、有损**投影；Abs 仍是真源。
- 需要草稿时使用 `nudo contract --draft`；**接受草稿才产生义务**，系统不会静默发明契约。

```text
逻辑优先 ──► 契约草稿 ──► *.nudo.js ──┐
                                       ├──► nudo check（仅校验）
契约优先 ──► *.nudo.js / refine ───────┘         │
                                                  ▼
                         Abs（唯一真源）──► nudo export ──► .d.ts
                                                  │            Zod
                                                  │            Standard Schema
                                                  └──► IDE / LSP · Agent / MCP
```

无需预先选定「先写类型」或「先写逻辑」。两种顺序汇入**同一契约面**（`shape × term × pred × conf`）；`check` 校验该面，不代为发明类型。

## 为何不仅是「加标注」

标注描述的是**书写内容**，且往往宽泛。Nudo 引擎在抽象值上**执行**逻辑，并从执行中记录精确事实。调用点是证据，不是注释。

| | 标注 / 声明类型 | Nudo |
|---|---|---|
| 代码理解 | hover 显示所书写的宽泛类型 | 逐变量推导：中间量、约束、调用点真值 |
| 阅读负担 | 值语言与类型语言并行 | 仅 JavaScript；契约同为 JS 模块 |
| 代码健壮性 | 结构可赋值；常放行 `0`；不展示 throws | 精确约束蕴含 + 入口 may-throw |
| 精度 | 常拓宽为 `string` / `number` | 可保留字面量、模板结构、循环求和 |
| 真源 | 源码标注 | 执行所得 Abs；投影有损且单向 |

对照：[Nudo 与 TypeScript](./guides/vs-typescript.md)。违例形态：[错误对照](./guides/error-faces.md)。

## 适用范围

- **JS-first 包**：需要签名、契约与检查门禁，但不希望整仓迁移至 TypeScript
- 更关注**运行时形状义务**（边界、约束、入口 throws）与**精确推导**，而非标注风格
- 需要检查诊断与 **mock / schema** 基于同一套事实
- 计划将 JS 包从 `tsc` 门禁单向退出（`nudo migrate`）

更宜以 TypeScript 为主的场景：标注优先的 `.ts` 代码库、重度泛型 / 条件类型编程、以 `tsc` 工程引用为中心的生态。见 [与 TypeScript 对比](./guides/vs-typescript.md)。

## 下一步

- [心智模型](./getting-started/mental-model.md) — 观察层心智
- [介绍](./intro.md) — 产品面与文档结构
- [快速开始](./getting-started/quick-start.md)
- [nudo check](./guides/check.md) — 签名与诊断门禁
- [错误对照](./guides/error-faces.md) — actual / expected / fix
- [nudo contract](./guides/contract.md) — 草稿与接受
- [边界](./concepts/limits.md) — 引擎不宣称的范围
- [迁移现有 JS](./guides/migrating-js.md)
- [Playground](/playground)
