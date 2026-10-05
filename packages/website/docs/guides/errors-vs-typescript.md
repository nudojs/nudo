---
slug: /guides/errors-vs-typescript
description: Ten real error scenarios, one file — what tsc reports (or stays silent about), what Nudo reports (value + Pred), and the fix path. Runnable, CI-pinned.
---

# Error catalog: Nudo vs tsc

Ten real error scenarios from one bad day of business code. The same source runs through both gates: for each scenario this page shows what `tsc` reports (often nothing), what `nudo check` reports — a **value and a predicate** (`actual` / `expected`) — and the one-command fix path. Nudo's goal here is not "report more." It is **report more true, with evidence, and with a next step**.

## How this page runs

Every code block below is executable. The docs pipeline concatenates the `verify` blocks, in page order, into one `errors-vs-typescript.js`, and the `verify-sidecar` blocks into one sibling `errors-vs-typescript.nudo.js` — whose `fn()` bindings auto-bind to same-named functions. That is why top-level names never repeat across the ten scenarios, and why the sidecar imports its builders once, in the first block.

One command replays the whole catalog — the header and signatures of that single real run:

```bash
npx nudojs check errors-vs-typescript.js
```

```text
nudo check  errors-vs-typescript.js
FAILED
  12 error · 0 warning · 0 info · 10 fn

signatures
  setDelay(ms: number) => number
  greet(u: { id: number, name: string }) => string
  getName(user: any) => any  throws TypeError
  bad() => 0
  inc(x: any) => number | string  throws TypeError
  incPositive(x: number) => number
  tag(s: string) => string
  arm(ms: number) => number
  bump(x: number) => number
  cooldown(ms: number) => number
```

The `text` block in each scenario is the exact `issues` entry (or entries) this run prints for that scenario — nothing on this page is invented output.

## 1. Numeric bound — `setDelay(0)`

**tsc:** `Argument of type 'number' is not assignable…` only if you annotate tighter — with plain `ms: number`, the call is **silent**.

Nudo blocks the call site with the value and the Pred, and the `fix:` line names the next command:

```javascript verify
// 1. Numeric bound: tsc's `ms: number` accepts 0; the Pred blocks the call.
export function setDelay(ms) {
  return ms;
}

setDelay(250); // ok
setDelay(0);   // 0 ⊭ ms > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js — import preamble for every sidecar block below
import { fn, number, shape, string } from "@nudojs/core";

export const setDelay = fn({ ms: number().gt(0) }, number());
```

```text
  [ERROR L7 setDelay] setDelay[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 2. Missing shape field — `greet({ id: 2 })`

**tsc:** to get an error at all you must first write `interface User`; depending on inference you may see `Property 'name' is missing` — or nothing.

The field name is in the `expected` line itself, and the shape lives in one sidecar — no interface syntax anywhere:

```javascript verify
// 2. Missing shape field: the contract names the field, no interface needed.
export function greet(u) {
  return "hi " + u.name;
}

greet({ id: 1, name: "Ada" }); // ok
greet({ id: 2 });              // missing field u.name
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const greet = fn({ u: shape({ id: number(), name: string() }) }, string());
```

```text
  [ERROR L14 greet] greet[u]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   { id: 2 }  #exact
      expected: missing field u.name
      → add the missing field u.name
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 3. Reassignment drops a slot — `config = { host: "y" }`

**tsc:** relies on the inferred object type; wide `any` / index signatures stay silent.

The left side's current shape and the right side's value sit side by side; the arrow names the missing slot:

```javascript verify
// 3. Reassignment drops a slot: left shape vs right value, side by side.
export let config = { host: "localhost", port: 8080 };

config = { host: "api", port: 3000 }; // ok
config = { host: "y" };               // missing slot port
```

```text
  [ERROR L19 config] config: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   { host: "y" }  #exact
      expected: { host: "api", port: 3000 }  #exact
      → missing slot port
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 4. Entry may-throw — `user.name`

**tsc:** no throws story — nothing is reported, and it explodes at runtime.

Nudo puts the runtime effect into the signature (`throws TypeError`) and gates it as L2 — with a suggestion list (refine / guard / try-catch / `@nudo:throws`). None of the other scenarios' sidecars bind here: `getName` has no contract, so its unconstrained entry is exactly what L2 flags:

```javascript verify
// 4. Entry may-throw: unconstrained user — the runtime bomb reaches CI.
export function getName(user) {
  return user.name;
}
```

```text
  [ERROR L21 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → @nudo:throws TypeError / refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 5. Return contract — `return 0` under `> 0`

**tsc:** a `number` return accepts `0` — green.

Preconditions and return values share one Pred language; the return side of the same `fn()` binding is what fires here:

```javascript verify
// 5. Return contract: declared return > 0, returns 0.
export function bad() {
  return 0;
}

bad();
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const bad = fn({}, number().gt(0));
```

```text
  [ERROR bad] bad: return value ⊭ @nudo:contract return number().gt(0)  (nudo:constraint-violated)
      actual:   0  #exact
      expected: return > 0
      → return a value satisfying > 0
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 6. Real JS `+` — `inc("7")` vs the contract

**tsc:** usually types `x + 1` as `number` — a lie for the `"7"` call — or forces narrowing on you.

No contract: the face stays honest — `inc(x: any) => number | string` (`inc("7")` is `"71"`), and L2 flags the coercion bomb: an unconstrained `+` may throw `TypeError` (native `Symbol` ToNumeric). With the contract, the bad argument is blocked at the call site — you decide where the obligation lives:

```javascript verify
// 6. Real JS `+`: no contract = honest number|string; a contract blocks the call.
export function inc(x) {
  return x + 1;
}

export function incPositive(x) {
  return x + 1;
}

inc("7");        // ok → "71"
incPositive(-1); // -1 ⊭ x > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const incPositive = fn({ x: number().gt(0) }, number());
```

```text
  [ERROR L31 inc] inc (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   inc(x: any) => number | string    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → ToNumeric/ToNumber coercion of abstract operand → @nudo:throws TypeError  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
  [ERROR L40 incPositive] incPositive[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 7. Primitive reassignment — `n = "str"`

**tsc:** `Type 'string' is not assignable to type 'number'` — familiar, but carries no value.

The report shows **`#exact` literals**, not abstract type names — the slot currently holds `2`, and `"str"` is the offending value:

```javascript verify
// 7. Primitive reassignment: the report shows the literal, not a type name.
export let n = 1;
n = 2;     // ok
n = "str"; // "str" ⊭ number
```

```text
  [ERROR L44 n] n: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   "str"  #exact
      expected: 2  #exact
      → prim string ⊭ prim number
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 8. Length bound — `tag("")`

**tsc:** `string` is legal; catching `""` needs a branded `NonEmptyString`-style type.

The length constraint is a Pred on the value — `min(1)` — not a new type name:

```javascript verify
// 8. Length bound: min(1) is a Pred, not a branded NonEmptyString type.
export function tag(s) {
  return "[" + s + "]";
}

tag("ok"); // ok
tag("");   // "" ⊭ length(s) ≥ 1
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const tag = fn({ s: string().min(1) }, string());
```

```text
  [ERROR L51 tag] tag[s]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   ""  #exact
      expected: length(s) ≥ 1
      → use a value whose length is ≥ 1, or relax the precondition on s
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 9. Several violations, one run — `arm(-1)` + `bump(0)`

**tsc:** the same several errors as separate type-name rows — nested generics make them louder, not clearer.

Every issue is independent, with its own `actual` / `expected` / `fix:` — scan the list, fix in any order, in parallel. On GitHub Actions / GitLab the annotations land on the exact PR lines:

```javascript verify
// 9. Several violations, one run: every issue independent, all evidence at once.
export function arm(ms) {
  return ms;
}

export function bump(x) {
  return x + 1;
}

arm(30); // ok
bump(2); // ok
arm(-1); // -1 ⊭ ms > 0
bump(0); // 0 ⊭ x > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const arm = fn({ ms: number().gt(0) }, number());
export const bump = fn({ x: number().gt(0) }, number());
```

```text
  [ERROR L63 arm] arm[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
  [ERROR L64 bump] bump[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 10. Fix path — `fix: nudo contract --draft`

**tsc:** says what you may not assign — whether to change the interface or the call is your guess.

Every violation-class diagnostic carries the same next command. `nudo contract --draft` emits a reviewable sidecar draft (`*.nudo.draft.js` — never ambient-loaded); accepting a draft is what creates the L1 obligation. Nothing is silent:

```javascript verify
// 10. Fix path: every violation carries the same next command.
export function cooldown(ms) {
  return ms;
}

cooldown(0); // → fix: nudo contract --draft
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const cooldown = fn({ ms: number().gt(0) }, number());
```

```text
  [ERROR L70 cooldown] cooldown[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## See also

- [Error faces](../guides/error-faces.md) — the five shared faces on one page
- [Nudo vs TypeScript](../guides/vs-typescript.md) — positioning and capability bounds
- [Diagnostics](../reference/diagnostics.md) — every `nudo:*` code, with anchors
