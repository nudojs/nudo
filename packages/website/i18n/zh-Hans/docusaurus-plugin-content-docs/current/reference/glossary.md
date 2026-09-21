---
slug: /reference/glossary
description: 术语表 —— Abs、any vs unknown、L1/L2、contract vs case、call@、conf。
---

# 术语表

| 术语 | 含义 |
|------|---------|
| **Abs** | Nudo 唯一的类型系统：`shape × term × pred × conf`。可计算的值；约束参与代数。 |
| **shape** | 外延载体（`prim` / `obj` / `arr` / `fn` / `sum` / `any` / `unknown` / …）。 |
| **term** | 抽象值身份：`lit` / `var` / `app`（如 `(x + 1)`）。 |
| **pred** | 相对 term 的约束（如 `x > 0`）。 |
| **conf** | 抽象置信度：`exact` / `path` / `widened` / `mock` / `partial` / `opaque`。 |
| **any** | 无约束的 JS 值并集 —— 无契约入口参数的默认。开发者负责细化。 |
| **unknown** | 推导失败 / 引擎债 —— **不是** `any` 的同义词。 |
| **contract** | 义务的产品术语：`*.nudo.js` 侧车 / `@nudo:refine`。 |
| **`@nudo:refine`** | 源码内精化契约；约束以 Pred 进入 Abs。 |
| **`@nudo:interface`** | `@nudo:refine` 的精确别名。不是独立产品面。 |
| **`@nudo:case`** | `nudo test` / LSP 场景的调试见证 —— **不是**契约产品。 |
| **L1** | 显式契约义务（`actual ⊭ expected` → error）。 |
| **L2** | 默认 JS 运行时边界：入口/导出未消化 may-throw（`nudo:entry-may-throw`）。 |
| **call@** | 从真实使用证据合成的调用点观察。 |
| **entry@** | 无调用点导出的回退观察；参数展示为 `any`。 |
| **sidecar** | `*.nudo.js` / `*.nudo.ts` 模块，自动绑定到同名源码导出。 |
| **projection** | Abs 的单向有损视图（`formatShape`、`absToTSType`、schema source）。没有东西读回投影。 |
| **check** | Day-0/CI 动词：门禁 + 始终打印签名。 |
| **contract（动词）** | 打印 / 草稿 / 固化契约表面。 |
| **export（动词）** | 把 Abs 投影为 dts / guard / schema / standard。 |
| **test（动词）** | 可选的调试用例报告器 —— 不是主要产品叙事。 |
| **health** | 分析错误 + 固化漂移。 |

深入：[Abs](/docs/concepts/type-values) · [边界](/docs/concepts/limits) · [诊断](/docs/reference/diagnostics)。
