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
pnpm run test:local     # 本地快车道：按需 build + CLI e2e 走 dist（见下）
pnpm run verify:examples  # docs/examples command matrix (exit codes)
pnpm run verify:docs      # doc code samples still run
```

**Build before test is mandatory.** Vitest aliases packages to `src`, but `@nudo:env` dynamic imports resolve `@nudojs/*` through package.json `exports` to `dist/`. CI runs `build` before `test` for the same reason; do the same locally.

`pnpm run test:local ...` 是本地快车道：dist 落后于非测试源码时才重建（纯测试
改动跳过），CLI e2e 以 `NUDO_TEST_CLI=dist` 跑（每次 spawn 0.9s → 0.22s），
worker 数按本机核数取（CI 仍 4）。2026-11-17 实测（16 核）：

| 命令 | 面 | 用时 |
|---|---|---|
| `pnpm run test:local -- --changed` | 变更相关（日常内循环；与 CI PR 同口径） | 秒级 |
| `pnpm run test:local --fast` | 全量减去 CLI e2e 目录与真实包扫描 | ~68s（893 文件） |
| `pnpm run test:local` | 全量（预推送自检） | ~107s（978 文件 / 12438 用例） |

CI 不跑 `test:local`：PR / dev push 用 `--changed`（+ `test:fs-input`），
main push 与 nightly 才跑全量——那是发布门禁。

耗时用例分层（选面依据，不按文件数看）：

- **unit**：core / service 投影 / env / parser 的引擎与代数断言（单用例多为 ms 级）。
- **进程级 e2e**：`packages/nudojs/src/__tests__/`（958 用例，占测试体时长约一半；
  每条 2–5 次 CLI spawn）。
- **真编译门禁**：`service/emit` 里调 `tscNoEmit` 的 15 个文件（222 用例，真 tsc）。
- **外部 oracle**：`check-real-*`（真实 npm 包）+ harvester 真实 `@types` 语料。

后三类只在 `--changed` 命中、或全量门禁（main / nightly / 预推送）里执行。
`--fast` 与 `--changed` 互斥（快面排除 CLI e2e，组合会静默漏测）。

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

### 测试结构：describe = 特性/上下文，it = 单一可观测行为

BDD 口径落在 vitest 树上：

- `describe` 描述**被验证的特性/上下文**（Given），可以套嵌表达前置条件；不得
  用同名 describe 再包一层，也不得带缺陷号/批次代号（`Bug 123` / `族 12` / `#123`）。
- `it` 描述**一个可观测行为**（When → Then）：返回值、诊断码/文案、退出码、
  产物文本。断言必须钉具体可观测值，不得只断言「不抛 / 非空」。
- 矩阵化套件（同一 describe 下大量同构场景）允许把多个场景名合并进一个 `it`
  标题，用 `；` 分隔；场景体用独立**块语句**承载：

  ```ts
  describe("absToTSType", () => {
    it("字面量 number ⇒ 42；字面量 string ⇒ \"hello\"", () => {
      { expect(absToTSType(numLit(42))).toBe("42"); }
      { expect(absToTSType(strLit("hello"))).toBe('"hello"'); }
    });
  });
  ```

  需要提前退出用 labeled block（`__scenario_1: { … break __scenario_1; … }`），
  **禁止** `(() => { … })()` / `await (async () => { … })()` 承载场景：它会毁掉
  失败定位、`-t` 过滤与覆盖率归因，并留下 `;;` 空语句。
- 场景段不得为空或相邻重复；同一场景的多个面拆成同一块的多个断言，而不是
  重复场景名。

门禁：`scripts/check-test-structure.mjs`（挂在 `lint:hygiene`）拒绝 IIFE 场景、
空语句、同名 describe 套嵌、describe 标题里的缺陷号/批次代号、空/重复场景段。

### 回归测试：按模块/不变量归属，不按缺陷编号拆文件

`packages/**/__tests__/` 现有 1043 个测试相关 `.ts`（978 个入口 + 65 个
harness/helper），`*.part.ts` = 0。**2026-11-15 起不再有缺陷编号命名**：历史
1360 个 `*-bug-NNN-*` 已改为 `<domain>-<特性>.test.ts`（旧 `--` 分隔亦已清除），命名门禁
（`scripts/check-test-names.mjs`，挂在 `lint:hygiene`）拒绝新增此类文件名。
**巨型 e2e 套件按面拆分，不要聚合成单文件**：vitest 以文件为并行粒度（1 文件
= 1 worker），单文件内用例串行；CLI e2e 单文件 200s+ 会把全量墙钟钉死。
门禁覆盖 `__tests__/**` 下**全部 `.ts`**（含 harness/helper）；缺陷编号与计划
批次代号（`absNN` / `p0` / `c41` / `phase2` / `w9` …）都不得作为文件名；编号
只能出现在 `it` 标题、commit、changeset。
缺陷编号是批次内的局部编号，会跨批次复用（如 `core-254` 的两组文件互不相关），
不能当稳定身份；文件应是模块规格的载体，不应随缺陷生命周期增删。新增回归时：

- **先回答“原测试为什么没覆盖”**，四选一并据此选动作：① 该层/该形态没测；
  ② 夹具形状漏了（array-like / spread / 可选链……）⇒ 修原夹具；③ 旧断言钉了
  错误行为 ⇒ 改/删旧断言，**不得**并存 re-pin；④ 门禁没跑到（路径/矩阵遗漏）
  ⇒ 修门禁。答案写进 PR，不写成一个新文件的由来。
- **默认修改该模块的表驱动用例**（`it.each` / case 表）；同一根因的多个面是
  加行/加维度，不是加文件。
- **文件名描述模块/特性，缺陷编号只出现在 `it` 标题、commit、changeset。**
  不要按缺陷编号新建测试文件。
- 仅三种理由允许新建文件：该模块没有套件；需要不同 harness（spawn CLI / fs
  布局 / native oracle）；跨模块产品契约（CLI exit code / dts）。
- 表 / 镜像 / 注册表类根因必须同时补**完整性/漂移门禁**（枚举发射点或键集，
  新成员未入表即红），不要只补样例。
- **按族收敛入口已对 21 个族启用**：`scripts/aggregate-tests.mjs` 把同族
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
  **2026-11-15 收口剩余 4 个 R 级族**：core 314 + eval 145 + misc 22 + lsp 141
  + cli 154 = **776 个 part → 81 个入口**（`--max-parts 10` 切分），逐族全绿；
  历史「共享 memo / registry / stub」污染在统一复位（`resetEngineCaches`）后
  未复现。全仓入口 1744 → 1049（含 113 个 `zz-agg` 入口）。大族必须继续按
  `--max-parts 10` 切分，不要一次性整族单入口聚合（单入口会钉死 shard）。
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
  `tmp/test-baseline-failures.json`（本地生成，不入库）。全量跑完用
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
