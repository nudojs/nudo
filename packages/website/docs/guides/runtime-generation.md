---
description: "Project Abs into ecosystem artifacts with nudo export — Standard Schema runtime validators, zero-dependency guards, Zod dialect schemas, and .d.ts declarations."
---

# Runtime Validation & Ecosystem Projections

Nudo's inference does not stop at static analysis. `nudo export` projects the same Abs your CI gates into **runtime artifacts**: Standard Schema validators, zero-dependency guards, Zod dialect schemas, and `.d.ts` declarations.

```text
JS code (+ optional sidecar contract) → Abs → nudo export → runtime validators / .d.ts / schemas
```

Every projection is **one-way and lossy** — Abs is the source of truth, and `nudo check` remains the gate. Export is a one-shot shipping command; it does not take `--watch`.

## The `nudo export` command

```bash
nudo export <file> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

Full option/exit-code spec: [CLI Reference](../api/cli-reference.md#nudo-export). Highlights:

| Format | Artifact | Inputs projected |
|--------|----------|------------------|
| `standard` | `<fn>.nudo.standard.ts` — Standard Schema v1 modules (no Zod dependency) | **Sidecar / `@nudo:refine` contract domains**, else join of observed call-site Abs |
| `dts` | TypeScript declarations (default format) | Call-site cases: params widened, returns keep precision |
| `guard` | Zero-dependency `typeof` guard functions | Joined call-site Abs |
| `schema` | Schema source comments for `--dialect` (currently `zod`) | Per-case Abs (`call@L…` / `entry@L…`) |
| `all` | dts + guard + schema + standard | — |

## Contracts-first: validators from your sidecar

The strongest workflow: declare the domain once in a sidecar, let `export` generate the runtime gate from it.

```js
// src/api/users.js
export function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

```js
// src/api/users.nudo.js — contract (also plain JS)
import { number, string, shape, fn } from "@nudojs/core";

export const createUser = fn(
  { input: shape({ name: string(), age: number().ge(0) }) },
  shape({ id: number(), name: string(), age: number() })
);
```

```bash
nudo export src/api/users.js --format standard --out dist
# writes dist/createUser.nudo.standard.ts
```

The generated module exposes one validator per parameter (`<fn>_<param>`) plus one for the return — named **`<fn>Return`** when a return contract exists (`<fn>Output` is used only when there is no contract, or only parameter contracts). **Contract refinements are baked in** — `age: number().ge(0)` becomes a `numBound { op: "ge", n: 0 }` check, and a `lit(42)` contract pins the exact value:

```ts
// dist/createUser.nudo.standard.ts (excerpt)
// (also exports createUserReturn — the return-shape validator from the sidecar)
export const createUser_input = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value) {
      const issues = [];
      __nudoCheck({"k":"obj","slots":[
        {"key":"name","node":{"k":"prim","type":"string","refinements":[]}},
        {"key":"age","node":{"k":"prim","type":"number","refinements":[{"kind":"numBound","op":"ge","n":0}]}}
      ]}, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;
```

Consume it anywhere Standard Schema is supported — no Zod/Valibot dependency:

```js
import { createUser_input } from "./dist/createUser.nudo.standard.js";

const r = createUser_input["~standard"].validate(body);
if (r.issues) return Response.json({ errors: r.issues }, { status: 400 });
const user = createUser(r.value);
```

It is a runtime gate — **not** a replacement for `nudo check`. CI still gates the same contract on Abs.

## Evidence-based: validators from call sites

Without a sidecar, export projects **the join of observed call-site Abs** — what your code actually passes, not a hand-written type:

```js verify
// src/api/inline.js
export function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}

createUser({ name: "Ada", age: 36 });
```

```bash
nudo export src/api/inline.js --format standard --out dist
```

Literals observed at call sites pin exact values (`z.literal` / lit nodes / `=== "Ada"` checks). Add a sidecar when you want contract bounds (`gt/ge/lt/le`, `int`, string length) instead of observed literals.

Honest boundary: an **uncalled** export falls back to `entry@L…` — arguments project as `unknown`, not a guess. That is the `--from`-ceiling ([Limits](../concepts/limits.md#call-site-discovery-ceiling)), not an inference bug.

## Zod dialect schemas (`--format schema`)

Schema source is printed per case as comments — assemble the pieces into your own module:

```bash
nudo export src/api/inline.js --format schema --dialect zod
# or write it to disk directly:
nudo export src/api/inline.js --format schema --dialect zod --out dist
# writes dist/inline.nudo.schema.zod.ts
```

```js
// === createUser Schema (zod) ===
// call@L5:
// Input: { arg0: z.object({ name: z.literal("Ada"), age: z.literal(36) }) }
// Output: z.object({ id: z.literal(123), name: z.literal("Ada"), age: z.literal(36) })
```

Constant numeric bounds / `int` / string length preds from Abs are projected when expressible; unprojectable preds appear under `dropped preds`.

Assemble and use with your favorite resolver:

```js
// src/api/users.schema.js — assembled from the printed expressions
import { z } from "zod";

export const createUserInput = z.object({ name: z.string(), age: z.number() });

// React Hook Form
import { zodResolver } from "@hookform/resolvers/zod";
const { register, handleSubmit } = useForm({ resolver: zodResolver(createUserInput) });
```

## Zero-dependency guards (`--format guard`)

Guards are plain `typeof` checks with no external imports and no schema interpretation — one function per exported fn, named `is<Fn>Output`:

```bash
nudo export src/api/inline.js --format guard
# or write it to disk directly:
nudo export src/api/inline.js --format guard --out dist
# writes dist/inline.nudo.guard.ts
```

```js
// === createUser Type Guards ===
export function iscreateUserOutput(data) {
  return typeof data === "object" && data !== null && data.id === 123 && data.name === "Ada" && data.age === 36;
}
```

Save the printed function into a module (`src/api/users.guard.js`) and import it. Measure both guard and schema paths against your payload shape before choosing; the tradeoff is error-message richness vs zero deps.

## TypeScript declarations (`--format dts`)

One widened signature per function. Parameter positions (contravariant) widen literals to base types so callers can pass any compatible value; return types keep inferred precision:

```bash
nudo export src/api/inline.js --format dts
```

```ts
/**
 * Case: call@L5 ({ name: "Ada"; age: 36 }) => { id: 123; name: "Ada"; age: 36 }
 * @param input - { name: string; age: number }
 * @returns { id: 123; name: "Ada"; age: 36 }
 */
export declare function createUser(input: { name: string; age: number }): { id: 123; name: "Ada"; age: 36 };
```

With multiple cases the signature stays single — params union and widen across cases; each case's precise result is preserved in the `Case:` JSDoc rows. To write `.d.ts` files under a directory: `nudo export <file> --format dts --out <dir>`.

## In CI

Generate validators as part of your build and keep them out of review:

```json
{
  "scripts": {
    "generate": "nudo export src/api/users.js --format standard --out src/generated",
    "gate": "nudo check src/"
  }
}
```

Machine-readable facts for pipelines come from `nudo check --json` / `nudo test --json` — see [CLI Reference](../api/cli-reference.md#nudo-check).

## Next

- [Contracts](./contract.md) — draft / accept / emit sidecar interfaces
- [nudo check](./check.md) — the CI gate on the same Abs
- [Migrate existing JS](./migrating-js.md) — contract-first migration path
- [Coexistence with TypeScript](./coexistence.md) — `.d.ts` interop recipes
