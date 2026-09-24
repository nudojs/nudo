---
slug: /guides/case-study-retire
description: Public retire-tsc case studies — checkout-demo, real packages ms and debug. One-way door, no dual-run endgame.
---

# Case study: retire tsc

**You'll leave with:** a forwardable migration playbook — before/after diagnostics, the command sequence `status → strip → verify → retire`, and honest friction notes — backed by runnable samples in this monorepo.

End state is always the same: **`nudo check` is the only gate; `typescript` is gone.** Coexistence is a migration tactic, not the destination. Command walkthrough: [Migrate from TypeScript](./migrating-from-typescript).

> **Honesty label.** Every package below is an **example-scale** sample from [`docs/examples/`](https://github.com/nudojs/nudo/tree/main/docs/examples) (two real npm *consumers*, one public demo package). Timings and friction counts are **示例级，非生产规模** — not a production migration audit. Do not invent external company names; the evidence is the committed `before/` / `after/` trees and `pnpm run verify:examples`.

## The one-way door

```text
audit (migrate status) → strip → verify (nudo check) → retire (drop tsc)
```

Copy-ready sequence (paths swap for your package):

```bash
# 0. audit — what still carries tsc
npx nudojs migrate status ./my-pkg

# 1. strip — .ts → .js (annotations out, runtime stays). --write to emit.
npx nudojs migrate strip ./my-pkg/src --write

# 2. optional — reverse old annotations into a reviewable contract draft
npx nudojs contract --from-dts ./my-pkg/src/index.ts
#    → @nudo:draft (NOT enforced until you copy it into *.nudo.js)

# 3. verify — nudo check must pass on the stripped JS
npx nudojs migrate verify ./my-pkg/src

# 4. retire — drop typescript, rewrite tsc scripts / GHA lines, write marker
npx nudojs migrate retire ./my-pkg --dry-run   # then drop --dry-run
```

| Step | Effect | Exit when |
|------|--------|-----------|
| `status` | Counts `.ts`, finds `tsc` scripts + `typescript` dep, lists **blockers** | You know the surface area |
| `strip` | `.ts` → `.js`; optional best-effort sidecar draft | Sources are plain JS |
| `verify` | Runs `nudo check` on the stripped JS (optional `--with-tsc` dual-run **during** the move only) | Gate is green |
| `retire` | Drops `typescript`, rewrites `tsc` scripts → `nudo check`, rewrites `.github/workflows`, writes `.nudo/migrate-retired.json` | **tsc is gone** |

`migrate retire --all` batches a monorepo. Dual-run exists only as `migrate verify --with-tsc` during the move — never as the endgame.

## 1. checkout-demo (public sample)

| | before | after |
|---|---|---|
| What | TypeScript checkout helpers | Plain JS |
| Gate | `tsc --noEmit` | `nudo check src` |
| Story | Synthetic but complete | Committed after/ is the gold end state |

Source: [`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate)

### Before → after (code)

```typescript
// before/src/math.ts
export function lineTotal(price: number, qty: number): number {
  return price * qty;
}
```

```javascript
// after/src/math.js — runtime unchanged
export function lineTotal(price, qty) {
  return price * qty;
}
```

Cross-file: `type Item = { … }` in `cart.ts` is **deleted** (TS-only; it never existed at runtime). Imports stay.

### Before → after (diagnostics)

**Before** is a `tsc --noEmit` type name. **After** is a Nudo signature (printed even on success) plus optional L1/L2 faces:

```text
nudo check  docs/examples/migrate/after/src/math.js
OK
  0 error · 1 warning · 0 info · 3 fn

signatures
  lineTotal(price: any, qty: any) => number
  applyCoupon(total: any, percent: any) => number  throws RangeError
  formatMoney(cents: any) => string

issues
  [WARNING L9 applyCoupon] applyCoupon (export): may throw RangeError  (nudo:entry-may-throw)
      → throw RangeError → @nudo:throws RangeError / refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

Read that as: signatures still print; unconstrained params are **`any`** (not `unknown`); the intentional `throw` surfaces as **L2** with a next step. The after package flips it to warning via `package.json#nudo.check.entryThrows` if you want a softer first week.

Tighten later and the face becomes value + predicate (not a type name) — see [Error faces](./error-faces):

```text
actual:   -1  #exact
expected: x > 0
→ use a value satisfying x > 0
fix:  nudo contract --draft
```

## 2. Real package: `ms` (vercel/ms)

A consumer of the real [`ms`](https://github.com/vercel/ms) formatter (pure JS, very common) moves from TS + `@types/ms` to JS + `nudo check`. **The dependency does not change.**

| | before | after |
|---|---|---|
| Language | `age.ts` + `ms.d.ts` | `age.js` |
| Gate | `tsc --noEmit` | `nudo check` |
| `typescript` dep | yes | **no** |
| Real dep | `ms@^2.1.3` | same |

Source: [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real)

### Command sequence (actual)

```bash
# status — audit face (real output)
npx nudojs migrate status docs/examples/retire-real/before
#   ts files: 2  tsx: 0  tsconfig: yes  typescript dep: yes
#   tsc scripts: typecheck
#   blockers: tsc still in scripts; no nudo check/test script yet; typescript still in dependencies

# strip — dry-run in this repo; --write emits
npx nudojs migrate strip docs/examples/retire-real/before/src/age.ts

# reverse annotations into a draft you must review
npx nudojs contract --from-dts docs/examples/retire-real/before/src/age.ts
#   export const formatAge = fn({ durationMs: number() }, string());
#   export const parseAge   = fn({ text: string() }, number());
#   → copy into age.nudo.js only after review (that is when L1 goes live)

# verify / gate on the committed after/
npx nudojs check docs/examples/retire-real/after/src/age.js

# retire — dry-run first
npx nudojs migrate retire docs/examples/retire-real/after --dry-run
```

### Before → after (code + gate)

```typescript
// before/src/age.ts
export function formatAge(durationMs: number): string {
  return ms(durationMs, { long: true });
}
```

```javascript
// after/src/age.js
export function formatAge(durationMs) {
  return ms(durationMs, { long: true });
}
```

Accepted sidecar (`after/src/age.nudo.js`) — the draft above, reviewed:

```javascript
import { fn, number, string } from "@nudojs/core";

export const formatAge = fn({ durationMs: number() }, string());
export const parseAge = fn({ text: string() }, number());
```

Post-retire check face (example-scale; native `ms()` is not fully harvested here):

```text
signatures
  formatAge(durationMs: number) => unknown | string
  parseAge(text: string) => undefined

issues
  [WARNING parseAge] parseAge: signature has true unknown (inference failed)  (nudo:unknown-inference)
      → add @nudo:case / env mock / refine, or confirm the body is algebraically evaluable
```

Marker after a real retire: `.nudo/migrate-retired.json` (rewritten `typecheck: tsc --noEmit → nudo check src`, `typescript` removed).

## 3. Real package: `debug` (visionmedia/debug)

Same door on [`debug`](https://github.com/debug-js/debug) — the log facade behind half of npm.

| | before | after |
|---|---|---|
| Language | `logger.ts` + `debug.d.ts` | `logger.js` |
| Gate | `tsc --noEmit` | `nudo check src` |
| Real dep | `debug@^4.3.4` | same |

Source: [`docs/examples/retire-debug/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-debug)

```bash
npx nudojs migrate status docs/examples/retire-debug/before
npx nudojs migrate strip docs/examples/retire-debug/before/src/logger.ts
npx nudojs contract --from-dts docs/examples/retire-debug/before/src/logger.ts
#   → export const createLogger = fn({ namespace: string() }, any());
npx nudojs check docs/examples/retire-debug/after/src/logger.js
npx nudojs migrate retire docs/examples/retire-debug/after --dry-run
```

**Honest edge:** `debug()` is a native entry. After strip, returns stay **`unknown`** / `conf=opaque` (engine-debt face, not a contract failure):

```text
signatures
  createLogger(namespace: any) => unknown
  logHello(name: any) => unknown

issues
  [INFO createLogger] createLogger(...): conf=opaque (path not covered, or native)  (nudo:opaque-result)
      → add @nudo:case or a call site
```

With `@types/debug` present, harvest fills signatures; or pin with `@nudo:mock` / `refine return`. That is the same story as `ms()`.

## Friction and time (example-scale)

| Friction | Where it showed up | What fixed it | Cost (example-scale) |
|----------|--------------------|---------------|----------------------|
| `tsc` scripts + `typescript` dep still present | `migrate status` blockers list | `migrate retire` rewrites scripts; drops dep | One command (`--dry-run` first) |
| Old annotations become obligations only if you accept them | `contract --from-dts` emits `@nudo:draft` | Review → copy into `*.nudo.js` | Minutes per file; **never silent** |
| Native / unharvested deps (`ms()`, `debug()`) | `unknown` / `conf=opaque` / `nudo:unknown-inference` | `@types/*` harvest, `@nudo:mock`, or `refine return` | Bounded; stays a **warning** until you pin |
| L2 `entry-may-throw` on intentional `throw` | checkout-demo `applyCoupon` | `@nudo:throws RangeError` / guard, or `nudo.check.entryThrows: "warning"` | One line in `package.json` or a throws directive |
| Dual-run temptation | mid-migration CI | Keep `verify --with-tsc` **only** during the move; retire is the exit | Policy, not tooling |

**Wall-clock (示例级，非生产规模):** these samples are small (2–3 modules, ~1–2 files stripped per package). The committed trees are the evidence — run `pnpm run verify:examples` yourself. We do **not** publish production-scale hour/days numbers; a “7-day retire path” in release notes is a *product target narrative*, not a measured median. For a real package, budget by `.ts` file count from `migrate status`, not by blog post.

## What these prove

| Claim | Evidence |
|-------|----------|
| JS stays JS | after/ sources are plain `.js` |
| Contracts are optional obligations | `contract --from-dts` → review → `*.nudo.js` |
| Exit is retire, not dual-run | `.nudo/migrate-retired.json` + no `typescript` dep |
| Real packages move | `ms` and `debug` are not synthetic fixtures |
| Honest engine debt | `unknown` / opaque stays visible; never faked as success |

## Run the matrix

```bash
pnpm run verify:examples
```

Every command above is CI-pinned in [`docs/examples/README.md`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md).

## Share this story

Copy-ready blog / HN / release-notes text: [`docs/reports/retire-tsc-announcement.md`](https://github.com/nudojs/nudo/blob/main/docs/reports/retire-tsc-announcement.md).

## Next

- [Migrate from TypeScript](./migrating-from-typescript) — the door itself
- [Error faces](./error-faces) — what you read after the gate
- [Mental model](../getting-started/mental-model) — 10 minutes
