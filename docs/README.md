# Nudo 文档地图

`docs/` 是引擎与产品文档的单一入口，按「现行真值 → 能力 → 门禁 → 历史」分层。
状态图例：

| 状态 | 含义 |
|------|------|
| **现行** | 与当前引擎行为一致；修改前先实测验证 |
| **报告** | 由脚本生成/刷新的产物，勿手工编辑结论 |
| **历史** | 演进记录；与现状冲突时以「现行」文档为准 |

## 引擎与类型系统

| 文档 | 内容 | 状态 |
|------|------|------|
| [design-kernel-merge.md](./design-kernel-merge.md) | **唯一真理源**：Abs = shape × term × pred × conf 单轨架构；TypeValue 是外延投影而非平行类型系统 | 现行 |
| [design-typevalue-algebra.md](./design-typevalue-algebra.md) | 代数重构设计：命题、项/约束内核、单调性表、迁移映射、实施阶段与验证状态 | 现行（设计 + 状态） |
| [design-limitations.md](./design-limitations.md) | 设计限制与路线图：P0–P3 优先级、测试覆盖、改进计划 | 现行（随修复更新） |
| [design.md](./design.md) | Abs 单轨合并前的原始设计（TypeValue 中心视图） | 历史 |
| [基于代码执行的动态类型推导方法研究.md](./基于代码执行的动态类型推导方法研究.md) | `@nudo:returns` 时代的研究笔记 | 历史 |

## 产品能力

| 文档 | 内容 | 状态 |
|------|------|------|
| [nudo-check.md](./nudo-check.md) | `nudo check` 精化门禁：报告格式、扫描形态、金标与精度、JSON 契约 | 现行 |
| [ci-nudo-check.md](./ci-nudo-check.md) | CI 用法：GHA 配置、金标指标、退出码 | 现行 |
| [check-real-packages.md](./check-real-packages.md) | 真实包扫描报告（commander 三类 error code 零误报） | 报告（`scripts/scan-real-packages.ts` 生成） |
| [feasibility-npm-package.md](./feasibility-npm-package.md) | 替换 TypeScript 可行性报告（commander 实测） | 报告 |

## 示例与 CI 门禁

| 文档 | 内容 | 状态 |
|------|------|------|
| [examples/README.md](./examples/README.md) | **示例命令 × 退出码矩阵（唯一真值）**；`pnpm run verify:examples` 从矩阵解析命令，矩阵 ↔ 磁盘双向交叉校验 | 现行 |
| [examples/](./examples/) | 分场景示例：constraints（refine）/ structure（leq）/ vs-ts（tsc 对照）/ mini-repo（多文件）/ algebra（类型即计算） | 现行（输出钉住） |

每个子目录 README 与示例文件头注释里的单行命令只是就近提示；矩阵才是真值。

## 网站文档

面向用户的文档在 [`packages/website/docs/`](../packages/website/docs/)（英文）与
[`packages/website/i18n/zh-Hans/`](../packages/website/i18n/zh-Hans/)（中文镜像），
主题式示例指南是 `guides/examples.md`。本目录文档面向维护者；示例输出块的
CI 真值仍是 `examples/`——网站指南开头已声明这一契约。

## 修改约定

- 改示例 / 矩阵 / 期望退出码 → 同步 `scripts/verify-examples.sh` 的 pins，跑
  `pnpm run verify:examples`（新增示例文件而未登记矩阵行会让 CI 红）。
- 引擎行为变化 → 先改 `examples/` 与矩阵（让 CI 红着改），再更新「现行」文档；
  `docs/examples` 的负例文件故意 exit 非 0，报错行就是它们演示的内容。
- 文档过期 → 加 `> **Superseded / historical.**` banner 并指向现行文档，
  不悄悄删除演进记录（本仓库惯例）。
