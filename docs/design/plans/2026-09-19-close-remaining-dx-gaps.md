# Close Remaining DX Gaps — 未闭环项

> **状态**：P0-A A1–A8 + P0-B B1–B8 主体已交付（2026-09-19）。
> 已完成任务的证据在 git 与各包测试/文档中，**不在本文保留 evidence 表**。
>
> 真源：[`../kernel-merge.md`](../kernel-merge.md) · [`../cli-semantics.md`](../cli-semantics.md) ·
> 限制与边界：[`../limitations.md`](../limitations.md) · 版本：[`../../versioning.md`](../../versioning.md)。

---

## 未完全闭合（`[~]`）

| ID | 项 | 缺口 |
|----|----|------|
| **A3** | VS Code 扩展产品化 | 发布清单已写（`packages/vscode/RELEASE_CHECKLIST.md`）；**`vsce package` dry-run 须在 release 机执行**后才能标 `[x]` |
| **A6** | IDE 日用冒烟 | service 层冒烟 7/7（`ide-daily-smoke.test.ts`）；**live editor + 中型目录延迟基线**未做（→ S1） |
| **B2** | `@types/node` harvest 产品化 | 进程内缓存 + 有/无 `@types/node` 条件 hard-gate 已有；**磁盘缓存**与「harvest 失败自动注入手写 env」降级链路未做（手写 wins 已由 `mergeHarvestUnderEnv` 钉住） |

---

## Backlog（未开工，按拍板押后）

| ID | 项 | 重新拉起条件 |
|----|----|--------------|
| **S1** | 真实 monorepo cold/warm/edit 性能基线 | 采用卡在「性能无证据」时 |
| **S2** | 近 strict 默认门禁档 / 官方契约模板 | 侧手写契约成本成为采用阻塞时 |
| **S3** | 公开成功样板（真实 JS 包迁移故事） | 覆盖报告达标且有外部包愿意公开时 |
| **S4** | `analysis.mode=all` 大仓 IDE 体验 | 有明确用户需要脚本级全量分析时 |
| **S5** | 闭包跨调用状态合流等 limitations P2 | ~~押后~~ **B-path 已建模**（`s5-closure-state.test.ts`）；残余仅方法槽展示 `() => ?` |

---

## 更新约定

- 新开工：`[~]` + 一行锚点（PR / issue / 测试名）
- 完成：从本表删除；证据写进测试/文档/CHANGELOG，不写回本文
- 取消：移到 Backlog 或删行并留一行原因
- 与 `limitations.md` / 真源冲突：**以真源为准**
- 覆盖率数字：只改 `docs/reports/` 生成物，不手工改结论

节奏：无固定周期；只排优先级与依赖。当前优先：闭环 A3/B2 → 视反馈拉 S1–S3。
