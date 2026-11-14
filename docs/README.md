# Nudo 文档地图

`docs/` 是引擎与产品文档的单一入口。
**设计文档全部集中在 [`docs/design/`](./design/)**；历史计划不落盘，只留 git。

| 状态 | 含义 |
|------|------|
| **真源** | 修改前必须先改这里；其它文档不得与之冲突 |
| **现行** | 与当前引擎行为一致 |
| **摘要** | 领域设计压缩版：现状 + 不变量 + 未决 |
| **报告** | 由脚本生成/刷新，勿手工改结论 |

## 设计（`docs/design/`）

### 真源

| 文档 | 内容 | 状态 |
|------|------|------|
| [design/kernel-merge.md](./design/kernel-merge.md) | **Abs 架构真源**：单轨 IR、运算路径、约束传播、置信度、模块边界 | 真源 |
| [design/cli-semantics.md](./design/cli-semantics.md) | **产品命令面真源**：verbs / any≠unknown / L1+L2 / check 执法与 JSON / analysis 配置 | 真源 |

### 限制与领域摘要

| 文档 | 内容 | 状态 |
|------|------|------|
| [design/limitations.md](./design/limitations.md) | **仍有效**的限制、诚实边界、未决（已解决行为以测试为准） | 现行 |
| [design/lsp-client-gaps.md](./design/lsp-client-gaps.md) | LSP 客户端 UI 缺口跟踪（LSP-G1…）+ 关闭条件 | 现行 |
| [design/refine-derivation.md](./design/refine-derivation.md) | 契约分层推导 / 侧车 / `contract --draft`·`--emit` | 摘要 |
| [design/hof-relations.md](./design/hof-relations.md) | HOF 关系 Abs（非 TS 泛型语言） | 摘要 |
| [design/persistent-cache.md](./design/persistent-cache.md) | 持久化分析缓存（`.nudo/cache` / `~/.cache/nudo/deps`） | 摘要（L2 harvest 已落地） |
| [design/nan-finite-contracts.md](./design/nan-finite-contracts.md) | NaN 感知的契约词汇（`number().finite()`）与关系补集累积（issue #185） | 已实施（2026-11-14；残余见文末） |

### 计划

| 文档 | 状态 |
|------|------|
| [design/plans/2026-09-19-close-remaining-dx-gaps.md](./design/plans/2026-09-19-close-remaining-dx-gaps.md) | **现行**：未闭环 `[~]` + Backlog；已交付任务不在此保留 evidence |
| [design/plans/2026-11-09-abs-improvement-plan.md](./design/plans/2026-11-09-abs-improvement-plan.md) | **现行 backlog**（2026-11-14 生命周期清算，已交付正文删除）：开放 `ABS-13`（finalizer 含 yield/return）、`ABS-15`（提升规则 / 键版本化）、`ABS-16`③（worker 并行，触发条件在 §5）、`ABS-17`（写时复制，暂缓）；`ABS-01`…`ABS-12` / `ABS-14` / `ABS-16`① / `ABS-18` 已交付，证据在测试 / changeset / git |

## CI 用法与报告（非设计）

| 文档 | 内容 | 状态 |
|------|------|------|
| [ci-nudo-check.md](./ci-nudo-check.md) | CI 用法：GHA、金标、退出码（产品语义见 design/cli-semantics §5） | 现行 |
| [check-real-packages.md](./check-real-packages.md) | 真实包扫描报告 | 报告 |
| [feasibility-npm-package.md](./feasibility-npm-package.md) | 替换 TypeScript 可行性报告 | 报告 |
| [versioning.md](./versioning.md) | 发布与 breaking 策略 | 现行 |
| [reports/limits-resolved.md](./reports/limits-resolved.md) | 已解决限制归档（一行锚，自 design/limitations.md 迁出） | 报告 |
| [reports/test-baseline-failures.json](./reports/test-baseline-failures.json) | 按宿主（`<platform>/<node major>`）固化的已知测试失败基线（`pnpm run test:baseline`） | 报告 |
| [reports/env-coverage-baseline.md](./reports/env-coverage-baseline.md) | env 覆盖基线 | 报告 |

## 示例

| 文档 | 内容 | 状态 |
|------|------|------|
| [examples/README.md](./examples/README.md) | **示例命令 × 退出码矩阵（唯一真值）** | 现行 |
| [examples/](./examples/) | 分场景示例（输出钉住） | 现行 |

## 网站文档

面向用户的文档在 [`packages/website/docs/`](../packages/website/docs/)（en）与
[`packages/website/i18n/zh-Hans/`](../packages/website/i18n/zh-Hans/)（zh）。
本目录面向维护者；示例输出的 CI 真值仍是 `examples/`。

## 已删除 / 不再分散

- 设计只在 `docs/design/`；`docs/superpowers/`、`.sisyphus/`、`docs/design/history/` 已删除
- 并入真源后删除：`nudo-check.md`、`design-analysis-scope.md`、`design-eval-missing-slot.md`、TypeValue 时代设计档案
- 已交付的计划/历史档案不再保留正文（git 有记录）

## 修改约定

- **所有设计文档只放 `docs/design/`**；禁止 `docs/superpowers/`、`.sisyphus/`、`docs/design/history/`。
- 引擎代数/架构 → 先改 `docs/design/kernel-merge.md`。
- 命令面 / any·unknown / check / analysis 配置 → 先改 `docs/design/cli-semantics.md`。
- 领域设计 → 更新对应摘要的「现状 / 不变量 / 未决」。
- 新规划 → `docs/design/plans/`；**交付后删除正文**（不建 history 目录）。
- 改示例 / 矩阵 → 同步 `scripts/verify-examples.sh` pins，跑 `pnpm run verify:examples`。
- 引擎行为变化 → 先改 `examples/`（CI 红着改），再更新真源。
