---
slug: /guides/case-study-retire
description: Public retire-tsc case studies — checkout-demo, real packages ms and debug. One-way door, no dual-run endgame.
---

# Case study: retire tsc

**You'll leave with:** three runnable stories of teams leaving `tsc` on JavaScript packages — a public sample, and two consumers of real npm packages.

End state is always the same: **`nudo check` is the only gate; `typescript` is gone.** Coexistence is a migration tactic, not the destination. Command walkthrough: [Migrate from TypeScript](./migrating-from-typescript).

## The one-way door

```text
audit (migrate status) → strip → verify (nudo check) → retire (drop tsc)
```

`migrate retire` also rewrites `tsc` lines in `.github/workflows` and `package.json` scripts (`--all` batches a monorepo). Dual-run exists only as `migrate verify --with-tsc` during the move.

## 1. checkout-demo (public sample)

| | before | after |
|---|---|---|
| What | TypeScript checkout helpers | Plain JS |
| Gate | `tsc --noEmit` | `nudo check src` |
| Story | Synthetic but complete | Committed after/ is the gold end state |

Source: [`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate)

## 2. Real package: `ms` (vercel/ms)

A consumer of the real [`ms`](https://github.com/vercel/ms) formatter (pure JS, very common) moves from TS + `@types/ms` to JS + `nudo check`. **The dependency does not change.**

| | before | after |
|---|---|---|
| Language | `age.ts` + `ms.d.ts` | `age.js` |
| Gate | `tsc --noEmit` | `nudo check` |
| `typescript` dep | yes | **no** |
| Real dep | `ms@^2.1.3` | same |

Source: [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real)

```bash
npx nudojs migrate status docs/examples/retire-real/before
npx nudojs migrate strip docs/examples/retire-real/before/src/age.ts --write
npx nudojs contract --from-dts docs/examples/retire-real/before/src/age.ts
npx nudojs check docs/examples/retire-real/after/src/age.js
npx nudojs migrate retire docs/examples/retire-real/after --dry-run
```

## 3. Real package: `debug` (visionmedia/debug)

Same door on [`debug`](https://github.com/debug-js/debug) — the log facade behind half of npm.

| | before | after |
|---|---|---|
| Language | `logger.ts` + `debug.d.ts` | `logger.js` |
| Gate | `tsc --noEmit` | `nudo check src` |
| Real dep | `debug@^4.3.4` | same |

Source: [`docs/examples/retire-debug/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-debug)

**Honest edge:** `debug()` is a native entry. After strip, its return face can stay **`unknown`** (engine debt warning, not a contract failure). With `@types/debug` present, harvest fills signatures; or pin with `@nudo:mock` / `refine return`. That is the same story as `ms()`.

## What these prove

| Claim | Evidence |
|-------|----------|
| JS stays JS | after/ sources are plain `.js` |
| Contracts are optional obligations | `contract --from-dts` → review → `*.nudo.js` |
| Exit is retire, not dual-run | `.nudo/migrate-retired.json` + no `typescript` dep |
| Real packages move | `ms` and `debug` are not synthetic fixtures |

## Run the matrix

```bash
pnpm run verify:examples
```

Every command above is CI-pinned in [`docs/examples/README.md`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md).

## Next

- [Migrate from TypeScript](./migrating-from-typescript) — the door itself
- [Error faces](./error-faces) — what you read after the gate
- [Mental model](../getting-started/mental-model) — 10 minutes
