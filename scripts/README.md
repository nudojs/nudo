# scripts/ — 仓内工具索引与准入契约

本文件是 `scripts/` 的**唯一清单**。`scripts/check-scripts.mjs`（挂在 `lint:hygiene`）
双向校验：磁盘上的每个脚本必须出现在下表，表中每行必须对应一个存在的文件；
`package.json#scripts` 的每个入口必须在 `package.json` 之外有真实调用方。

## 纪律

1. **一次性脚本不提交。** 分析、实验、迁移取样一律放 `/tmp`；结论落 `docs/` 或
   写成测试。脚本只有「会被反复触发」才配进仓库——行为断言优先于脚本。
2. **入库的判据是有常驻触发方：** CI workflow、`package.json` 入口、另一个被触发的
   脚本、或测试。下表「触发方」列必须写具体位置（文件名 / npm 名字），不写「手动」
   之外的空话；确实只能手动的，写清在哪个文档的哪条流程里被要求跑。
3. **npm 入口只在三种情况下新增：** CI 直接调用、`docs/examples` 命令矩阵（或
   `verify` 文档块）里出现、用户/agent 的高频主入口。其余一律 `node scripts/…` 直调，
   不占用 npm 名字。
4. **不建同义别名。** `foo` 与 `foo:x` 若后者只被前者调用，合并成一条；不保留
   「历史名字」。
5. **改/删脚本与改表同一 PR。** 门禁会拦下未登记、登记腐烂、无人引用的三种情形。

## 预算

`scripts/check-scripts.mjs` 的 `BUDGET`：代码文件 ≤ 38，npm 入口 ≤ 46（当前清算后的规模）。
升预算是一次显式 diff，须在 PR 的「新增文件理由」里说明为什么现有工具不能复用——
与 `check-core-subdomains.mjs` 的 `MAX_TOP_LEVEL_TS` 同口径。

## 文件

| 文件 | 用途 | 触发方 |
|---|---|---|
| `aggregate-tests.mjs` | 按 (目录, 家族) 收敛/拆分 vitest 入口的 codemod（零语义变更） | 手动 codemod；CLAUDE.md / CONTRIBUTING.md 引用 |
| `builtins-consistency-report.ts` | 生成内建一致性矩阵报告（生成物，不手改数字） | `packages/core/.../builtins-consistency-matrix.ts` |
| `bump-vscode-version.mjs` | changeset version 未触及扩展包时补 patch 版本 | `ci:version` |
| `check-aliases.mjs` | `@nudojs/*` workspace 别名漂移门禁（`--write` 重新生成） | `check:aliases`；CLAUDE.md 漂移门禁 |
| `check-changeset-notes.mjs` | changeset 标注口径门禁 | `lint:hygiene` |
| `check-core-subdomains.mjs` | `core/algebra` 顶层文件数与子域目录冻结 | `check:subdomains`、`lint:hygiene` |
| `check-corpus-freshness.mjs` | 真实包语料安装版本 ↔ npm latest 新鲜度提醒 | `docs/check-real-packages.md` 的刷新义务 |
| `check-diff-face.mjs` | 加法预算门禁（源码净增 / 新增源码与测试文件 + PR 任务书完整性） | `.github/workflows/ci.yml`（pull_request）、`check:diff-face` |
| `check-external-links.mjs` | 站点外链周检（不进 PR 门禁） | `.github/workflows/docs-links.yml` |
| `check-fs-input-tests.mjs` | 经 `fs` 读仓库级输入的测试必须登记在 `fs-input-tests.mjs` | `lint:hygiene` |
| `check-hygiene.mjs` | 静态卫生门禁（本仓无 ESLint/Prettier，逐条显式规则） | `lint:hygiene` |
| `check-scripts.mjs` | 本目录与 `package.json#scripts` 的准入与预算门禁 | `lint:hygiene` |
| `check-test-names.mjs` | 测试文件名不得带缺陷/批次编号 | `lint:hygiene` |
| `check-test-structure.mjs` | 测试 BDD 结构门禁（describe/it 组织、空场景、重复标题） | `lint:hygiene` |
| `ci-publish.mjs` | 发布前门禁 + OIDC 准备 + `changeset publish` | `.github/workflows/release.yml` 的 `publish-script`（`ci:publish`） |
| `coverage-floors.mjs` | 打印逐包覆盖率与建议地板值 | `.github/workflows/ci.yml` nightly 的 `coverage:floors` |
| `dx-metrics.mjs` | fix-rate / time-to-green 双口径运营度量（生成文档标记块） | `packages/website/tests/dx-metrics-publication.test.ts`、`dx-metrics` |
| `edit-loop-metrics.mjs` | watch 常驻编辑回路的反馈延迟度量（ABS-18 复测仪器） | `docs/design/plans/2026-11-09-abs-improvement-plan.md` 的复测命令 |
| `env-coverage-baseline.ts` | env / Node API 覆盖基线：生成报告 + `--check` 门禁 | `coverage:env`（`ci.yml`） |
| `fs-input-tests.mjs` | 上条门禁的测试清单单源（`--changed` 看不见 fs 读取面） | `check-fs-input-tests.mjs`、`run-fs-input-tests.mjs`、`vitest.config.ts` |
| `gate-major.mjs` | major 版本发布门禁（保存基线 / 校验基线 / for-publish） | `.github/workflows/release.yml`、`ci:version`、`ci:publish` |
| `gen-api-docs.mjs` | API docs 骨架生成（标记块注入，不覆盖手写正文） | `docs:gen`、`docs:gen:api` |
| `gen-llms.mjs` | 构建后 llms.txt 生态（路由旁挂 `.md` + `llms-full.txt`） | `packages/website/package.json` 的 `postbuild` |
| `gen-releases.mjs` | CHANGELOG → 站点 Releases 页 + 版本表注入 | `docs:gen`、`ci:version` |
| `lib/corpus.mjs` | 真实包语料清单单源 | `scan-real-packages.ts`、`check-corpus-freshness.mjs` |
| `lib/lsp-framing.mjs` | LSP stdio 定长切帧单源 | `packages/lsp/scripts/smoke-stdio.mjs`、`packages/vscode/scripts/smoke.mjs` |
| `migrate-demo.sh` | `migrating-js` 指南的可运行走查 | `migrate-demo`、`docs/examples/contract-draft/README.md` |
| `package-vitest-config.mjs` | 包内 vitest 配置的共享实现 | `packages/*/vitest.config.ts` |
| `run-fs-input-tests.mjs` | 跑 `fs-input-tests.mjs` 清单里的测试 | `test:fs-input`（CI 增量路径） |
| `scan-npm-package.ts` | 单个 npm 包替换可行性扫描 | `docs/feasibility-npm-package.md` |
| `scan-real-packages.ts` | 语料包 `nudo check` 扫描报告生成 | `docs/check-real-packages.md` |
| `test-baseline.mjs` | 全仓已知失败集合按宿主固化与机器对比 | `test:baseline`（CLAUDE.md 验证配方） |
| `test-local.mjs` | 本地测试快车道（`--changed` / `--fast` / `--e2e` / `--oracle`） | `test:local`（CONTRIBUTING.md） |
| `verify-doc-examples.sh` | 站点文档 `verify` 代码块的输出钉 | `verify:docs`（`ci.yml`） |
| `verify-examples.sh` | `docs/examples` 命令矩阵 + 输出钉 | `verify:examples`（`ci.yml`） |
| `verify-readme-links.mjs` | 仓库内指向站点路由的绝对链接校验（离线确定性） | `verify:links`（`ci.yml`） |
| `wait-ci-green.sh` | 等同 SHA 的 CI 绿判定（fail-closed 轮询） | `.github/workflows/release.yml`、`.github/workflows/docs-deploy.yml` |
| `workspace-aliases.mjs` | `@nudojs/*` 别名单源（tsconfig.paths + vitest alias） | `check-aliases.mjs`、`vitest.config.ts`、`packages/*/vitest.config.ts` |
