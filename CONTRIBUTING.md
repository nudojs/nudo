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
