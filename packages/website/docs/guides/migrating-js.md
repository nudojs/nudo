---
sidebar_position: 11
description: "Migrate an existing JavaScript package to Nudo: draft contracts from code, review, persist, then gate with check/health."
---

# Migrating existing JS

Nudo does **not** require annotations up front. The migration path is **code-first**: keep the implementation, generate reviewable contracts, tighten by hand, then lock CI.

```text
existing JS  →  contract --draft  →  human review  →  *.nudo.js  →  check / health / IDE
```

## 0. Prerequisites

```bash
pnpm add -D @nudojs/cli @nudojs/lsp   # or npx @nudojs/cli
# optional project config in package.json
{
  "nudo": {
    "analysis": {
      "mode": "exports",
      "diagnostics": "default",
      "evalMissingSlot": "off"
    },
    "interface": { "autoBind": true }
  }
}
```

See [Coexistence with TypeScript](./coexistence.md) if the repo already has `tsc`.

## 1. Inventory

```bash
nudo contract src/
nudo check src/
```

`contract` prints every top-level export with its tier; `check` prints signatures (including L2 entry throws).

Prints every top-level export with its tier:

| Tier | Meaning | Migration action |
|------|---------|------------------|
| `handwritten` | Already contracted (sidecar / `@nudo:refine`) | Leave; enforce with `check` |
| `generated` | Call-site domains frozen into `@generated` | Refresh with `--emit` when usage changes |
| `implicit` | Inference only — display | **Draft candidates** |

## 2. Draft contracts from code

```bash
nudo contract --draft src/lib.js
nudo contract --draft --write src/lib.js --fn greet --fn double
# or IDE: CodeLens ⚡ draft contract / VS Code “Nudo: Draft Interface”
```

Evidence in the draft module (never invents check obligations):

| Evidence | Source | Use |
|----------|--------|-----|
| `callsite` / `directive` | Observed arguments | Best starting point |
| `body` | Fields the implementation reads | Suggestions only — fill types by hand |
| `symbolic` | `generalize` return shape | Return slot when no cases |
| omitted slots | No evidence | TODO comments |

Output lands in `src/lib.nudo.draft.js` — **not** ambient-loaded. Copy reviewed lines into `src/lib.nudo.js`.

Worked sample: [`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft).

Runnable demo (temp dir: inventory → draft → accept → check):

```bash
pnpm run migrate-demo
# from the nudo monorepo — scripts/migrate-demo.sh
```

## 3. Review checklist

For each draft export:

1. **Params** — are call-site shapes too narrow for future callers? Widen (`number()` vs `lit(21)`).
2. **Body-read fields** — promote `shape({ name })` only if every caller must provide them (that is a real obligation).
3. **Returns** — match the contract you want enforced, not every historical result.
4. **Handwritten clash** — if `*.nudo.js` already binds the name, keep handwritten (draft never overwrites).

Example accept:

```js
// src/lib.nudo.js
import { fn, number, shape, string } from "@nudojs/core";

export const double = fn({ x: number() }, number());
export const greet = fn({ user: shape({ name: string() }) }, string());
```

## 4. Gate with check

```bash
nudo check src/
nudo check src/lib.js --json   # CI
```

- Violations on **handwritten** contracts fail the build (L1).
- **L2** entry may-throw on exports is an error by default — refine, catch, or `--ignore-throws` while migrating.
- **generated** segments report drift as warnings (facts + refresh), not as new obligations.
- **implicit** display never invents errors by itself.

Optional evaluation hints (default **off**):

```json
{ "nudo": { "analysis": { "evalMissingSlot": "warning" } } }
```

Surfaces `nudo:missing-slot` when evaluation hits a closed object shape without a field — a hint to tighten drafts, not an automatic contract.

## 5. Freeze call-site domains (optional)

```bash
nudo contract --emit src/lib.js --fn double --from test/
nudo contract --emit src/lib.js --dry-run --exit-on-diff   # CI drift gate
```

`contract --emit` writes `@generated` segments from **observed** arguments. Use it for usage sites you trust; keep handwritten contracts for API surface you want enforced.

## 6. IDE / agents

| Surface | Entry |
|---------|--------|
| Hover tier | `● interface / handwritten\|generated\|implicit` |
| CodeLens | persist / update / **draft** |
| VS Code | Output channel commands |
| Agent | `nudo.interface`, `nudo.interface.draft`, `nudo.check` |
| CLI | `nudo contract` (`--draft` / `--emit`), `nudo check`, `nudo health`, `nudo test --freeze` |

## 7. Ongoing health

```bash
nudo health src/                         # uncovered fns, drift, analysis errors
nudo test src/lib.js --from test/ --freeze=update
```

Pin package versions per [Versioning & Releases](./versioning.md) (0.x minors may break; 1.x core/service/cli follow SemVer).

## What not to do

- Do not expect body `if (p.foo)` reads to become check obligations (C0 model).
- Do not commit `*.nudo.draft.js` as if it were a live contract — copy into `*.nudo.js` first.
- Do not treat `generated` snapshots as the full API you intend to enforce — promote to handwritten when it matters.

## See also

- [CLI — `nudo contract --draft`](./cli.md#nudo-contract)
- [Check guide](./check.md)
- [Coexistence with TypeScript](./coexistence.md)
- [vs TypeScript](./vs-typescript.md)
- [LSP Client Matrix](./lsp-clients.md)
