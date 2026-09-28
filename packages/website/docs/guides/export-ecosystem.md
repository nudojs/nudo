---
slug: /guides/export-ecosystem
description: "Bridge Abs to the ecosystem with nudo export — .d.ts, zero-dependency guards, Zod dialect schemas, Standard Schema validators; a full walkthrough with verified examples, and where Nudo ends and schema libraries begin."
---

# Export: bridge to the ecosystem

**You'll leave with:** the `nudo export` surface, a verified walkthrough of every artifact (`.d.ts` / guards / Zod / Standard Schema), and the one-line division of labor.

> **Schema libraries own the boundary; Nudo owns the internals.**

`nudo check` only validates. Artifacts come from **`nudo export`** — a one-way, lossy projection of Abs. Abs stays the source of truth; nothing reads a projection back.

```text
JS code (+ optional sidecar contract) → Abs → nudo export → runtime validators / .d.ts / schemas
```

Export is a one-shot shipping command — no `--watch`.

## Command surface

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

`--dialect zod` applies to `--format schema|all`. `--out dir` writes the files; without it, export prints to stdout. Flag/exit contract: [CLI Reference](../api/cli-reference.md#nudo-export).

| Format | Artifact | Inputs projected | When to use |
|---|---|---|---|
| `dts` | TypeScript declarations (default) | Call-site cases: params widened, returns keep precision | TS editors / npm types for a JS package |
| `guard` | Zero-dependency `typeof` guard functions | Joined call-site Abs | Inline runtime checks with no deps |
| `schema` | Ready-to-import Zod module (`import { z } from "zod"`) for `--dialect` (currently `zod`) → `*.nudo.schema.zod.ts` | Per-case Abs (`call@L…` / `entry@L…`) | Assemble your own schema module |
| `standard` | [Standard Schema](https://standardschema.dev) v1 modules (`~standard`, vendor `nudo`) | Sidecar / `@nudo:contract` domains, else joined call-site Abs | Plug into any Standard Schema library — no Zod dependency |
| `all` | dts + guard + schema + standard | — | Ship the full set |

## Contracts-first: validators from your sidecar

The strongest workflow: declare the domain once in a sidecar, let `export` generate the runtime gate from it.

```js verify
// src/api/users.js
export function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

```js verify-sidecar
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

```js
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

Schema export is a **ready-to-import JS module** (`import { z } from "zod"` + `export const`), not a comment dump:

```bash
nudo export src/api/inline.js --format schema --dialect zod
# or write it to disk directly:
nudo export src/api/inline.js --format schema --dialect zod --out dist
# writes dist/inline.nudo.schema.zod.ts
```

```js
// @generated by nudo export --format schema — dialect: zod
// One-way lossy projection of Abs; do not edit. nudo check remains the gate.

import { z } from "zod";

export const createUserInput = z.object({ input: z.object({ name: z.string(), age: z.number() }) });

export const createUserOutput = z.object({ id: z.number(), name: z.string(), age: z.number() });
```

Each function gets `<fn>Input` (a `z.object` of named parameters) and `<fn>Output`. Constant numeric bounds / `int` / string length preds from Abs are projected when expressible; unprojectable preds appear under `dropped preds`. Use it with your favorite resolver:

```js
import { createUserInput } from "./inline.nudo.schema.zod";
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

```js verify
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

With multiple cases the signature stays single — params union and widen across cases; each case's precise result is preserved in the `Case:` JSDoc rows (debug extensional notes, not the interface product). To write `.d.ts` files under a directory: `nudo export <file> --format dts --out <dir>`.

## Validate vs project

| | `nudo check` | `nudo export` |
|---|---|---|
| Role | Static implication gate on Abs | One-way projection of Abs |
| Direction | Reads source + contracts | Writes artifacts; nothing reads them back |
| Failure mode | Exit `1` on L1/L2 errors | Exit `1` on usage / IO errors only |
| Watch | `--watch` supported | One-shot shipping command |

Abs is computed once; `check` gates it, `export` ships views of it. Never treat a projection as a second type language — edit the source contract or the code, then re-export.

## Division of labor

| | Zod / ArkType / TypeBox / Valibot | Nudo |
|---|---|---|
| When | `parse` / `safeParse` at an API / form / IO **boundary** | `nudo check` on logic + contracts in **CI** |
| What | Shape of *incoming* data | Pred obligations on *computed* results + entry throws |
| Truth | The schema object | Abs (`shape × term × pred × conf`) |

They compose: export **projects** Abs into schema dialects so boundary code and CI agree on the same facts. The schema is a runtime gate; Nudo is the static implication gate. Do not treat either as a second type language.

- **Boundary validate** — keep Zod / ArkType / TypeBox at the edge where untrusted data enters.
- **Static imply** — keep `nudo check` on internal computation (`x>0` ⇒ `x+1>1`), L1 contracts, and L2 entry may-throw.
- Prefer **Standard Schema** output when you want the artifact to plug into any conforming library without taking a Zod dependency.

Honest limits of Nudo (and when *not* to use it): [Competitive landscape](./competitive-landscape.md).

## CI integration

Gate first, ship artifacts after — export is deterministic on a green tree:

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: npx nudojs check src/
      - run: npx nudojs export src/api.js --format all --out dist
      # publish dist/ with your package
```

Or wire generation into package scripts and keep artifacts out of review:

```json
{
  "scripts": {
    "generate": "nudo export src/api/users.js --format standard --out src/generated",
    "gate": "nudo check src/"
  }
}
```

`export` exits `0` on success and `1` on usage / IO errors — it does not re-run the contract gate. Pair it with `check` (and optionally `health` when you freeze `call@` cases). Machine-readable facts for pipelines come from `nudo check --json` / `nudo test --json` — see [CLI Reference](../api/cli-reference.md#nudo-check). Recipes: [Recipes](./recipes.md).

## Migration note

While bringing a legacy JS package onto Nudo, L2 entry may-throw can be noisy. Named gate profiles keep L1 strict while softening only L2:

```bash
nudo check src/ --profile adoption   # L2 → warning; L1 contract violations still error
nudo check src/ --profile strict     # default: L1 + L2 error
```

Explicit `--entry-throws error|warning|off` overrides the profile. See [nudo check](./check.md).

## Next

- [Competitive landscape](./competitive-landscape.md) — where Nudo sits vs schema libs / TS
- [nudo check](./check.md) — the gate that stays the source of truth
- [Contracts](./contract.md) — draft / accept / emit sidecar interfaces
- [CLI Reference](../api/cli-reference.md#nudo-export)
