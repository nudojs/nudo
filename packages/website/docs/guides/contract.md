---
slug: /guides/contract
description: nudo contract — print / draft / emit / reverse TypeScript into sidecar contracts. The Day 1 product face beside nudo check.
---

# nudo contract

`nudo contract` manages the **contract surface** (`*.nudo.js` sidecars + in-source `@nudo:contract`). It does not replace `nudo check` — check is the CI gate; contract is how obligations are printed, drafted, and emitted.

```bash
npx nudojs contract <paths…> [--from paths…]
npx nudojs contract --draft <paths…> [--write] [--fn name] [--json]
npx nudojs contract --emit <paths…> [--fn name] [--all] [--dry-run] [--exit-on-diff]
npx nudojs contract --from-dts <paths…> [--write] [--dry-run]
```

**Product rule:** handwritten contracts are obligations. Drafts and `@generated` segments are reviewable snapshots — they never silently become check errors.

## Layers

| Tier | Source | Migration action |
|------|--------|------------------|
| `handwritten` | `*.nudo.js` / `@nudo:contract` | Leave; enforce with `nudo check` |
| `generated` | Call-site domains frozen into `@generated` | Refresh with `--emit` when usage changes |
| `implicit` | Inference only — display | Draft candidates |

Print example — before any contract exists, `contract` shows the implicit tier with the domains it managed to observe (`lineTotal  [implicit]  (qty: 3 | 2, price: 4.5 | 10) → 13.5 | 20`). After a sidecar is accepted, the same command prints `[handwritten]` with the accepted bindings.

```bash
npx nudojs contract src/lib.js
```

## Observation → draft (logic first)

```bash
npx nudojs contract --draft src/lib.js
npx nudojs contract --draft --write src/lib.js --fn lineTotal
```

Output lands in `src/lib.nudo.draft.js` — **not** ambient-loaded. Copy reviewed lines into `src/lib.nudo.js`.

Every slot in a draft carries an **evidence tag** saying where the constraint came from:

| Evidence | Where it comes from | What lands in the draft |
|----------|---------------------|------------------------|
| `callsite` | Arguments observed at real call sites — in-file, or injected from usage files with `--from <paths…>` | A **widened** constraint in the `fn({ … })` line; the raw observation stays as an `/* observed … */` comment |
| `directive` | `@nudo:case` witnesses declared on the function | Same projection path as `callsite` — together they are the best starting point |
| `body` | Fields the implementation reads (`user.name`) | A comment suggestion (`shape({ name: /* TODO */ })`) only — never a DSL obligation |
| `symbolic` | The generalized return shape (`generalizeFromAst`) | A return-slot comment; fill the return by hand |
| *(omitted)* | No evidence at all | The slot is left out of `fn({})` with a TODO comment |

**Invariant — a draft never invents check obligations.** Only `callsite` / `directive` evidence is projected into the DSL, and it is widened first (`lit(3)` + `lit(2)` → `number()`) so a single demo call can never freeze into a hard contract. `body` reads and `symbolic` returns stay comments (C0: no obligations invented from body AST scans). The return slot of a never-called export may print `/* observed: string() — confirm before accepting */` — an evaluation fact for you to confirm, not an obligation. Handwritten contracts are never overwritten: functions already bound in `*.nudo.js` are listed as `[handwritten] skipped`.

Human review tightens `number()` → `number().gt(0)` etc. Only the accepted sidecar is L1.

[Playground draft story](/playground) · worked sample: [`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft)

## A full lap: draft → tighten → accept → gate

The whole Day 1 loop on one small module. Start from plain JS — no annotations. (Before any contract, `nudo check` shows the Day 0 face — `greet(user: any) => string  throws TypeError`, L2 entry may-throw because `.name` is read off an unconstrained param; full story: [nudo check](./check.md#l2--entry-throws).)

```javascript verify
export function lineTotal(qty, price) {
  return qty * price;
}

export function greet(user) {
  return `Hello, ${user.name}`;
}

export function tag(label) {
  return `[${label}]`;
}

lineTotal(3, 4.5);
lineTotal(2, 10);
```

**1. Draft from evidence.** `--draft --write` persists the reviewable draft (`Draft written → src/lib.nudo.draft.js`); the draft module shows every evidence tag inline — header elided, it restates that the file is not a sidecar and restates the evidence policy:

```text
import { fn, number, shape } from "@nudojs/core";

// lineTotal — param: callsite, return: callsite
//   qty: number()  /* observed: union(lit(2), lit(3)) */
//   price: number()  /* observed: union(lit(4.5), lit(10)) */
export const lineTotal = fn({ qty: number(), price: number() }, number());

// greet — param: body, return: symbolic
//   user: /* body-read { name } — fill types when accepting */
//   suggested (body-read, not a contract): greet = fn({ user: shape({ name: /* TODO */ }) })
//   returns: /* symbolic: string — greet: (user: A1) => string */
export const greet = fn({});

// tag — param: none, return: body
//   label: /* no evidence — tighten */
//   returns: /* observed: string() — confirm before accepting */
export const tag = fn({});
```

Read the three functions against the [evidence table](#observation--draft-logic-first): `lineTotal` has real call sites, so its params and return are projected (widened). `greet` was never called — body-read suggestion and symbolic return only, so the DSL stays `fn({})`. `tag` has no evidence at all; even its observed return is a *confirm-before-accepting* comment.

**2. Tighten by hand and accept.** Review each line, strengthen what you *intend* to require, and copy the result into `src/lib.nudo.js` — that copy is the acceptance act:

```javascript verify-sidecar
// src/lib.nudo.js — accepted after review
export const lineTotal = fn({ qty: number().int().gt(0), price: number().ge(0) }, number());
export const greet = fn({ user: shape({ name: string() }) }, string());
export const tag = fn({ label: string() }, string());
```

What review changed: `qty` tightened from the widened `number()` to `number().int().gt(0)` (quantities are positive integers — the draft could not know that); `greet`'s body-read suggestion `{ name }` promoted to a real `shape` obligation, which also removes the L2 throw; `tag`'s no-evidence slot filled by hand as `string()`.

**3. Gate.** The accepted sidecar auto-binds and `check` turns green — signatures now show the constrained faces:

```text
nudo check  src/lib.js
OK
  0 error · 0 warning · 0 info · 3 fn

signatures
  lineTotal(qty: number, price: number) => number
  greet(user: { name: string }) => string
  tag(label: string) => string
```

**4. Break it on purpose.** A call that violates the tightened pred fails the gate with `1 error` (L1) — this is the obligation you accepted, not something a draft invented:

```javascript verify
lineTotal(-1, 5); // ⊭ qty > 0 → nudo:constraint-violated
```

```text
issues
  [ERROR L16 lineTotal] lineTotal[qty]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: qty > 0
      → use a value satisfying qty > 0, or relax the precondition on qty
```

## Contracts first (Contracts style)

Write the sidecar by hand, then implement under the same face:

```javascript verify-sidecar
// contract.nudo.js
import { number, fn } from "@nudojs/core";

export const positive = number().gt(0);
export const add2 = fn({ x: number().gt(0) }, number());
```

Function bindings in a sidecar **must** be first-class `fn({ params }, returns?)`. Bare `number().gt(0)` is a value-level template (for `@nudo:contract` / shared slots), not a function export contract — `positive` above is a template, `add2` is a binding.

In-source form:

```javascript verify
/// @nudo:import { positive } from "./contract.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x;
}

needsPositive(-1); // ⊭ x > 0 → nudo:constraint-violated
```

Templates referenced by `@nudo:contract` must be imported with `@nudo:import` — the sidecar auto-binds only same-name `fn` exports.

`@nudo:contract` is the only in-source contract directive (the historical `@nudo:refine` / `@nudo:interface` spellings were removed with no alias layer). Product name: **contract**.

## Emit generated segments

`--emit` freezes **observed** call-site domains into `@generated` sidecar segments — facts about usage, not obligations. Use it for usage you trust (demo calls, tests); keep handwritten bindings for the API surface you want enforced. A leaf module with no contract yet:

```js
export function wrap(text) {
  return `(${text})`;
}

wrap(42);
```

Emit the observed domain (default mode refreshes existing segments; `--fn` / `--all` create new ones):

```bash
npx nudojs contract --emit src/tags.js --fn wrap
```

```text
Updated src/tags.js → src/tags.nudo.js
  written: wrap
  re-run `nudo check src/tags.js` to see the persisted contracts in action
```

The sidecar now carries the snapshot — note it persists the *exact* observed literals, unlike drafts which widen:

```javascript verify-sidecar
// @generated by nudo — do not edit; regenerate with `nudo contract --emit`
// source: tags.js:wrap
export const wrap = fn({ text: lit(42) }, lit("(42)"));
```

### Drift

Weeks later the demo call changes — `wrap("hot")` now runs instead of `wrap(42)`:

```javascript verify
export function wrap(text) {
  return `(${text})`;
}

wrap("hot");
```

`check` compares the persisted segment against today's recomputed domain and **warns** — the call is not an error, because `generated` never enforces:

```text
nudo check  src/tags.js
OK
  0 error · 2 warning · 0 info · 1 fn

signatures
  wrap(text: number) => string

issues
  [WARNING L5 wrap] wrap[text]: persisted @generated segment ≠ today's call-site domain  (nudo:interface-drift)
      → re-run nudo contract --emit to refresh the generated segment, or check the call sites of text
  [WARNING L5 wrap] wrap[return]: persisted @generated segment ≠ today's inferred return  (nudo:interface-drift)
      → re-run nudo contract --emit to refresh the generated segment, or check the return value
```

`nudo:interface-drift` is a **warning — it does not gate exit** (the run above exits 0). Refresh when the new usage is intentional (`nudo contract --emit src/tags.js` prints the same `Updated … written: wrap` summary and the segment becomes `fn({ text: lit("hot") }, lit("(hot)"))`); with unchanged evidence the re-run is a no-op (`src/tags.js: no interface changes`).

### CI drift gate

To make would-be refreshes visible in CI, run emit as a dry-run that fails on diff:

```bash
npx nudojs contract --emit src/tags.js --dry-run --exit-on-diff
```

```text
[dry-run] would update src/tags.js:
--- a/src/tags.nudo.js
+++ b/src/tags.nudo.js
@@ -1,4 +1,4 @@
 // @generated by nudo — do not edit; regenerate with `nudo contract --emit`
 // source: tags.js:wrap
-export const wrap = fn({ text: lit("hot") }, lit("(hot)"));
+export const wrap = fn({ text: lit(7) }, lit("(7)"));

```

The command exits `1` — a maintainer refreshes locally and commits. `--exit-on-diff` requires `--emit --dry-run` (a bare `--exit-on-diff` is a usage error); handwritten bindings always win — emit would overwrite one, it reports `nudo:interface-name-clash` and skips the write. Usage-site files can feed the evidence: `contract --emit src/lib.js --from test/` (see [Call-site discovery](./callsite-discovery.md)).

## Reverse TypeScript declarations (--from-dts)

Migrating off TypeScript? `--from-dts` reverse-engineers `.d.ts` files, annotated `.ts` / `.mts` sources, directories, or an npm package's types into a reviewable `@nudo:draft` — the contracts step of the [TypeScript retirement path](./migrating-from-typescript.md). A small legacy module:

```ts
export interface User {
  id: number;
  name: string;
}

export function lineTotal(qty: number, price: number): number {
  return qty * price;
}

export function badge(user: { name: string; admin?: boolean }): string {
  return user.admin ? `[${user.name}]` : user.name;
}

export function findUser(id: number): User {
  return { id, name: "n" };
}
```

```bash
npx nudojs contract --from-dts legacy/pricing.ts
```

```text
// @nudo:draft
// Generated by `nudo contract --from-dts` from pricing.ts
// Sources: pricing.ts
//
// Reverse-engineered from TypeScript declarations — NOT a sidecar contract.
// This file is never loaded for check. Review each export, then copy it
// into <target>.nudo.js to accept (that is when obligations go live).
//
// After accept: strengthen with Pred builders (number().gt(0) …) —
// dts cannot express algebraic implications (x>0 ⇒ x+1>1).

import { fn, number, string, boolean, any, shape } from "@nudojs/core";

// lineTotal — from TypeScript
export const lineTotal = fn({ qty: number(), price: number() }, number());

// badge — from TypeScript
export const badge = fn({ user: shape({ name: string(), admin: boolean().optional() }) }, string());

// findUser — from TypeScript
export const findUser = fn({ id: number() }, any());

// 3 projectable exports · 0 skipped · 1 d.ts
// pass --write to save as pricing.nudo.draft.js; copy into *.nudo.js to enforce
```

Read the projection honestly: primitives, literal unions, arrays, and object literals map to builders; optional fields (`admin?: boolean`) become `boolean().optional()`; but `findUser`'s `User` return degrades to **`any()`** — an unmodeled type reference, flagged as such rather than guessed. Interfaces and type aliases are skipped entirely (types are not runtime contracts).

**`--from-dts` does not enforce anything.** The draft prints (or with `--write`, lands as `pricing.nudo.draft.js` in the working directory — `next   review, then copy exports into a *.nudo.js sidecar to accept (not enforced until then)`) and is never ambient-loaded. Reviewing and copying accepted exports into a `*.nudo.js` sidecar is what makes them L1 — and that is also the moment to strengthen what `.d.ts` could never express: `qty: number` says nothing about positivity, `number().int().gt(0)` does (Preds enter Abs and participate in algebra — `x>0 ⇒ x+1>1`).

## Flags

| Flag | With | Effect |
|------|------|--------|
| `--draft` | — | Print a reviewable draft from existing code (code-first) |
| `--write` | `--draft` / `--from-dts` | Write `*.nudo.draft.js` to disk |
| `--emit` | — | Write/update `@generated` segments (default: refresh existing only) |
| `--fn <name>` / `--all` | `--draft` / `--emit` | Restrict to export names / target every export |
| `--from <paths…>` | print / `--draft` / `--emit` | Usage-site files feeding domain evidence |
| `--from-dts` | — | Reverse `.d.ts` / annotated TS / package types into a draft (**not enforced**) |
| `--dry-run` | `--emit` / `--draft --write` | Print instead of writing |
| `--exit-on-diff` | `--emit --dry-run` | Exit `1` when the sidecar would change |
| `--json` | `--draft` | `{ draftSource, diff, entries[] }` for agent review |

Print / `--draft` / `--from-dts` fail only on usage / IO errors; `--emit` additionally fails on `--exit-on-diff` with a diff — analysis diagnostics seen during emit are printed but never gate the exit. Full table: [CLI Reference](../api/cli-reference.md#nudo-contract).

## Gate with check

![sidecar auto-bind](/img/sidecar-bind.svg)

*Same-name sidecar `*.nudo.js` auto-binds to `calc.js` exports and enters `nudo check` as L1.*

```bash
npx nudojs check src/
```

See [nudo check](./check.md) and the [diagnostics glossary](../reference/diagnostics.md).

## Next

- [Migrating existing JS](./migrating-js.md) — full draft → accept → CI path
- [Migrating from TypeScript](./migrating-from-typescript.md) — `--from-dts` in the retirement pipeline
- [Recipes](./recipes.md) — gradual contracts, monorepo
- [Directives](../concepts/directives.md) — `@nudo:contract` grammar
- [Limits](../concepts/limits.md) — promote ≠ obligation; honest boundaries
