---
description: "Gate signatures and cases on a plain JavaScript file — npx nudojs check / test."
---

# Quick Start

**You'll leave with:** signatures from `nudo check`, cases from `nudo test`, a sidecar contract, a `nudo check` failure you can read — and the green re-run that closes the loop.

Prefer the browser? Open the [Playground](/playground).

> **Trust boundary.** Nudo analyzes by **executing** the target code (Abs semantics, in-process evaluation). Do not run `nudo check` / `nudo test` on untrusted code; in CI this is the same trust as running the project's tests.

## 1. Write plain JavaScript

Create `calc.js`:

```javascript verify
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);
```

No annotations. Call sites are evidence.

## 2. Observe (Day 0)

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: any) => number | string
  formatName(first: any, last: any) => string

(no issues)
```

That `number | string` is honest JavaScript, not a bug: an unconstrained (`any`) operand to `+` can drive numeric addition *or* string concatenation (`"7" + 1`), so Nudo keeps both branches. Constrain `x` — a sidecar contract or call-site evidence — and the union collapses to `number`. See [Language semantics](../concepts/semantics.md).

Optional debug cases (`nudo test` — not the product gate):

```text
=== scale ===
  call@L10  (5) => 6

=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

Nudo executed the functions with the arguments it actually saw. Unconstrained entry params display as **`any`** (not `unknown`). Observation is `check` signatures + IDE hover; `nudo test` is an optional debug case reporter.

## 3. Add an explicit contract (Day 1)

Create `calc.nudo.js` next to the source:

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. Gate with check

Add a call that violates the sidecar:

```javascript verify
scale(0); // fails the sidecar — x must be > 0
```

Run the gate:

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: number) => number
  formatName(first: any, last: any) => string

issues
  [ERROR L12 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
```

The violation is reported against the call site. Fix the call (or widen the contract), and `check` passes — still printing signatures.

`if` guards are **not** refinements. Explicit contracts come from sidecars / `@nudo:contract`. Without them, L2 still gates undigested may-throw on exports (entry params are `any`).

## 5. Close the loop: green, CI, IDE

Fix the violating call — any value satisfying `x > 0`:

```js
scale(2); // satisfies the sidecar — x must be > 0
```

Re-run the gate:

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: number) => number
  formatName(first: any, last: any) => string

(no issues)
```

Green — and signatures still print; only the `OK` / `FAILED` line and the exit code (`0`) tell you the gate passed. Two places left to close the loop:

- **CI** — wire `nudo check` into GitHub Actions: [CI integration → GitHub Actions](../guides/check.md#github-actions)
- **IDE** — hover, inlay hints, and case switching in VS Code: [VS Code guide](../guides/vscode.md)

## Options

- **`.d.ts` projection** — ecosystem bridge (one-way, lossy; Abs is the truth):

  ```bash
  npx nudojs export calc.js --format dts --out dist/types
  ```

- **Watch mode** (flag, not a verb)

  ```bash
  npx nudojs check src/ --watch
  npx nudojs test src/ --watch
  ```

## Export bridge + adoption profile (Contracts → ecosystem)

Once check is green (or while you are still migrating), project Abs outward — `.d.ts` for editors, Zod / Standard Schema / guards for boundary code:

```bash
npx nudojs export calc.js --format all --out dist
```

Schemas manage data at the boundary; Nudo manages facts computed inside. Full story: [Export: bridge to the ecosystem](../guides/export-ecosystem.md).

Legacy JS too noisy under L2? Use the named migration gate profile — L1 contract violations stay **error**, only entry may-throw drops to warning:

```bash
npx nudojs check calc.js --profile adoption
```

## Debug witnesses (optional)

`@nudo:case` is for **scenario debugging** (`nudo test`, LSP case switching) — not the contract product:

```javascript
/**
 * @nudo:case "double digits" (10)
 */
export function scale(x) {
  return x + 1;
}
```

Prefer concrete values or constraint builders in cases.

## Next

- [Mental model](./mental-model.md)
- [Troubleshooting](./troubleshooting.md) — first-hour FAQ
- [How to use these docs](../intro.md)
- [Error faces](../guides/error-faces.md) — what violations look like
- [nudo check](../guides/check.md)
- [nudo contract](../guides/contract.md)
- [Migrate from TypeScript](../guides/migrating-from-typescript.md) — retire `tsc`
- [Concept Layers](../concepts/layers.md)
- [Recipes](../guides/recipes.md)
- [Playground](/playground)
