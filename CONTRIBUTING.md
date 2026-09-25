# Contributing to Nudo

Thanks for contributing. This checklist keeps PRs reviewable and CI green.

## Before you open a PR

Run these in order from the repo root (Node.js >= 20, pnpm 9.1.0):

```bash
pnpm install            # workspace deps
pnpm run build          # tsup → dist/ (required before test — see below)
pnpm run lint           # tsc --noEmit -p tsconfig.lint.json
pnpm run lint:tests     # tsc --noEmit -p tsconfig.test-lint.json
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
| `packages/service` | Analyzer orchestration + Abs evaluator |
| `packages/cli` | Product CLI verbs |
| `packages/lsp` | Language server |
| `packages/env` / `packages/harvester` | API environments / `@types` harvest |
| `docs/design/` | Design sources of truth (not tutorials) |
