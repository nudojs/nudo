---
description: "Nudo 包版本策略：0.x 与 1.x SemVer、何为破坏性变更、changeset 流程与迁移说明。"
---

# 版本与发布

Nudo 是 pnpm monorepo，经 [changesets](https://github.com/changesets/changesets) **按包**发布版本。monorepo 根版本私有，不是发布单元。

## 包版本线

> 下表版本为撰写时已发布的版本线——以 `npm view <pkg> version` 为准。**线**（0.x vs 1.x+）是稳定部分；精确补丁号总会前进。

<!-- NUDO-VERSIONS:BEGIN -->
| 包 | 版本线 | 升级规则 |
|----|--------|----------|
| `@nudojs/core` | **1.x**（1.1.0） | SemVer：破坏性 → major |
| `@nudojs/service` | **1.x**（1.1.0） | SemVer：破坏性 → major |
| `nudojs` | **1.x**（1.0.0） | SemVer：破坏性 → major |
| `@nudojs/parser` | **1.x**（1.1.0） | SemVer：破坏性 → major |
| `@nudojs/lsp` | **1.x**（1.0.0） | SemVer：破坏性 → major。冻结清单：`packages/lsp/PUBLIC_API.md` |
| `@nudojs/env` / `@nudojs/harvester` | 0.x（0.4.2 / 0.2.8） | minor 可能破坏；为 IDE/CI 分析稳定可锁 minor。手写 env 在重叠模块/导出上 wins（`mergeHarvestUnderEnv`） |
| `vite-plugin-nudo` | 0.x（0.4.3） | minor 可能破坏 |
| `nudo-vscode` | Marketplace | 以扩展发行说明为准；打包前对齐 bundled lsp 版本（见 `packages/vscode/RELEASE_CHECKLIST.md`） |
<!-- NUDO-VERSIONS:END -->

### 0.x 一句话

`0.x.y` 的 patch 可放心升；`0.(x+1).0` 的 minor **可能**含破坏性变更。CI 需要诊断结果完全稳定时请锁死精确版本。

### 稳定线（1.x / 2.x）一句话

patch 修健全性（结果可能变得*更正确*）；minor 增 API / 诊断码 / 旗标；major 删除或重命名公共面。手写 env wins 优先级变更属 **major**。

完整策略（Nudo 何为 breaking）：仓库内 [`docs/versioning.md`](https://github.com/nudojs/nudo/blob/main/docs/versioning.md)。

## 生态包（`@nudojs/env` / `@nudojs/harvester`）

> 完整权威文本在仓库 `docs/versioning.md` § Ecosystem packages；本节是面向消费者的摘要。

<!-- NUDO-ECOSYSTEM:BEGIN -->
| 包 | 当前 | 锁定方式 | 说明 |
|----|------|----------|------|
| `@nudojs/env` | 0.4.2（pre-1.0） | workspace / IDE·CI 稳定可锁 `~0.4.0` | 新 Abs 模块（如 `events` / `stream` / `querystring`）以 **minor** 发布；签名展示可能变化。手写 env 在重叠模块/导出上 **wins**。 |
| `@nudojs/harvester` | 0.2.8（pre-1.0） | workspace / `~0.2.8` | Harvest 是**旁路信道**，不是类型系统真理源。预算默认：`maxFiles=12`、`maxMs=2500`，`NUDO_HARVEST_NODE=off` 显式关闭。 |
<!-- NUDO-ECOSYSTEM:END -->

规则：

- **手写 `@nudojs/env` wins** 覆盖 harvest / 自动 harvest 在相同模块键或导出名上的结果。分析经 `@nudojs/service` 的 `mergeHarvestUnderEnv` 注入；harvest 只补缺失槽。改变该优先级对 service 分析结果是破坏性变更。
- 覆盖报告（`pnpm run coverage:env` → `docs/reports/env-coverage-baseline.*`）是**可选 release-notes 内容**，不是 soundness 门禁。优先看 **leaf-clean**，不要只看 resolved 比例。
- 生产路径上的裸 import harvest 经 `abs-modules-graph` / `harvest-to-abs`（`bareSpecToAbsModules`）注入。`autoHarvestModules` 是程序化 harvest 库 helper，不是第二条分析注入路径。

## 常见破坏面

- 删除包导出子路径
- `CheckJson` / `CaseJson` / 生成 `.d.ts` 的 schema 或形态变化
- 重命名诊断码，或默认 severity 翻转
- 删除 CLI 旗标，或无逃生舱地改分析默认值
- **fix-2 默认 `analysis.mode` 翻转**（`directives` → `exports`）：稳定 service/cli 线上的 intentional change；逃生舱 `package.json#nudo.analysis.mode`；release notes 按 **major** 处理
- 指令文法 / 侧车绑定键变更
- class 方法 / export 别名侧车键使用**本地声明名**（`export { Local as Public }` 绑 `Local.method`，不是 `Public.method`）
- 删除 LSP `nudo.*` 命令或 custom request

**非破坏：** 新诊断码、新的可选 `package.json#nudo` 键、推断更精确、带安全默认的新 CLI 旗标。

## 跟随发布

每个已发布包都带 changeset 维护的 `CHANGELOG.md`。破坏性条目以 `**BREAKING**:` 开头，并附一行迁移说明。

示例（`@nudojs/core` 2.0.0）：求值器子路径从 `@nudojs/cli/evaluator` 迁到 `@nudojs/service/evaluator`。

```bash
# 0.x 包升 minor 之后
npm i @nudojs/env@0.4.1
# 阅读 node_modules/@nudojs/env/CHANGELOG.md 中的 BREAKING 条目
```

## 文档版本

站点记录的是 **`main`** —— 顶部公告栏显示它对应的各包版本（构建期从 `packages/*/package.json` 读取），上表也由同一来源生成。按包的发布历史见 [Releases](../releases.md) 与各包 `CHANGELOG.md`。

版本化文档（`/docs/<version>/…` 快照）**刻意推迟到 1.0**：当前 cli/service 版本线同步前进，第二份副本的漂移速度会快于它带来的收益。在那之前，需要逐位稳定的行为时请按上表锁定包版本。

## Changesets（贡献者）

```bash
pnpm exec changeset
```

选择受影响的包与 bump 类型，写清 **谁会破 / 如何迁**。`main` 上 CI 执行 `changeset version` → 发布 → 文档 / VS Code 打包。

| 情形 | Bump |
|------|------|
| 0.x 包，破坏性 | minor |
| 0.x 包，修复/增量 | patch |
| 1.x 包，API/schema 破坏 | major |
| 1.x 包，增量 | minor |
| 1.x 包，健全性修复 | patch（需注明结果变化） |

## 锁定配方

```jsonc
// CI 可复现
{ "dependencies": { "@nudojs/core": "2.1.0" } }

// 1.x：跟踪兼容修复
{ "dependencies": { "@nudojs/core": "^2.1.0" } }

// 0.x：只自动吃 patch
{ "dependencies": { "@nudojs/env": "~0.4.0" } }
```

## IDE 扩展

VS Code（`wmzy.nudo-vscode`）与 Zed（`nudojs/nudo-zed`）捆绑或解析 `@nudojs/lsp`。编辑器侧变更以扩展发行说明为准；语言服务器遵循上表稳定 1.x SemVer 线。VS Code 打包清单：仓库 `packages/vscode/RELEASE_CHECKLIST.md`。LSP 冻结清单：仓库 `packages/lsp/PUBLIC_API.md`。

## 参见

- [LSP 客户端矩阵](./lsp-clients.md)
- [VS Code 扩展](./vscode.md)
- [Zed 扩展](./zed.md)
- [Agent 集成](./agent-integration.md)
- [与 TypeScript 共存](./coexistence.md)
- [@nudojs/lsp API](../api/lsp.md)
