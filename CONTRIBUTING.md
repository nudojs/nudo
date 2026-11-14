# Contributing to Nudo

Thanks for contributing. This checklist keeps PRs reviewable and CI green.

## Before you open a PR

Run these in order from the repo root (Node.js >= 22, pnpm 11.28.0):

```bash
pnpm install            # workspace deps
pnpm run build          # tsup → dist/ (required before test — see below)
pnpm run lint           # tsc --noEmit -p tsconfig.lint.json
pnpm run lint:tests     # tsc --noEmit -p tsconfig.test-lint.json
pnpm run lint:hygiene   # 静态卫生 + core 子域边界（两条 node 脚本）
pnpm run test           # vitest run
pnpm run verify:examples  # docs/examples command matrix (exit codes)
pnpm run verify:docs      # doc code samples still run
```

**Build before test is mandatory.** Vitest aliases packages to `src`, but `@nudo:env` dynamic imports resolve `@nudojs/*` through package.json `exports` to `dist/`. CI runs `build` before `test` for the same reason; do the same locally.

Also useful:

```bash
pnpm run check <file>     # product gate + signatures on a sample
pnpm run test:cli <file>  # case reports
pnpm run nudo -- <args>   # full CLI (contract / export / health / migrate)
pnpm run lint:website     # docs site types
```

## Code review expectations

### No ESLint / no Prettier — type-check only

Linting in this repo is **`tsc --noEmit` only**. That is intentional:

- The type system and diagnostics are the product; style tooling was noise against that.
- Strict TypeScript already catches a large class of real defects.
- Contributors keep one mental model: if `pnpm run lint` is clean, style is not a review gate.

Because there is no style linter, **reviewers** must watch what the type-checker cannot:

- **Unused code** — dead helpers, leftover experimental paths, unreferenced exports.
- **`as` creep in tests** — type assertions that hide real type errors or paper over API drift. Prefer fixing types over `as`.
- **Comment rot** — comments that describe deleted behavior, wrong invariants, or stale design decisions. Update or delete them in the same PR.

### 回归钉：按特性族聚合，不再一 bug 一文件

`packages/*/src/__tests__/` 现有 2150+ 个测试文件，其中约 1350 个是 `*-bug-NNN-*.test.ts`
单案回归钉。文件数本身已成为 CI 调度成本（`vitest.config.ts` 的 4 worker / 30s 超时 /
2 shard）。新增回归时：

- **优先**追加到同族的表驱动文件（`it.each` / case 表），或并入已有的同族 `-bug-`
  文件；确需新文件时在 PR 里说明为什么不能合并。
- **按族收敛入口已对 16 个族启用**：`scripts/aggregate-tests.mjs` 把同族
  `*-bug-NNN-*.test.ts` 原地改名为 `*.part.ts`，由 `zz-agg-<族>.test.ts` import，
  vitest 入口从 N 降到 1。2026-11-05 全量试点（20 族 / 1329 文件）曾暴露
  **模块共享污染**（同一入口内的 part 共享模块实例 ⇒ 全局注册表 / oracle /
  缓存互相影响，新增 15 条失败）并整体回滚；随后按静态特征分级：
  **S**（无 `vi.mock` / 无模块级可变态 / 无 registry 写入）、
  **M**（fs / `process` 写入均成对复位）、
  **R**（模块级 `vi.mock`、共享 memo 复位覆盖率低、`vi.hoisted` 单例）。
  逐族 `--apply --only <group-key>` 验证后启用 S 2 + M 9 + 首批 3 = **14 族，
  410 文件 → 14 入口**（全仓 vitest 入口 2005 → 1769）；
  `tsconfig.test-lint.json` 已纳入 `*.part.ts`。
  **2026-11-06 再启用 2 个 R 级族**：脚本新增第 5 条 guard（模块级
  `vi.mock` / `vi.hoisted` 自动排除，如 `service-bug-045` 保留独立入口）与
  `--revert-only <key>` 单族回退；`vscode-host-stub.ts::makeExtensionContext`
  补 activate 前的注册表面复位。`vscode/.../lsp` 6 + `service/.../service` 114
  = **120 文件 → 2 入口**（全仓 1769 → 1651），逐族验证 0 新增失败。
  **剩余 4 个 R 级族 / 795 文件仍不得套用**：全量试聚合新增 7 条失败
  （core/eval/lsp/cli 共享 memo / registry / stub 与 watch 事件假设），已用
  `--revert-only` 精确回退 ⇒ 需逐族补统一复位后再验证。
  **纪律**：① 每次 `--apply` 必须带 `--only <完整 key>`（不带会一次性套用
  全部剩余族，`--only` 是**精确 key 相等**，不是目录前缀）；② `--revert`
  是**全局**的且忽略 `--only`（会还原全部已启用族）——单族回退用
  `node scripts/aggregate-tests.mjs --revert-only <完整 key>`（2026-11-06 新增：
  只还原该族 part + 删除该族入口，其余族不动，不必手工 `git mv`）；
  ③ 大族（≥50 文件）单入口验证带
  `NODE_OPTIONS=--max-old-space-size=8192`（与 `pnpm test` 同口径）；
  ④ 单跑某条用例用 `pnpm vitest run <聚合入口> -t "<case name>"`；
  ⑤ 脚本会**自动排除**模块级 `vi.mock` / `vi.hoisted` 文件（worker 级注册会
  串到同入口其它 part），这类文件保留独立入口，不要手工塞回。
  ⑥ 大族入口单个文件耗时过长时，用
  `node scripts/aggregate-tests.mjs --split <完整 key> --max-parts 10` 拆成
  多个 `zz-agg-<族>-N.test.ts`（只重排 import，不重命名 part）。Vitest 的
  `--shard` 按文件 hash + **等文件数**切分，不按时长——一个 400s 的入口会
  钉死整个 shard。2026-11-09 已对 `nudojs` / `migrate` / `emit` 三个大族启用。
- **全仓基线对比（按宿主）**：宿主面（`Float16Array` / ES 全局清单）、`fs.watch`
  事件数与临时路径归一化会随平台 / Node 大版本漂移，基线按
  `<platform>/<node major>`（如 `darwin/22`、`linux/24`）分桶，固化在
  `docs/reports/test-baseline-failures.json`。全量跑完用
  `pnpm run test:baseline -- /tmp/nudo-test.log` 对比**当前宿主**的桶：**新增失败一律判红**，
  基线项偶尔不出现只告警（flaky 不制造假红）。修好某条或聚合改了文件名后
  跑 `pnpm run test:baseline -- --update /tmp/nudo-test.log` 只重写当前宿主条目；
  未登记宿主当空基线（任何失败都是新增，先跑全量再 `--update`）。
- **金标不合并**：`check-recall-gold` / real-package zero-FP / 差分语料保持独立——
  它们是产品精度门禁，不是回归钉。
- **harness 只走共享入口**：service 用 `__tests__/tmp-project.ts`，nudojs 用
  `__tests__/helpers/tmp-project.ts`；固定 prefix 的薄适配可以保留一层，但不得
  重新实现 `mkdtempSync` / 清理逻辑。
- `pnpm run lint:hygiene` 兜住 `tsc` 看不到、此前靠 reviewer 人工盯的几类问题：
  无说明的空 `catch`、内联 harness 复制、非 CLI 生产源码里的 `console.log`，
  以及 `algebra/` 顶层继续平铺。新增检查规则同样要有明确理由，不做风格 linter。

### Root `devDependencies` that look dead but are not

A static import scan over `packages/**/src` will flag these root `devDependencies` as unused. They are real runtime dependencies of non-package surfaces (fixtures, benchmark corpora) whose resolution only reaches the repo root's `node_modules` — deleting any of them turns a gate red with no corresponding code change:

| Dep | Real consumer | Gate that goes red when removed |
|---|---|---|
| `ms` | [`docs/examples/retire-real/after`](./docs/examples/retire-real/) — the fixture declares `ms` in its own `package.json` but is never installed; `resolveNpmJsEntry` walks up the directory tree and resolves to the root `node_modules/ms` | `pnpm run verify:examples` / `verify:docs` — the `retire-real` fixture's check signature degrades to `unknown` (pinned output goes red) |
| `semver`, `yargs`, `commander` | `benchmark/oss/packages.mts` `OSS_PACKAGES` corpus — `resolvePackageRoot` resolves package roots via `require.resolve` from `packages/core/src`, reachable only through the root `node_modules` | `pnpm run benchmark` / `benchmark:gate` — corpus packages fail to resolve |

`commander` is additionally a declared dependency of `packages/nudojs` (that copy is visible); the root copy serves the benchmark corpus. Before removing any root `devDependency`, grep `docs/examples/` fixtures' `package.json` files and `benchmark/` corpora, not just `packages/**/src`.

### Scope and docs

- Keep PRs focused; do not mix refactors with product changes when avoidable.
- Product CLI semantics are documented in [`docs/design/cli-semantics.md`](./docs/design/cli-semantics.md). If you change a verb, flag, exit-code contract, or `any`/`unknown` display, update that doc in the same PR.
- Architecture / trust-boundary changes: [`docs/design/kernel-merge.md`](./docs/design/kernel-merge.md). Still-binding limits: [`docs/design/limitations.md`](./docs/design/limitations.md).
- Runnable samples live in [`docs/examples/`](./docs/examples/); `pnpm run verify:examples` pins their exit codes.

### Commits and release

- Versioning uses @changesets (`main` is the base branch). Include a changeset when a published package's behavior or API changes.
- **Beta:** `dev` is the beta train. Push to `dev` runs the `release-beta` job in `release.yml` (lint/test → version if needed → publish `x.y.z-beta.n` under npm tag `beta`). Enter/exit with `npx changeset pre enter beta` / `pre exit`. Stable stays on `main` (same workflow, `release` job). npm Trusted Publishing is bound to the `release.yml` filename — do not split publish into another workflow file.

## Where things live

| Path | Role |
|---|---|
| `packages/core` | Abs type system (algebra, format, refinements) |
| `packages/parser` | Babel parse + `@nudo:` directive extraction |
| `packages/service` | Analysis core (analyzer + Abs evaluator + caches) |
| `packages/nudojs` | Product CLI verbs (bin `nudo`) |
| `packages/lsp` | IDE surface + language server |
| `packages/env` / `packages/harvester` | API environments / `@types` harvest |
| `docs/design/` | Design sources of truth (not tutorials) |

> **`@nudojs/core` dual-mapping footgun.** When a `tsconfig` maps `@nudojs/core` to `src`, it must also map `@nudojs/core/internal` → `packages/core/src/internal.ts`. Mapping only `.` while letting `./internal` resolve to `dist` loads **two** copies of engine machinery (e.g. may-throw collectors) and silently drops soft may-throw effects. See [`packages/core/PUBLIC_API.md`](./packages/core/PUBLIC_API.md).
