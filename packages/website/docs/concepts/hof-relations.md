---
slug: /concepts/hof-relations
description: HOF relations — how Nudo derives the return shape of map(xs, f) style higher-order functions without a generics language (fnRels / entryShapes / hofSites), plus relationFn() for env authors.
---

# HOF relations

**You'll leave with:** why `map(xs, f)`-style higher-order functions still get real return shapes in Nudo — with **no** `<T, U>` syntax and no second type system.

## The problem: symbolic callbacks

```js
export function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
```

`transform` and `filter` are function parameters with no body of their own inside `processItems`. A naive structural analysis collapses both sides: params become opaque, the return becomes `unknown` — the “input → output” relation is lost. Nudo's answer is **relations on Abs**: observations recorded during the symbolic run, replayed at every call site.

## Runnable tour

All three samples below run as one file — `nudo test` reports each call site with its derived result. Line numbers in the excerpts refer to that combined file. The `(n) => ?` display means “a function value, whose body ran with your arguments.”

### 1. A callback applied directly

```js verify
export function applyTwice(fn, x) {
  return fn(fn(x));
}

applyTwice((n) => n + 1, 5);
applyTwice((s) => s + "!", "hi");
```

```bash
npx nudojs test hof-relations.js
```

```text
=== applyTwice ===
  call@L5  ((n) => ?, 5) => 7
  call@L6  ((s) => ?, "hi") => "hi!!"
```

The same function derives `7` for a number callback and `"hi!!"` for a string callback — each call site re-evaluates the body with that site's argument sets.

### 2. The map/filter chain

```js verify
export function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}

processItems([1, 2, 3, 4], (n) => n * 10, (n) => n % 2 === 0);
```

```text
=== processItems ===
  call@L11  ([1, 2, 3, 4], (n) => ?, (n) => ?) => [20, 40]
```

Two symbolic callbacks chained through `filter` then `map` — and the return array is exact: evens kept (`2`, `4`), each multiplied by 10.

### 3. Mapping to field values

```js verify
export function pluckIds(rows, pick) {
  return rows.map(pick);
}

pluckIds([{ id: 1 }, { id: 2 }, { id: 3 }], (r) => r.id);
```

```text
=== pluckIds ===
  call@L16  ([{ id: 1 }, { id: 2 }, { id: 3 }], (r) => ?) => [1, 2, 3]
```

### The generalized face

The same file through `nudo check` prints the **entry** signatures — params are honestly `any` (no contracts anywhere here), but the **return relations** still derive from body usage:

```text
signatures
  applyTwice(fn: any, x: any) => any
  processItems(items: any, transform: any, filter: any) => arr(B:transform)  throws TypeError
  pluckIds(rows: any, pick: any) => arr(B:pick)  throws TypeError
```

`arr(B:transform)` reads as “an array of whatever `transform` returns” — the relation survived without a single call site being merged into the signature. (`throws TypeError` is the L2 face: `.filter` on an unconstrained `any` may throw — see [Diagnostics](../reference/diagnostics.md#nudo-entry-may-throw).)

## How it works: relations on Abs, not a generics language

Relations live in the **extension slots of the fn Abs itself** — there is no parallel IR:

| Carrier | Content |
|---|---|
| fn shape `paramTypes` / `returnType` | what display and `formatShape` read; terms may be α-vars like `A1` or output vars like `B:transform` |
| `PolyFn.fnRels` | relation snapshot of the function params (+ `RelSource`: `promote` / `refine` / `relationFn`) |
| `PolyFn.entryShapes` | lifted value-param shapes (e.g. `items → arr(A1)`) |
| `PolyFn.hofSites` | recorded application sites of those params inside the body |
| `impl.relation` | bodyless pure relation (written by harvest / mock / `relationFn`) |

Relations are **produced by usage, never pre-seeded** — the symbolic run lifts a param's shape only when it observes a use:

| Observed in the body | Lifted shape |
|---|---|
| `p(x)`, `p(a, b)` | `fn([αOf(args)], B:p)` |
| `arr.filter(p)` | `fn([αOf(element)], boolean)` |
| `arr.map(p)` / `arr.flatMap(p)` | `fn([αOf(element)], B:p)` |
| `arr.reduce(p, init)` | `fn([αOf(init), αOf(element)], B:p)` |
| unused / forwarded only / property access only | no lift |

And **consumed at call sites**: built-in HOFs (`map` / `filter` / `reduce` / `flatMap`), `$call`, and class bridges all go through one entry point (`applyCallbackAbs` / `applyAbsFn`) that resolves `impl.apply → impl.body → impl.relation → shape-only relation → unknown`. Discipline worth knowing as a reader of signatures: first observation wins (arrival-first); a lift is a **replacement** in the environment (no mutation of shared Abs); `conf=path`; opaque (truncated) evidence records nothing.

## Not TypeScript generics

| | TypeScript | Nudo |
|---|---|---|
| Who writes the relation | The **author** must annotate `<T, U>` | **Observed** from body usage; nothing to write |
| Instantiation | Reader simulates at each use | Engine re-evaluates the body with each call site's argument sets |
| Missing annotation | Collapses to `unknown` / `any` | No-relation case stays honest `unknown`; value params still lift from usage |
| The type variables | A language you write and read | Display names for α-variables (`A1`, `B:transform`) — presentation only |

There is no user-facing type-parameter syntax, no conditional types, no `infer` — polymorphism is abstract interpretation plus per-call-site instantiation, on the single Abs track (`shape × term × pred × conf`). See [Limits & non-goals](./limits.md).

## relationFn(): a relation without a body

Env, harvester, and embedder authors can register a pure relation directly:

```js
import { relationFn, arr, str } from "@nudojs/core";

// Array.prototype.join: (arr(string)) => string
const join = relationFn([arr(str())], str());
```

Two rules from the design: **double-write** — `relationFn` populates both the fn shape slots (display) and `impl.relation` (the evaluation path); and **fingerprint is mandatory** — budget identity comes from a stable fingerprint of the signature, never from the return type. Default confidence is `path` (never silently `exact`). Full signature: [`relationFn` in the core API](../api/core.md). Harvested envs use it heavily — see [Env harvest](../guides/env-harvest.md) and the [harvester API](../api/harvester.md).

## Honest limits

- **No relation info → `unknown`.** Never invented. If a HOF param is never applied and no relation is declared, you get honest `unknown`, not a guessed shape.
- **Promote is a warning, not a gate.** Body-usage promotion suggestions (`RelSource: promote`) never fail `check`; only explicit relation / refine contracts are L1 errors.
- **`filter` does not strengthen element preds** — `xs.filter(p)` keeps the element shape; it does not propagate the callback's predicate to the element type.
- **No cross-file auto induction.** Relations cross file boundaries via harvest, env, or `relationFn` — not by re-generalizing across the module graph.
- **Truncated evidence records nothing.** When analysis is truncated to `#opaque`, `fnRels` / `entryShapes` / `hofSites` are not recorded. See [Performance](../guides/performance.md).

## Next

- [Abs](./abs.md) — the four-slot value domain relations live on
- [Language semantics](./semantics.md)
- [Env harvest](../guides/env-harvest.md) — `relationFn` in harvested envs
- [Limits & non-goals](./limits.md)
- [Core API](../api/core.md) — `relationFn`, `relationFingerprint`
