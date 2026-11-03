---
slug: /guides/migrating-from-typescript
description: Retire tsc with nudo migrate — status → strip → verify → retire. Coexistence is a migration tactic, not the end state.
---

# Migrating from TypeScript

**You'll leave with:** the one-way door off `tsc` (`nudo migrate`), when a package is ready to retire, and honest exceptions where TypeScript should stay.

**End state for a JS-first package: `tsc` is gone.** Nudo is built to **replace** the TypeScript gate on JavaScript — not to sit beside it forever. Coexistence is a **migration tactic** with a named exit (`migrate retire`).

Related: [Mental model](../getting-started/mental-model.md) · [Why Nudo](../why-nudo.md) · [Nudo vs TypeScript](./vs-typescript.md) · [Error faces](./error-faces.md) · [Migrate existing JS](./migrating-js.md)

## Decide first

| Situation | Recommendation |
|-----------|----------------|
| New or existing **`.js`** packages | **Adopt Nudo** and skip `tsc` entirely |
| `.ts` / mixed package whose runtime is JS | **Retire tsc** with [`nudo migrate`](#path-r--retire-tsc-nudo-migrate) |
| Mixed monorepo, package-by-package | Migrate **per package**; temporary coexistence only while packages remain |
| Annotation-first `.ts` monorepo where the **type language is the product** | Stay on TypeScript (Nudo is not a `tsc` clone) |
| npm consumers need `.d.ts` | `nudo export --format dts` as a one-way projection — not a second source of truth |

Nudo analyzes **JS semantics**. Pointing it at `.ts` strips annotations — use `migrate strip` for that, then retire.

## What changes (and what does not)

| TypeScript habit | Nudo counterpart |
|------------------|------------------|
| Annotate params/returns in source | Observation: `nudo check` prints signatures (`any` until evidence/contracts) |
| `tsc --noEmit` in CI | `nudo check` in CI (still prints signatures on success) |
| `interface` / mapped types as obligations | Sidecar `*.nudo.js` builders (`fn`, `shape`, `number().gt(0)`) + optional `@nudo:contract` |
| Hover shows declared type | Hover / inlay show Abs facts (term / pred / conf) |
| `.d.ts` is the model | `.d.ts` is a **lossy export**; Abs is the model |
| Refactors change annotations | Refactors change **evidence** (call sites) and/or **contracts** |

**Work modes** (same checker):

1. **Logic first** — keep/implement JS → `contract --draft` → review → `*.nudo.js`
2. **Contracts first** — write the sidecar / `@nudo:contract` first → implement under that face

`nudo check` only validates. Schema/dts/guards come from `nudo export`.

## Path R — retire tsc (`nudo migrate`) {#path-r--retire-tsc-nudo-migrate}

The product migration path. One-way door: audit → strip → gate → drop TypeScript.

```bash
npx nudojs migrate status ./my-pkg
npx nudojs migrate strip ./my-pkg/src --write
npx nudojs migrate verify ./my-pkg/src
npx nudojs migrate retire ./my-pkg          # add --dry-run first
```

| Step | What it does | Exit when |
|------|--------------|-----------|
| `status` | Counts `.ts`/`.tsx`, finds `tsc` scripts and the `typescript` dep, lists **blockers** (including workflow tsc lines) | You know the surface area |
| `strip` | `.ts` → `.js` (type annotations out; runtime semantics stay). `--write` emits files + best-effort sidecar draft (`--no-draft` skips) | Sources are plain JS |
| `verify` | Runs `nudo check` on the stripped JS | Gate is green |
| `retire` | Drops `typescript` from deps, rewrites `tsc` scripts → `nudo check`, **rewrites `.github/workflows` tsc lines**, writes `.nudo/migrate-retired.json` | **tsc is gone** |

Monorepo batch: `npx nudojs migrate retire ./repo --all` walks every workspace package that still carries `tsc` / `typescript`. `--no-workflows` leaves CI YAML alone.

Sample `status` face:

```text
migrate status

  my-pkg
    ts files: 2  tsx: 0  tsconfig: yes  typescript dep: yes
    tsc scripts: typecheck
    blockers: tsc still in scripts; no nudo check/test script yet; typescript still in dependencies

next: nudo migrate strip <path>  →  verify  →  retire <pkg>
```

Convert annotations into reviewable contracts **before** you trust them:

```bash
npx nudojs contract --from-dts ./my-pkg/src/index.ts
# → @nudo:draft (NOT enforced until you copy it into *.nudo.js)
```

Handwritten `*.nudo.js` always wins over drafts.

### Real-package story

| Sample | What it shows |
|--------|----------------|
| [`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate) | Public **checkout-demo**: TS+tsc → JS+nudo (before/after gate) |
| [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real) | Consumer of real npm **`ms`** retires tsc; dependency unchanged |

Same story, one table:

| | before | after `migrate retire` |
|---|---|---|
| Language | `.ts` + annotations | plain `.js` |
| CI gate | `tsc --noEmit` | `nudo check` |
| `typescript` dep | yes | **no** |
| Marker | — | `.nudo/migrate-retired.json` |

## Path A — start beside TS apps, then retire that package

Typical monorepo: `apps/*` in TS, `packages/*` tools you want off `tsc`.

1. **Scope** — one package (CLI, worker, script layer). Not the whole monorepo on day one.
2. **Observe** — `npx nudojs check packages/tool/src`. Read signatures; unconstrained entries are **`any`**.
3. **Contracts** — logic first (`contract --draft --from tests/`) or contracts first (sidecar / `@nudo:contract`).
4. **Gate** — run `nudo check` for that package path in your workflow.
5. **Retire that package** — `migrate status` / `strip` / `verify` / `retire` on it. Do not leave `tsc` as a second permanent gate.
6. **Ecosystem** — if other packages still consume types:

   ```bash
   npx nudojs export packages/tool/src/index.js --format dts --out packages/tool/dist/types
   ```

7. **IDE** — VS Code / Zed extension for hover, inlays, CodeLens.

Temporary dual gates are fine **during** the package migration. They are not the product end state.

## Path B — “TS-shaped” logic you refuse to annotate forever

1. Turn off `// @ts-check` pressure once `nudo check` is in CI.
2. Replace JSDoc type theater with **sidecar contracts** only where you need obligations.
3. Mine call sites from tests (`--from test/`); **widen** drafts before accepting.
4. Export dts **for consumers**, not as the model you maintain.

## Keeping handwritten .d.ts (the escape hatch) {#keeping-handwritten-dts}

When a package's public surface is **type-level work** — React `props` gymnastics, conditional or mapped types as the API — Nudo does not ask you to translate it (see [capability bounds](./vs-typescript.md#capability-bounds-engine-non-goals)). The supported coexistence is narrow and verified:

**Handwritten `.d.ts` serves TS-ecosystem consumers; `nudo check` gates only the JS.**

| Question | Verified answer | Command |
|----------|-----------------|---------|
| Does `check` touch my declarations? | No — directory walks analyze `.js/.mjs/.ts` only; `types/*.d.ts` yields no diagnostics (fixture run listed `src/fixture.js` only, `OK`) | `npx nudojs check ./pkg` |
| What if I pass one directly? | Rejected, exit 1: `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX)` | `npx nudojs check types/foo.d.ts` |
| Will `export --out` clobber them? | No — a same-name file without the `// nudo-export-module:` marker is refused (exit 1 + `fix:` hint); nudo-generated files do regenerate in place | `npx nudojs export src/index.js --format dts --out types/` |
| Can declarations draft contracts? | Yes, drafts only: output is `@nudo:draft`, **never loaded for check**; obligations go live when you copy accepted exports into `*.nudo.js` | `npx nudojs contract --from-dts types/foo.d.ts` (`--write` saves `foo.nudo.draft.ts` beside it) |
| Does `migrate` count them as TS debt? | No — `migrate status` counts `.ts`/`.tsx` sources, not `.d.ts`; `retire` removes tsc, not your declarations | `npx nudojs migrate status ./pkg` |

Placement rule: keep handwritten declarations in their own directory (`types/`) with `package.json` `"types"` / `exports.types` pointing at it, and aim `nudo export --out` at a **different**, generated-only directory (`dist/types`) — the overwrite guard then never has to fire.

The model Nudo checks against is still **Abs + contracts**; a handwritten `.d.ts` is ecosystem output, same tier as a generated one — never the source of truth.

## Review checklist (contracts)

1. **Params** — call-site shapes are evidence; widen when the public obligation is broader.
2. **Returns** — enforce the contract you want, not every historical result.
3. **Preds** — `number().gt(0)` participates in algebra; it is not a branded type.
4. **any vs unknown** — entry without constraints is **`any`**; **`unknown` means inference failed** (engine debt).
5. **Handwritten wins** — draft/emit never overwrite accepted `*.nudo.js`.

## Migration-tactic coexistence (short-lived)

| Rule | Why |
|------|-----|
| One CI job per tool **during** the migration | Clear red/green per package |
| Never maintain the same API in both `interface` and sidecar | Drift |
| dts export is generated output | Abs + contracts are the model |
| Prefer `migrate retire` over “dual forever” | Dual gates are the tactic; retire is the exit |

Details while the tactic is active: [Coexistence](./coexistence.md).

## Next

- [Mental model](../getting-started/mental-model.md)
- [Error faces](./error-faces.md) — what you read after the gate
- [Nudo vs TypeScript](./vs-typescript.md) — replace / not-replace map
- [Quick Start](../getting-started/quick-start.md)
- [nudo check](./check.md) · [Contracts](./contract.md)
