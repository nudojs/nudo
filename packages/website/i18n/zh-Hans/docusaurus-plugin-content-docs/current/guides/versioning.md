---
sidebar_position: 10
description: "Nudo 包版本策略：0.x 与 1.x SemVer、何为破坏性变更、changeset 流程与迁移说明。"
---

# 版本与发布

Nudo 是 pnpm monorepo，经 [changesets](https://github.com/changesets/changesets) **按包**发布版本。monorepo 根版本私有，不是发布单元。

## 包版本线

| 包 | 版本线 | 升级规则 |
|----|--------|----------|
| `@nudojs/core` | **1.x** | SemVer：破坏性 → major |
| `@nudojs/service` | **1.x** | SemVer：破坏性 → major |
| `@nudojs/cli` | **1.x** | SemVer：破坏性 → major |
| `@nudojs/parser` | 0.x | **minor 可能破坏** — 先读 CHANGELOG |
| `@nudojs/lsp` | 0.x（**0.8.0** pre-1.x） | **minor 可能破坏**。1.x 门槛：经 `packages/lsp/PUBLIC_API.md` 观察冻结面，**不自动 bump** |
| `@nudojs/env` / `@nudojs/harvester` | 0.x（**0.3.0** / **0.2.5**） | minor 可能破坏；为 IDE/CI 分析稳定可锁 minor（如 `~0.3.0`）。手写 env 在重叠模块/导出上 wins（service `mergeHarvestUnderEnv`） |
| `nudojs`（npm 壳） | 0.x | 优先直接依赖 `@nudojs/cli` / `@nudojs/core` |
| `vite-plugin-nudo` | 0.x | minor 可能破坏 |
| `nudo-vscode` | Marketplace | 以扩展发行说明为准；打包前对齐 bundled lsp 版本（见 `packages/vscode/RELEASE_CHECKLIST.md`） |

### 0.x 一句话

`0.x.y` 的 patch 可放心升；`0.(x+1).0` 的 minor **可能**含破坏性变更。CI 需要诊断结果完全稳定时请锁死精确版本。

### 1.x 一句话

patch 修健全性（结果可能变得*更正确*）；minor 增 API / 诊断码 / 旗标；major 删除或重命名公共面。

完整策略（Nudo 何为 breaking）：仓库内 [`docs/versioning.md`](https://github.com/nudojs/nudo/blob/main/docs/versioning.md)。

## 生态包（`@nudojs/env` / `@nudojs/harvester`）

> 完整权威文本在仓库 `docs/versioning.md` § Ecosystem packages；本节是面向消费者的摘要。

| 包 | 当前 | 锁定方式 | 说明 |
|----|------|----------|------|
| `@nudojs/env` | 0.3.0（pre-1.0） | workspace / IDE·CI 稳定可锁 `~0.3.0` | 新 Abs 模块（如 `events` / `stream` / `querystring`）以 **minor** 发布；签名展示可能变化。手写 env 在重叠模块/导出上 **wins**。 |
| `@nudojs/harvester` | 0.2.5（pre-1.0） | workspace / `~0.2.5` | Harvest 是**旁路信道**，不是类型系统真理源。预算默认：`maxFiles=12`、`maxMs=2500`，`NUDO_HARVEST_NODE=off` 显式关闭。 |

规则：

- **手写 `@nudojs/env` wins** 覆盖 harvest / 自动 harvest 在相同模块键或导出名上的结果。分析经 `@nudojs/service` 的 `mergeHarvestUnderEnv` 注入；harvest 只补缺失槽。改变该优先级对 service 分析结果是破坏性变更。
- 覆盖报告（`pnpm run coverage:env` → `docs/reports/env-coverage-baseline.*`）是**可选 release-notes 内容**，不是 soundness 门禁。优先看 **leaf-clean**，不要只看 resolved 比例。
- 生产路径上的裸 import harvest 经 `abs-modules-graph` / `harvest-to-abs`（`bareSpecToAbsModules`）注入。`autoHarvestModules` 是程序化 harvest 库 helper，不是第二条分析注入路径。

## 常见破坏面

- 删除包导出子路径
- `CheckJson` / `InferJson` / 生成 `.d.ts` 的 schema 或形态变化
- 重命名诊断码，或默认 severity 翻转
- 删除 CLI 旗标，或无逃生舱地改分析默认值
- **fix-2 默认 `analysis.mode` 翻转**（`directives` → `exports`）：1.x service/cli 上的 intentional change；逃生舱 `package.json#nudo.analysis.mode`；release notes 按 **major** 处理
- 指令文法 / 侧车绑定键变更
- class 方法 / export 别名侧车键使用**本地声明名**（`export { Local as Public }` 绑 `Local.method`，不是 `Public.method`）
- 删除 LSP `nudo.*` 命令或 custom request

**非破坏：** 新诊断码、新的可选 `package.json#nudo` 键、推断更精确、带安全默认的新 CLI 旗标。

## 跟随发布

每个已发布包都带 changeset 维护的 `CHANGELOG.md`。破坏性条目以 `**BREAKING**:` 开头，并附一行迁移说明。

示例（core 1.0.0）：求值器子路径从 `@nudojs/cli/evaluator` 迁到 `@nudojs/service/evaluator`。

```bash
# 0.x 包升 minor 之后
npm i @nudojs/lsp@0.8.0
# 阅读 node_modules/@nudojs/lsp/CHANGELOG.md 中的 BREAKING 条目
```

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
{ "dependencies": { "@nudojs/core": "1.0.1" } }

// 1.x：跟踪兼容修复
{ "dependencies": { "@nudojs/core": "^1.0.1" } }

// 0.x：只自动吃 patch
{ "dependencies": { "@nudojs/lsp": "~0.8.0" } }
```

## IDE 扩展

VS Code（`wmzy.nudo-vscode`）与 Zed（`nudojs/nudo-zed`）捆绑或解析 `@nudojs/lsp`。编辑器侧变更以扩展发行说明为准；语言服务器仍遵循上表 0.x / 1.x 规则。VS Code 打包清单：仓库 `packages/vscode/RELEASE_CHECKLIST.md`。LSP 冻结清单：仓库 `packages/lsp/PUBLIC_API.md`。

## 参见

- [LSP 客户端矩阵](./lsp-clients.md)
- [VS Code 扩展](./vscode.md)
- [Zed 扩展](./zed.md)
- [Agent 集成](./mcp-server.md)
- [与 TypeScript 共存](./coexistence.md)
- [@nudojs/lsp API](../api/lsp.md)
