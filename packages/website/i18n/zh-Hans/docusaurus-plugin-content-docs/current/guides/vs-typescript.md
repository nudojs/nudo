---
slug: /guides/vs-typescript
description: Nudo 与 TypeScript 对照 — 替代发生在哪些维度、两者如何声明与推导，以及「替代」的具体含义与范围边界。
---

# Nudo vs TypeScript

代码理解、健壮性、语言延续——这三类需求如何在 Nudo 与 TypeScript 之间取舍，是本页要回答的问题。

相关：[从 TypeScript 迁移](./migrating-from-typescript.md) · [为什么选 Nudo](../why-nudo.md) · [错误对照](./error-faces.md)。

Nudo 的目标是：**替代 TypeScript 作为日常类型检查门禁**，而非复刻 TypeScript 编译器。双门并行仅是迁移期手段，出口是 `nudo migrate retire`。**现有代码是 JS 还是 TS，不是选型理由**——Nudo 可分析 TS（剥离标注后按 JS 语义），并提供 `migrate` 单向迁移。下文按竞争维度说明替代如何成立，以及引擎的范围边界。

## 定位

| | TypeScript | Nudo |
|---|---|---|
| **主表面** | `.ts` + 类型标注 | 普通 `.js`（传入 `.ts` 时剥离类型语法） |
| **类型模型** | 声明式结构类型 | **Abs**（`shape × term × pred × conf`），可计算类型 |
| **契约** | `interface` / `type` 语言 | `*.nudo.js` 构建器（`fn` / `shape` / `number().gt(0)`）+ 可选 `@nudo:contract` |
| **推断** | 标注 + 局部推断 | 在符号 Abs 上**执行**代码（B-path） |
| **检查诊断** | `tsc --noEmit` | `nudo check`（Abs 上 `actual ⊭ expected`；成功亦打印 signatures） |
| **生态出口** | `.d.ts` 即模型 | `.d.ts` 为**有损投影**（`absToTSType`），非真源 |
| **退出对方** | — | `nudo migrate` → **`retire` tsc** |

目标不是「在 JS 上书写 TS 语法」，而是：**JavaScript 保持为 JavaScript**；义务来自显式契约（L1）与 JS 运行时导出边界（L2 入口 throws）；引擎以求值推理，不引入第二套类型语言。

### 与 TypeScript 设计目标的关系

Microsoft 的 [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals) 明确列出两条非目标，恰好落在 Nudo 的主轴上：

> Apply a sound or "provably correct" type system. Instead, strike a balance between correctness and productivity.

> Add or rely on run-time type information in programs, or emit different code based on the results of the type system. Instead, encourage programming patterns that do not require run-time metadata.

因此 **throws** 轴（L2 入口 may-throw）与 **Pred** 轴（Abs 上的约束蕴含）按设计不在 TypeScript 路线图内。Nudo 取互补范围。相对 Flow、Hegel、schema 库与 refinement types 的完整地图：[竞争格局](./competitive-landscape.md)。

| 目标 | TypeScript | Nudo |
|---|---|---|
| 理解代码 | 源码标注 / IDE hover 显示声明类型 | `check` 签名与逐变量推导；调用点证据 |
| 检查诊断 | `tsc --noEmit` | `nudo check`（成功亦打印 signatures） |
| 入口安全 | `any.prop` 不报错 | 入口对 `any` 的危险操作进入 throws 域；L2 可报 error |
| 违例形态 | “Not assignable to type …” | [`actual` / `expected` / `fix:`](./error-faces.md) |

## 替代发生在哪些维度

选型比较的是**开发体验与事实质量**，不是仓库里文件的后缀：

| 维度 | TypeScript | Nudo |
|---|---|---|
| 注解负担 | 逻辑与类型语言并行书写 | 逻辑保持 JS；契约按需，且可用 `contract --draft` 起草 |
| 观察粒度 | 声明类型名 | 逐变量接近运行时的值 / 形状 / 约束 |
| 约束表达 | 结构类型为主（`number`） | 可计算 Pred（`ms > 0`、返回 `> 0`） |
| 语义来源 | 标注 + 局部推断 | 在 Abs 上执行；调用点是证据 |
| 错误形态 | “Not assignable to type …” | `actual` / `expected` / `fix:` |
| 真源 | 源码标注 | Abs；`.d.ts` 等为有损投影 |
| 编辑路径成本 | 全程序结构类型常驻（`tsserver`） | 单文件 / 脏集 Abs 求值；内存有界 |
| Agent 循环成本 | 叙述式诊断；全工程多轮 | 结构化 `actions[]`；门禁载荷更省（见下） |
| 迁移成本 | — | `migrate status → strip → verify → retire` |

契约可以**先声明**（侧车 / `@nudo:contract`），也可从代码**生成草稿**再人工收紧；声明面比 `interface` 更精确（含数值与形状约束）。「先写类型还是先写逻辑」不是 TS 与 Nudo 的分野。

## 性能、token 与内存

完整的对照测试尚未齐备。方向已由**架构**与仓库内既有实测确立；下表数字是待扩大的基线，不是封闭的基准结论。

### 成本结构为何偏向 Nudo

| 因素 | TypeScript | Nudo |
|---|---|---|
| 常驻什么 | 全 `Program` 结构类型——任一跨文件形状都可能改写结论 | 单文件 Abs 结果 + 轻量记账；关文件即丢分析 |
| 编辑路径 | 语言服务 / 工程刷新 | 脏集重分析；单文件 `analyzeFile` / `checkSource` |
| Agent 要读什么 | 类型名叙述（“Not assignable to type …”） | `actual` / `expected` / `actions[]`——修复轮次更少 |
| 作者要写什么 | 标注 + 类型层编程 | 契约按需；源码中无第二套语言 |

### 已有实测

| 探针 | Nudo | TypeScript | 说明 |
|---|---|---|---|
| 单文件实时编辑 | `analyzeFile` **0.19 ms**，`checkSource` **0.39 ms** 中位 | `benchmark/micro` 中 `tsc.LS` 量级 **10 ms+**（微基准约 **150×**） | 合成 monorepo / 微负载；见 `docs/reports/s1-perf-baseline.md` |
| Agent 修复（node-semver 历史 bug，约 2.4k LOC） | tokenTotal **569k** · 轮次 **45** · 修复环 **16** · 门禁峰值 RSS **226 MB** | **993k**（**+75%**）· **63** · **21** · **289 MB** | 两侧均 6/6 完成；差距在成本而非检出上限——`benchmark/lsp-rounds/out/OSS-SEMVER.md` |
| 约束类门禁载荷 | 能检出；token 花在**报告**上 | 常**假绿**（不花 token，缺陷放行） | `pnpm run agent-dx`——TS 的「便宜 token」往往是沉默 |

### 宣称边界

- 微基准与 S1 语料为**合成**；OSS-SEMVER 仅是单一真实包族。绝对 SLO 需要更广套件。
- 峰值 RSS 是 agent 循环中的**门禁进程** RSS，不是 IDE 稳态常驻。
- 内存优势是**结构性**的（不要求全程序常驻），并体现在 [LSP 有界会话模型](../api/lsp.md)；同一编辑器负载下 `tsserver` 长跑堆与 Nudo LSP 的对照矩阵尚未发布。

更完整的表（多包冷/热、多主机）会随数据落地替换本节。

## 能力边界（引擎非目标）

以下能力是 **Nudo 引擎的非目标**，与「某个业务包是否应长期以 `tsc` 作门禁」不是同一个问题：

1. **完整 TS 类型语言编程**：条件类型、模板字面量类型编程、映射类型等作为编程手段。
2. **与 `tsc` 可赋值性逐位一致**：Nudo 的门禁是 Abs 上的 Pred 蕴含与部分 `leqAbs`。
3. **declaration merging / project references 作为产品 IR**：不复刻 TypeScript 工程模型。
4. **健全性证明**：不承诺 soundness，也不以「更严的类型系统」与 TS 正面比较。

若**产品本身就是类型语言**（编写类型体操库、维护 DefinitelyTyped 式声明表面），TypeScript 是该工作的工具。对常规业务逻辑与工具包，检查门禁的终点仍是 **`nudo check` + `migrate retire`**，而不是永久双门。

## 「替代 TypeScript」的具体含义

对**单个包**，完整替代清单：

| 能力 | Nudo 路径 |
|---|---|
| 打开普通 `.js` 获得 hover / inlay | LSP + `package.json#nudo.analysis.mode`（默认 `exports`；可选 `all` / `directives`） |
| 观察层观察 | `nudo check` 签名（无 `infer` 动词） |
| 检查门禁 | `nudo check` — error 级诊断退出码 1（L1 + 未 ignore 的 L2）；可接入本地或自动化流程 |
| 显式契约 | `*.nudo.js` + `@nudo:contract`；手写即 L1 义务 |
| 生成事实 | `nudo contract --emit` → `@generated` 段（drift 记录，不静默改写义务） |
| npm / 编辑器类型 | `nudo export --format dts` — 单向投影 |
| **退出 tsc** | `nudo migrate status` → `strip` → `verify` → **`retire`** |
| 性能基准 | 仓库 `benchmark` + `benchmark:gate` — 同一 case 集合规模；精确回归超过 1-case 抖动、unknown / error 计数上升、逐 case 顺序劣于基线、或均值 > 3.0× 基线时失败 |

**不宣称**：一键迁移任意规模的 TS monorepo；以完整结构类型为主模型；第二套 IR；与 `tsc` 逐位同语义。

## 对照示例

**TypeScript（声明式）：**

```ts
export function needsPositive(x: number): number {
  return x > 0 ? x : 0;
}
needsPositive(-1); // tsc 允许
```

**Nudo（契约 + 诊断）：**

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x > 0 ? x : 0;
}

needsPositive(-1);
// nudo check → nudo:constraint-violated
//   actual:   -1  #exact
//   expected: x > 0
```

TypeScript 将意图写入签名；Nudo 将同一义务编码为**可计算**约束，并在调用点给出违例。两者皆合法；仅后者不依赖类型语言。更多形态：[错误对照](./error-faces.md)。

## 迁移，而非永久双门

Monorepo 中按**包**迁移，随后退出：

```bash
npx nudojs migrate status packages/tool
npx nudojs migrate strip packages/tool/src --write
npx nudojs migrate verify packages/tool/src
npx nudojs migrate retire packages/tool
```

迁移期内的短期双跑是手段，不是终态——见[共存](./coexistence.md)。产品终态是**单一门禁：`nudo check`**。

## 相关

- **[为什么选 Nudo](../why-nudo.md)** — 需求与解法
- **[心智模型](../getting-started/mental-model.md)** — 观察层
- **[错误对照](./error-faces.md)** — `actual` / `expected` / `fix:`
- **[概念分层](../concepts/layers.md)** — 观察层 / 契约层 / Abs
- **[nudo check](./check.md)** — 诊断码与契约分层
- **[语言语义](../concepts/semantics.md)** — 何处精确、何处降级为 `unknown`
- **[快速开始](../getting-started/quick-start.md)**
