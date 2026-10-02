---
description: 搭建 Nudo monorepo 开发环境并参与贡献——项目结构、开发流程、运算符语义、指令与文档。
---

# 贡献指南

感谢你对 Nudo 的贡献兴趣。本文档涵盖环境准备、项目结构、开发流程以及如何扩展系统。

---

## 环境要求

- **Node.js** >= 20（CI 使用 Node 24）
- **pnpm** 9.1.0（由 `packageManager` 固定；后续 9.x 亦可）

```bash
npm install -g pnpm
```

---

## 克隆与配置

```bash
git clone https://github.com/nudojs/nudo.git
cd nudo
pnpm install
pnpm run build
```

---

## 项目结构

本 monorepo 使用 pnpm workspaces。主要包如下：

| 包 | 描述 |
|---------|-------------|
| `@nudojs/core` | 类型系统（Abs 代数）、外延渲染（format）、Environment |
| `@nudojs/parser` | Babel 解析、指令提取、`parseCaseArgExpr` |
| `nudojs` | `nudo` CLI 本体（`check` / `test` / `contract` / `export` / `health`，外加单向 `migrate` TypeScript 退休门 `status` \| `strip` \| `verify` \| `retire`） |
| `@nudojs/cli` | 已弃用的转发 stub（→ `nudojs`，仅供迁移） |
| `@nudojs/service` | 分析核心：analyzer 编排（`analyzeFile`）、Abs-native 求值器、会话缓存；emit 产物在 `@nudojs/service/emit`（interface/dts/schema/guard/case） |
| `@nudojs/lsp` | Language Server Protocol 实现——hover/补全（`getTypeAtPosition`、`getCompletionsAtPosition`）与面向 AI agent 的 executeCommand/自定义请求（见 [Agent 集成指南](./guides/agent-integration.md)） |
| `@nudojs/harvester` | 把 `@types/*.d.ts` 转为 Abs env 定义，服务 env 包编写与分析自动补洞（不是产品 CLI 动词） |
| `@nudojs/env` | 内置环境类型定义（`/// @nudo:env es\|web\|node`，子路径导出 `/es` `/web` `/node`） |
| `vite-plugin-nudo` | 开发阶段的类型推断 Vite 插件 |
| `nudo-vscode` | VS Code / Cursor 扩展 |
| `website` | Docusaurus 文档站点 |

---

## 开发流程

### 运行测试

```bash
pnpm run test
pnpm run test:watch   # 监视模式
```

### 构建所有包

```bash
pnpm run build
```

### 本地运行 CLI

```bash
pnpm exec tsx packages/nudojs/src/index.ts check path/to/file.js
# 或
pnpm exec nudo check path/to/file.js
pnpm exec nudo test path/to/file.js
```

---

## 如何添加新的运算符语义（Abs 原生）

运算符语义在代数中实现，不存在独立的 `Ops` 层：

1. **二元算术 / 比较** — `packages/core/src/algebra/arithmetic.ts`（Abs → Abs）。一元运算与严格相等在 `packages/core/src/algebra/surface.ts`（`typeofAbs`、`negAbs`、`notAbs`、`strictEqAbs`）。

2. **分支合并辅助** — `packages/service/src/evaluator/abs-route.ts`（`tryAbsJoinObjects`、φ 约束辅助）在分支合并时 join 对象形状。

3. **添加测试**，位于 `packages/core/src/algebra/__tests__/`（如 `surface.test.ts`、`arithmetic.test.ts`）或 `packages/service/src/__tests__/`。

---

## 如何添加新指令

1. **在 `packages/parser/src/directives.ts` 中定义指令类型：**

   ```typescript
   export type MyDirective = { kind: "my"; param: string };
   export type Directive = CaseDirective | ... | MyDirective;
   ```

2. **在 `parseDirectivesFromComments` 中添加正则与解析逻辑：**

   ```typescript
   const MY_REGEX = /@nudo:my\s+(\w+)/g;
   // 在循环中：match、extract、push { kind: "my", param: ... }
   ```

3. **在求值器或 service 中使用指令：**
   - `packages/nudojs/src/index.ts` 或 `packages/service/src/analyzer.ts` 中实现分析行为。
   - 用 `d.kind === "my"` 过滤 `fn.directives` 并应用你的逻辑。

4. 若指令接收类型表达式参数，需**更新 `parseCaseArgExpr`**。

5. **添加测试**，位于 `packages/parser/src/__tests__/directives*.test.ts`。

---

## PR 规范

- 保持 PR 聚焦；宁可多个小 PR，也不要一个大 PR。
- 为新行为添加或更新测试。
- 提交前运行 `pnpm run build` 和 `pnpm run test`。
- 添加指令或公开 API 时更新文档（如 `docs/concepts/directives.md`、API 参考）。
- **文档防漂移规则**：修改 CLI 命令/选项、导出 API 或指令语法时，必须在同一个 PR 中同步更新 `packages/website` 下的文档 —— 英文源（`docs/`）与中文镜像（`i18n/zh-Hans/docusaurus-plugin-content-docs/current/`）都要改。
- **Blog 日期即发布真相。** frontmatter `date:`（及 `YYYY-MM-DD-` 文件名前缀）写真实发布日；不要为“新鲜度”回填或批量改写历史。同日多篇用 `launch-series`（或同类）标签 + 短系列导读条（见 2026-09-21 发布组）；之后的文章按真实日历日落地，保证归档诚实。

---

## Docs maintenance {#docs-maintenance}

站点（`packages/website`）和代码一样有门禁：文档 PR 与引擎 PR 跑同一套 CI，所以改文案前先认识工具箱。

### 门禁工具箱

| 命令 | 管什么 |
|---|---|
| `pnpm run verify:docs [-- --report]` | 把每个打了标签的代码块放进真 CLI 跑，并在输出里 grep 页面承诺过的行；同时双向审计 CLI 动词/参数（`docs` ↔ `packages/nudojs/src/commands`）、逐字节校验 zh 围栏一致性，`--report` 还会核算「已验证页面覆盖率」下限。先跑 `pnpm run build`。 |
| `pnpm run verify:examples` | `docs/examples/` 矩阵（`docs/examples/README.md`）：命令 × 期望退出码 + 输出钉。 |
| `pnpm run verify:links` | 离线校验 README 与站点源码里指向 `nudojs.github.io/nudo/...` 的绝对链接是否有对应路由。 |
| `pnpm vitest run packages/website/tests` | docs-as-code 规则：中英镜像对等、围栏 meta、sidebar↔页面配对、`llms.txt`↔路由↔标题同步、诊断码锚点、示例表↔矩阵一致、设计笔记索引覆盖、首页数字溯源、playground 预设。 |
| `pnpm run docs:gen` + `git diff --exit-code -- packages/website/docs/{releases*,api}` | 生成页（`releases*`、`guides/versioning`、`api/*` 骨架）必须与源一致；永远不要手改。 |
| `pnpm --filter website run build` | Docusaurus 构建：坏链接与坏锚点直接抛错。 |
| `pnpm run docs:build` | 完整的本地生产构建——同时跑站点构建与 `postbuild`（生成每页 `.md` 旁挂 + `llms-full.txt`）。 |

每周定时任务（`docs-links.yml`）检查外链；它不阻塞任何 PR。

### 代码围栏标签

代码块默认只是文档，打标签后才进入验证：

| 开启行 | 含义 |
|---|---|
| ```` ```js ```` / ```` ```javascript ```` | 纯文档。除 `noplayground` 外都会带 Playground 按钮。 |
| ```` ```js verify ```` | 按页面顺序拼进 `<page>.js`，用 `nudo check` / `nudo test` 执行。 |
| ```` ```js verify-sidecar ```` | 拼进 `<page>.nudo.js`——主文件的自动绑定侧车。 |
| ```` ```js verify#<slug> ```` | **场景文件**：`<page>-<slug>.js`，单独执行。当一页里有多段互不相邻、行号（`call@L5`、`entry@L1`）必须各自属实的示例时用它。 |
| ```` ```js verify-sidecar#<slug> ```` | 该场景的侧车。 |
| ```` ```js noplayground ```` | 隐藏 Playground 按钮（块仍会被执行）。 |

经验规则：

- **只钉 CLI 真的会打印的字符串**——不要凭空发明 golden 输出。
- 教学 CLI 输出的页面至少要有一个 `verify` 块；允许引用别页输出，但 `verify:docs` 会要求被引用的行仍存在于真实运行里。
- zh 镜像携带**逐字节相同**的围栏（只翻译散文）；任何字节漂移都会让 `verify:docs` 变红。

### 页面约定

- 每页都要有 frontmatter `description`（搜索、`llms.txt`、JSON-LD 都用它）。
- 新页成对落地：`docs/<path>.md` + `i18n/zh-Hans/docusaurus-plugin-content-docs/current/<path>.md`，在 `sidebars.ts` 注册，并在 `static/llms.txt` 里加一行 `- [<页面 H1>](<url>): <一句话摘要>`。
- 英文页不要出现中文（`en` 树是源语言）。
- 仓库内文档（`docs/design/*.md`、`docs/reports/*.md`、`docs/examples/`）用完整 GitHub URL 引用；新增设计笔记必须登记到[设计笔记](./design/notes.md)。
- 不要手改生成页：`releases.md`、`releases-history.md`、`guides/versioning.md`、`api/*` 骨架块。
- 页面级 provenance（引擎版本 + 构建提交）与 JSON-LD/OG 元数据都在构建期生成——不需要手工维护版本号。
- 社交卡片是静态资源，放在 `packages/website/static/img/`（`nudo-og.jpg`）；站点刻意只保留一张 OG 图（逐页卡片需要 CI 里有光栅化器）。

---

## 发布（VS Code 扩展）

完整清单：monorepo 内 [`packages/vscode/RELEASE_CHECKLIST.md`](https://github.com/nudojs/nudo/blob/main/packages/vscode/RELEASE_CHECKLIST.md)。每次 Marketplace / Open VS X 发布必须覆盖的要点：

1. **Bundled server 对齐** — 扩展打包 `server/server.js`（从 `@nudojs/lsp` `dist` 经 `scripts/bundle-server.mjs` 复制）。先构建 monorepo；在扩展 CHANGELOG 记录 bundled lsp 版本。vsix 自包含（运行时无 monorepo 兄弟路径）。
2. **分析默认 + 逃生舱** — 默认 `nudo.analysis.mode = "exports"`。逃生舱在项目 `package.json#nudo.analysis.mode`：`"directives"`（保守；诊断层 `errors`）或 `"all"`。发布说明必须写明该默认值；会凭空产生诊断的翻转属于破坏性默认变更。
3. **tsserver 共存** — Nudo 与内置 TS server 并跑。混合仓库应划定 `nudo.analysis.include` / `exclude`——见 [共存](./guides/coexistence.md)。不要让两个工具以冲突的 severity 指向同一批 `.ts` 源码。
4. **打包演练** — `pnpm --filter nudo-vscode run build && pnpm --filter nudo-vscode run package`；本地安装 `.vsix`；在带导出的 `.js` 上不编辑即确认 hover/诊断；确认面板命令 `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`。
5. **Marketplace / Open VS X 说明模板** — 扩展版本、bundled lsp 版本、分析默认、共存说明、协议面指针（[PUBLIC_API](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)）、已知问题。两个目标都在 `release.yml` 或显式 skip。

服务级日常冒烟（无需真实 VS Code）：`packages/lsp/src/__tests__/ide-daily-smoke.test.ts`。公开冻结清单：`@nudojs/lsp` [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) / [API 页](./api/lsp.md)。

---

## 代码风格

- **TypeScript**：strict 模式，ES modules。
- **类型**：优先使用 `type`，而非 `interface` 和 `enum`。
- **结构**：避免 class/OOP；使用普通函数和对象。
- **可变性**：尽量减少 `let`；优先使用 `const` 和纯函数。
- **控制流**：减少条件分支；使用 early return 和小函数。
