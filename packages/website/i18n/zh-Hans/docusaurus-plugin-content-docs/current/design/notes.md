---
description: "仓库设计笔记索引——产品页背后的架构真源（Abs、CLI 语义、求值、接口推导、缓存、限制）。"
---

# 设计笔记（仓库）

架构真源在仓库里，不在本站：[`docs/design/`](https://github.com/nudojs/nudo/tree/main/docs/design)。[设计文档](./design-doc.md) 是面向公众的叙述；当它与真源冲突时，以真源为准。本页是索引——每篇设计笔记都列在这里，新增的不会再「隐形」。

**面向产品的摘要**在站内：[Abs](../concepts/abs.md)、[语言语义](../concepts/semantics.md)、[HOF 关系](../concepts/hof-relations.md)、[边界](../concepts/limits.md)、[CLI 参考](../api/cli-reference.md)。

## 真源

| 设计笔记 | 覆盖内容 | 状态 |
|---|---|---|
| [`kernel-merge.md`](https://github.com/nudojs/nudo/blob/main/docs/design/kernel-merge.md) | 类型系统：`Abs = shape × term × pred × conf` 单轨制（`@nudojs/core/src/algebra`） | 真源 |
| [`cli-semantics.md`](https://github.com/nudojs/nudo/blob/main/docs/design/cli-semantics.md) | CLI 产品面、L1/L2 门禁、`any` 与 `unknown`、`test` 用例报告、check JSON | 真源 |
| [`evaluation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/evaluation.md) | 单求值引擎（transpile → exec）、集合语义、fail-closed 行为 | 已落地 |
| [`refine-derivation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/refine-derivation.md) | 三层有效契约：手写 → 生成 → 隐式；侧车绑定；drift 诊断码 | 已落地 |
| [`hof-relations.md`](https://github.com/nudojs/nudo/blob/main/docs/design/hof-relations.md) | HOF 关系（`fnRels` / `entryShapes`），不造泛型语言 | 已实施（P3 暂缓） |
| [`persistent-cache.md`](https://github.com/nudojs/nudo/blob/main/docs/design/persistent-cache.md) | `.nudo/cache` 磁盘层 + `~/.cache/nudo/deps` harvest；fail-open 规则 | 已落地 |
| [`cache-invalidation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/cache-invalidation.md) | 进程内会话缓存的失效契约 | 契约 + 回归钉扎 |
| [`lsp-client-gaps.md`](https://github.com/nudojs/nudo/blob/main/docs/design/lsp-client-gaps.md) | LSP 客户端 UI 缺口——[LSP 客户端](../guides/lsp-clients.md) 背后的跟踪表 | 现行 |
| [`limitations.md`](https://github.com/nudojs/nudo/blob/main/docs/design/limitations.md) | 仍约束决策的限制与未决项 | 持续维护 |

## 过程记录

| 笔记 | 覆盖内容 |
|---|---|
| [`plans/`](https://github.com/nudojs/nudo/tree/main/docs/design/plans) | 带日期的过程计划（如[删除第二引擎](https://github.com/nudojs/nudo/blob/main/docs/design/plans/2026-09-22-remove-ast-eval.md)）——历史，不是契约 |
| [`docs/reports/`](https://github.com/nudojs/nudo/tree/main/docs/reports) | 实测基线（env 覆盖率、OSS/agent 性能），[性能](../guides/performance.md) 与 [AI 原生 DX](../guides/ai-native-dx.md) 引用它们 |
| [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md) | CI 钉住的示例矩阵（`pnpm run verify:examples`） |

## 这些笔记如何保鲜

- 文档站单向消费它们：渲染规则与门禁见[贡献指南 — 文档维护](../contributing.md#docs-maintenance)。
- 每篇笔记都带 `Status` 行；`landed` 描述已上线行为，`contract` 描述有测试的不变量。
- 本索引有门禁：往 `docs/design/` 加文件而不在这里登记，`packages/website/tests/docs-coverage.test.ts` 会红。
