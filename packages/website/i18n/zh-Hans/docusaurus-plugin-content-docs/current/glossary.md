---
slug: /glossary
description: 术语表 — Abs（名称与四元组）、conf 分档、B-path、fail-closed、any vs unknown、L1/L2、契约、调用点。
---

# 术语表

文档中使用的术语。英文缩写若不自明，给出名称来源。CLI 动词见 [CLI 指南](/docs/guides/cli)。

## 类型模型

| 术语 | 含义 |
|------|---------|
| **Abs** | **abstract value（抽象值）** 的缩写，来自抽象解释（abstract interpretation）。Nudo 唯一的类型系统：`shape × term × pred × conf`。可计算的值，其约束参与代数（`x > 0` ⇒ `x + 1 > 1`）。不是类型*名*，而是执行后变量所携带的东西。 |
| **shape** | 外延载体：值长什么样（`prim` / `obj` / `arr` / `tuple` / `fn` / `eff` / `brand` / `sum` / `never` / `any` / `unknown`）。 |
| **term** | 值身份：`lit`（精确 `42`）、`var`（符号 α，如 `A1`）、`app`（应用，如 `(x + 1)`）。 |
| **pred** | 相对 term 的约束（如 `x > 0`、`port ∈ [1, 65535]`）。 |
| **conf** | 抽象精确度（展示为 `#exact`、`#path`…）。由强到弱一档；`confJoin` 取更弱一侧。见 [conf 分档](#conf-grades)。 |
| **any** | 无约束的 JS 值并集——无契约入口参数的默认。开发者可细化。 |
| **unknown** | 推导失败（引擎债）——**不是** `any` 的同义词。 |
| **projection** | Abs 的单向有损视图（`formatShape`、`absToTSType`、schema source）。没有东西把投影读回分析。 |

### conf 分档 {#conf-grades}

`conf` 记录**值集合的内容知道多少**，展示为 `#exact`、`#path`…。由强到弱：`exact` → `path` → `widened` → `mock` → `partial` → `opaque`。合并时保留更弱一档。仅 `exact` / `path` 会投影出约束与 dts 细节。

| 档 | 含义 | 常见来源 |
|-------|---------|----------------|
| **exact** | 字面量或可精确求值——确定单值或结构全知 | `25  #exact`，`"ab"+"c"` → `"abc"  #exact` |
| **path** | 依赖路径约束 / 符号身份——相对 Φ 与 pred 精确 | `x + 1` 且 `x > 0` → `term (x+1) · > 1  #path` |
| **widened** | 结构已丢失，取保守外延域 | 循环合流、调用点预算超限、`selfAdd(number)` → `number  #widened` |
| **mock** | 形面来自**声明的** mock / harvest，而非观测求值 | `@nudo:mock` / env harvest |
| **partial** | 信息不完整——已知一部分，不知全集 | 开放对象、建模不全、默认 `unknown` |
| **opaque** | 无可用于推理或投影的内容 | 预算截断（`unknown #opaque`）、证不出、求值失败且无更细形面 |

## 产品面

| 术语 | 含义 |
|------|---------|
| **观察层**（Day 0） | 从 `check` 签名与 IDE hover/inlay 读出接近运行时的变量。 |
| **契约层**（Day 1） | `check` 校验的显式义务（`actual ⊭ expected`）。 |
| **contract（契约）** | 义务的产品术语：`*.nudo.js` 侧车 / `@nudo:contract`。手写即 L1。 |
| **sidecar（侧车）** | `*.nudo.js` / `*.nudo.ts` 模块，自动绑定同名源码导出。普通 JS 模块 + 构建器（`fn`、`shape`、`number().gt(0)`）。 |
| **`@nudo:contract`** | 源码内契约；约束以 Pred 进入 Abs。 |
| **`@nudo:case`** | `nudo test` / LSP 场景的调试见证——**不是**契约产品。 |
| **L1** | 显式契约层：违例为 error（`actual ⊭ expected`）。 |
| **L2** | JS 运行时导出边界：未消化的入口/导出 may-throw（`nudo:entry-may-throw`，默认 error）。 |
| **call@** | 由真实调用点合成的观察（证据）。 |
| **entry@** | 无调用点导出的回退观察；参数显示为 `any`。 |

## 引擎

| 术语 | 含义 |
|------|---------|
| **B-path** | 唯一生产求值引擎：**转译**目标为代数调用（`$add`、`$fork`、…），再以 **`new Function`** 在 Abs 上执行。名称来自实现 `bpath-run`；旧的 AST 遍历解释器已移除。 |
| **fail-closed（失败即封闭）** | B 无法处理或求值失败时，报告**无信息**（`unknown` / 空导出），而不是猜测或回落到另一套求值器。Pred 证不出、缓存键截断时同理。 |
| **abstract interpretation（抽象解释）** | Nudo 的技术基础：在抽象值上执行，而不是用具体样例（测试）或纯 AST 分析（经典类型检查器）。 |
| **leqAbs** | Abs 上的结构性「不更缺信息」比较，用于部分赋值形状。 |
| **Pred 蕴含** | L1 门禁：实际 Abs 是否蕴含契约 Pred？证明器有界（线性 / 等式片段）；否则 fail-closed。 |

深入：[Abs](/docs/concepts/abs) · [抽象解释](/docs/concepts/abstract-interpretation) · [概念分层](/docs/concepts/layers) · [边界](/docs/concepts/limits) · [诊断](/docs/reference/diagnostics) · [CLI](/docs/guides/cli)。
