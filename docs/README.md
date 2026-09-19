# Nudo 文档地图

`docs/` 是引擎与产品文档的单一入口。
**两篇真源** + 限制/路线图 + 领域设计摘要；其余是 CI 用法与报告。

| 状态 | 含义 |
|------|------|
| **真源** | 修改前必须先改这里；其它文档不得与之冲突 |
| **现行** | 与当前引擎行为一致 |
| **摘要** | 领域设计压缩版：现状 + 不变量 + 未决 |
| **报告** | 由脚本生成/刷新，勿手工改结论 |

## 真源（两篇）

| 文档 | 内容 | 状态 |
|------|------|------|
| [design-kernel-merge.md](./design-kernel-merge.md) | **Abs 架构真源**：`shape × term × pred × conf` 单轨；运算路径、约束传播、置信度、模块边界 | 真源 |
| [design-cli-semantics.md](./design-cli-semantics.md) | **产品命令面真源**：verbs / any≠unknown / L1+L2 / check 执法与 JSON / analysis 配置 | 真源 |

## 现行（限制与路线图）

| 文档 | 内容 | 状态 |
|------|------|------|
| [design-limitations.md](./design-limitations.md) | 设计限制、优先级、测试覆盖、改进路线、C0.5 eval-slot、调用点发现天花板 | 现行（随修复更新） |

## 领域设计摘要

| 文档 | 内容 | 状态 |
|------|------|------|
| [design-refine-derivation.md](./design-refine-derivation.md) | 契约分层推导 / 侧车 / `contract --draft`·`--emit` | 摘要 |
| [design-hof-relations.md](./design-hof-relations.md) | HOF 关系 Abs（非 TS 泛型语言） | 摘要 |
| [design-persistent-cache.md](./design-persistent-cache.md) | 持久化分析缓存（`.nudo/cache`） | 摘要（未实施） |

## CI 用法与报告

| 文档 | 内容 | 状态 |
|------|------|------|
| [ci-nudo-check.md](./ci-nudo-check.md) | CI 用法：GHA、金标、退出码（产品语义见 cli-semantics §5） | 现行 |
| [check-real-packages.md](./check-real-packages.md) | 真实包扫描报告 | 报告 |
| [feasibility-npm-package.md](./feasibility-npm-package.md) | 替换 TypeScript 可行性报告 | 报告 |
| [versioning.md](./versioning.md) | 发布与 breaking 策略 | 现行 |
| [reports/env-coverage-baseline.md](./reports/env-coverage-baseline.md) | env 覆盖基线 | 报告 |

## 示例

| 文档 | 内容 | 状态 |
|------|------|------|
| [examples/README.md](./examples/README.md) | **示例命令 × 退出码矩阵（唯一真值）**；`pnpm run verify:examples` 交叉校验 | 现行 |
| [examples/](./examples/) | 分场景示例（输出钉住） | 现行 |

## 网站文档

面向用户的文档在 [`packages/website/docs/`](../packages/website/docs/)（en）与
[`packages/website/i18n/zh-Hans/`](../packages/website/i18n/zh-Hans/)（zh）。
本目录面向维护者；示例输出的 CI 真值仍是 `examples/`。

## 历史规划

| 计划 | 状态 |
|------|------|
| [`2026-09-19-close-remaining-dx-gaps.md`](./superpowers/plans/2026-09-19-close-remaining-dx-gaps.md) | **现行**：IDE/LSP 收口 + Node 生态覆盖 |
| 其余 `superpowers/plans/` 与 `superpowers/specs/` | 历史；实现现状以真源为准 |

已删除、不再维护的文档：`nudo-check.md`（并入 cli-semantics §5–§6）、
`design-analysis-scope.md`（并入 cli-semantics §7）、`design-eval-missing-slot.md`
（并入 limitations §1.0b）、`design.md` / `design-typevalue-algebra.md` /
`design-cli-semantics-conflicts.md`（TypeValue/旧 CLI 债）。

## 修改约定

- 引擎代数/架构 → 先改 `design-kernel-merge.md`。
- 命令面 / any·unknown / check 语义 / analysis 配置 → 先改 `design-cli-semantics.md`。
- 领域设计演进 → 更新对应摘要的「现状 / 不变量 / 未决」，不恢复长文档案。
- 改示例 / 矩阵 → 同步 `scripts/verify-examples.sh` pins，跑 `pnpm run verify:examples`。
- 引擎行为变化 → 先改 `examples/`（CI 红着改），再更新真源。
- 过期计划 → 加 `> **Superseded / historical.**` banner 指向真源。
