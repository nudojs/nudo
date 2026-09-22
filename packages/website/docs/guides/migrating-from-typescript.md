---
slug: /guides/migrating-from-typescript
description: When and how to move a TypeScript-facing workflow toward Nudo on JavaScript — honest steps, not a tsc clone.
---

# Migrating from TypeScript

**You'll leave with:** when a TS-facing team should adopt Nudo on JS, when to keep TypeScript primary, and a concrete migration path that does not pretend Nudo is `tsc`.

This is **not** “convert every `.ts` file to Nudo.” It is: **put a Nudo gate on JavaScript (or JS-shaped logic) when that is where the product truth lives**, and keep TypeScript where the TS language *is* the product.

Related: [Why Nudo](../why-nudo.md) · [Nudo vs TypeScript](./vs-typescript.md) · [Coexistence](./coexistence.md) · [Migrate existing JS](./migrating-js.md)

## Decide first

| Situation | Recommendation |
|-----------|----------------|
| New or existing **`.js`** packages; you want observation + contracts without a TS rewrite | **Adopt Nudo** on that package (logic first or contracts first) |
| Mixed repo: JS tools + TS apps | **Coexist**: `tsc` for `.ts`, `nudo check` for JS packages you gate |
| Annotation-first **`.ts` monorepo**; product is the type language itself | **Stay on TypeScript** as primary; Nudo is not a `tsc` replacement |
| You need `.d.ts` for npm consumers of a JS package | Use Nudo for Abs + contracts; **`nudo export --format dts`** as a one-way bridge |

Nudo analyzes **JS semantics**. You can point it at `.ts` files, but annotations are stripped — it is not a TypeScript compiler clone.

## What changes (and what does not)

| TypeScript habit | Nudo counterpart |
|------------------|------------------|
| Annotate params/returns in source | Day 0: `nudo check` prints signatures (`any` until evidence/contracts) |
| `tsc --noEmit` in CI | `nudo check` in CI (still prints signatures on success) |
| `interface` / mapped types as obligations | Sidecar `*.nudo.js` builders (`fn`, `shape`, `number().gt(0)`) + optional `@nudo:refine` |
| Hover shows declared type | Hover / inlay show Abs facts (term / pred / conf) |
| `.d.ts` is the model | `.d.ts` is a **lossy export**; Abs is the model |
| Refactors change annotations | Refactors change **evidence** (call sites) and/or **contracts** |

**Work modes** (same checker):

1. **Logic first** — keep/implement JS → `contract --draft` → review → `*.nudo.js`
2. **Contracts first** — write sidecar/refine first → implement under that face

`nudo check` only validates. Schema/dts/guards come from `nudo export`.

## Path A — JS package beside TS apps

Typical: monorepo with `apps/*` in TS and `packages/*` tools in JS.

1. **Scope** — pick one JS package (CLI, worker, script layer). Do not start with the whole monorepo.
2. **Install** — see [Installation](../getting-started/installation.md). Use `npx nudojs` / the `nudo` bin.
3. **Observe (Day 0)**

   ```bash
   npx nudojs check packages/tool/src
   ```

   Read signatures. Unconstrained entries are **`any`**. Fix L2 entry may-throw where exports throw on `any`/nullish.

4. **Contracts (work mode)**
   - Logic first: `npx nudojs contract --draft <file> --from <tests…>` → review → copy into `*.nudo.js`
   - Contracts first: handwrite `*.nudo.js` / `@nudo:refine` for the API surface you must enforce
5. **CI** — replace or add `nudo check` for that package path only. Keep `tsc` wherever `.ts` remains.
6. **Ecosystem** — if TS apps consume the package:

   ```bash
   npx nudojs export packages/tool/src/index.js --format dts --out packages/tool/dist/types
   npx nudojs export packages/tool/src/index.js --format schema --dialect zod
   ```

   Standard Schema / Zod projections support runtime checks and mocks; they do **not** replace `nudo check`.

7. **IDE** — install the VS Code / Zed extension for hover, inlays, CodeLens draft/persist on JS files.

Exclude Nudo analysis from `.ts` buffers if your editor schedules both tools — see [Coexistence](./coexistence.md).

## Path B — “TS-shaped” logic you refuse to annotate forever

Some packages grew `// @ts-check` or partial annotations but stay JS at runtime.

1. Turn off or ignore incremental `@ts-check` pressure for that package once `nudo check` is in CI.
2. Replace ad-hoc JSDoc type theater with **sidecar contracts** only where you need obligations.
3. Mine call sites from tests (`--from test/`) for draft evidence; **widen** drafts before accepting (do not freeze `lit(21)` if callers need any positive number).
4. Export dts **for consumers**, not as the source you maintain.

## Path C — TypeScript stays primary

If the `.ts` type language is the product:

- Keep `tsc` / project references / DefinitelyTyped-style APIs on the TS side.
- Do not point `nudo check` at a TS monorepo expecting TS assignability parity.
- You may still use Nudo **beside** TS for JS scripts, generated JS, or runtime validation projections — never as a second IR for the same annotated sources.

## Review checklist (contracts)

When accepting drafts or writing sidecars after a TS mindset:

1. **Params** — call-site shapes are evidence, not always the public obligation. Widen when needed (`number()` vs literal).
2. **Returns** — enforce the contract you want, not every historical result.
3. **Preds** — `number().gt(0)` participates in Abs algebra; it is not a TS branded type.
4. **any vs unknown** — entry without constraints is **`any`**; **`unknown` means inference failed** (engine debt), not “developer forgot a type.”
5. **Handwritten wins** — draft/emit never overwrite `*.nudo.js` you already accepted.

## Coexistence rules of thumb

| Rule | Why |
|------|-----|
| One CI job per tool path | `tsc` for TS; `nudo check` for JS packages you gate |
| Do not maintain the same API in both `interface` and sidecar | Two sources of truth drift |
| dts export is generated output | Abs + contracts are maintained; `.d.ts` is a projection |
| Editor: analysis mode / include only JS you want | Avoid double diagnostics on the same buffer |

Details: [Coexistence](./coexistence.md).

## Next

- [Why Nudo](../why-nudo.md)
- [Nudo vs TypeScript](./vs-typescript.md) — honest replace / not-replace map
- [Quick Start](../getting-started/quick-start.md)
- [nudo check](./check.md)
- [Directives — refine / sidecar](../concepts/directives.md)
- [Runtime type generation](./runtime-generation.md)
