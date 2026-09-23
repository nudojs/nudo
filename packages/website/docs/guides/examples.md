---
description: Practical Nudo examples — call-site observation, sidecar contracts, strings, loops, unions, env/mocks — with real check/test output.
---

# Examples

**You'll leave with:** how Nudo observes real call sites, how sidecar contracts gate obligations, and what still degrades to `unknown`.

**Product path first.** Observation is `nudo check` signatures (call sites are evidence). Contracts are `*.nudo.js` / `@nudo:refine`. `@nudo:case` is a **debug witness** only — optional, not the contract product.

Every output block below is excerpted from a real engine run of the code above it (`nudo check` / `nudo test` header lines and the assertions summary are elided where noted). The repo's CI-pinned suite lives in [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md) (`pnpm run verify:examples`); this guide browses the same engine by theme.

Try any sample in the [Playground](/playground).

---

## Call sites and contracts (product path)

### 1. Call-site subtraction — Day 0 observation

Plain JS + call sites. No annotations. `nudo check` prints signatures; call sites supply evidence.

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

```bash
npx nudojs check subtract.js
```

```text
nudo check  subtract.js
OK
  0 error · 0 warning · 0 info · 1 fn

signatures
  subtract(a: any, b: any) => number

(no issues)
```

Unconstrained entry params display as **`any`**. With richer call evidence (or a sidecar), Abs keeps literals and algebra — run `nudo check --abs` or open the file in the IDE.

Optional debug case report (`nudo test` — not required for the gate):

```text
=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9
```

### 2. Sidecar contract — Day 1 obligation

```javascript
// pricing.js
export function lineTotal(price, qty) {
  return price * qty;
}

lineTotal(12, 3);
lineTotal(0, 2);
```

```javascript
// pricing.nudo.js — contract (also plain JS)
import { number, fn } from "@nudojs/core";

export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check pricing.js
```

```text
nudo check  pricing.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  lineTotal(price: number, qty: number) => number

issues
  [ERROR L6 lineTotal] lineTotal[price]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: price > 0
      → use a value satisfying price > 0, or relax the precondition on price
```

`if` guards are **not** refinements. Obligations come from the sidecar / `@nudo:refine`. See [Contracts](./contract.md) and [nudo check](./check.md).

### 3. Object shapes from call sites

```javascript
function greet(user) {
  return user.name + " is " + user.age;
}
greet({ name: "Alice", age: 30 });
```

```text
=== greet ===
  call@L4  ({ name: "Alice", age: 30 }) => "Alice is 30"
```

Concatenation keeps the literal result `"Alice is 30"` — not a flattened `string`. Parameter destructuring folds argument shapes the same way:

```js verify
function addP({ x, y }) { return x + y; }
addP({ x: 1, y: 2 });
```

```text
=== addP ===
  call@L2  ({ x: 1, y: 2 }) => 3
```

Shape merge through spread:

```js
function mixin(base, ext) {
  return { ...base, ...ext };
}
mixin({ host: "localhost", port: 8080 }, { port: 3000, debug: true });
```

```text
=== mixin ===
  call@L9  ({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }
```

---

## Strings and templates

### 4. Template strings — beyond declared types

```javascript
export function coupon(code) {
  return `SAVE-${code.toUpperCase()}`;
}

coupon("vip");
```

```text
=== coupon ===
  call@L5  ("vip") => "SAVE-VIP"
```

TypeScript often widens this to `string`. Nudo observes the concrete template result at the call site. Compare the table in [Why Nudo](../why-nudo.md) and the homepage “Beyond declared types” section.

### 5. Precise string methods

`toUpperCase`, `toLowerCase`, `slice`, `.length`, and `split` (literal receiver) produce exact results on the call-site path: `"a,b,c".split(",")` folds to `["a", "b", "c"]`. See [Language semantics](../concepts/semantics.md) for the full precise/degrade map.

---

## Loops and ranges

### 6. Concrete-bound loops

```javascript
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}
sumTo(5);
```

```text
=== sumTo ===
  call@L6  (5) => 10
```

Loop sums stay literal when bounds are concrete — same Abs algebra powers `nudo check`.

### 7. Range narrowing

Path predicates narrow Abs inside branches (`x > 5` → range preds on the term). Details: [Control flow narrowing](../concepts/control-flow-narrowing.md).

---

## Unions and safe access

### 8. Discriminated by `typeof`

```javascript
export function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

transform("hi");
transform(41);
transform(null);
```

Each call site keeps its precise arm (`"HI"`, `42`, `null`). Symbolic `unknown` conditions currently join branches — see [semantics](../concepts/control-flow-narrowing.md).

### 9. Optional chaining

Known-shape receivers fold at any depth (`a.b.c ?? 5` with `{ b: {} }` → `5`); on unconstrained (`any`) receivers the result stays `any` with `throws TypeError` (engine debt `unknown` does not apply — see [Control flow narrowing](../concepts/control-flow-narrowing.md)).

---

## Runtime environments and mocks

### 10. Web APIs via `@nudo:env web`

```javascript
/// @nudo:env web
```

Built-in `es` / `web` / `node` env modules type common APIs. Harvest `@types` → env with [`nudo env harvest`](./env-harvest.md). **Env/harvest is not a substitute for mocks** on native runtime callbacks — see [Limits](../concepts/limits.md).

### 11. Mock external dependencies

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

Prefer the single-line arrow mock form. Full syntax: [Mocking External Dependencies](../concepts/mocking.md).

---

## Debug witnesses (optional, not the product)

`@nudo:case` injects scenario inputs for `nudo test` / LSP case switching. It does **not** create CI obligations.

```javascript
/**
 * @nudo:case "double digits" (10)
 */
export function scale(x) {
  return x + 1;
}
```

```text
=== scale ===
  debug "double digits"  (10) => 11
```

Prefer concrete values or constraint builders (`number()`, `lit(42)`). Assertions (`=> expected`) only from declared cases affect `nudo test` exit code — synthetic `call@` / `entry@` never fail the run.

---

## Where to go next

| Topic | Page |
|-------|------|
| Contract draft / accept / emit | [Contracts](./contract.md) |
| CI gate + diagnostic codes | [nudo check](./check.md) · [Diagnostics](../reference/diagnostics.md) |
| What degrades to `unknown` | [Language semantics](../concepts/semantics.md) |
| Abs algebra | [Abs](../concepts/type-values.md) |
| Recipes (CI, monorepo, export) | [Recipes](./recipes.md) |

| Directive | Role in this guide |
|-----------|-------------------|
| Call sites | Day 0 evidence (primary) |
| `*.nudo.js` / `@nudo:refine` | Day 1 contracts (primary) |
| `@nudo:env` / `@nudo:mock` | Environment & boundaries |
| `@nudo:case` | Optional debug witnesses only |
