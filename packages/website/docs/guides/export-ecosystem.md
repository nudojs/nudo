---
slug: /guides/export-ecosystem
description: "Bridge Abs to the ecosystem with nudo export — dts / guard / schema / standard, Zod dialect, and where Nudo ends and schema libraries begin."
---

# Export: bridge to the ecosystem

**You'll leave with:** the `nudo export` surface, how it hands facts to Zod / ArkType / TypeBox, and the one-line division of labor.

> **schema 管边界；Nudo 管内部。**

`nudo check` only validates. Artifacts come from **`nudo export`** — a one-way, lossy projection of Abs. Abs stays the source of truth; nothing reads a projection back.

## Command surface

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

| `--format` | Artifact |
|---|---|
| `dts` | TypeScript declarations (default) — one-way npm/editor bridge |
| `guard` | Zero-dependency runtime type-guard functions |
| `schema` | Schema source for `--dialect` (currently `zod`) → `*.nudo.schema.zod.ts` |
| `standard` | [Standard Schema](https://standardschema.dev) v1 modules (`~standard`, vendor `nudo`) |
| `all` | dts + guard + schema + standard |

`--dialect zod` applies to `--format schema|all`. `--out dir` writes the files; without it, export prints to stdout. Export is a one-shot shipping command — no `--watch`.

```bash
nudo export src/api.js --format dts --out dist/types
nudo export src/api.js --format schema --dialect zod --out dist
nudo export src/api.js --format all --out dist
```

Per-format inputs and examples: [Runtime generation](./runtime-generation.md). Flag/exit contract: [CLI Reference](../api/cli-reference.md#nudo-export).

## What each format is for

| Format | When to use | Projects from | Example consumer |
|---|---|---|---|
| `dts` | TS editors / npm types for JS packages | Call-site cases (params widened, returns keep precision) | `tsc`, IDE go-to-def |
| `guard` | Inline runtime checks with zero deps | Joined call-site Abs | `if (!isUserOutput(x)) …` |
| `schema` | Assemble your own Zod (or dialect) module | Per-case Abs (`call@L…` / `entry@L…`) | Zod / resolver ecosystem |
| `standard` | Plug into any Standard Schema library | Sidecar / `@nudo:contract` domains, else joined call-site Abs | `~standard.validate` |

### dts — declarations for TS consumers

```bash
nudo export src/api.js --format dts --out dist/types
```

One widened signature per function; case precision stays in JSDoc `Case:` rows (debug extensional notes, not the interface product). Use when a JS package needs a `.d.ts` face without adopting TypeScript.

### guard — zero-dependency type guards

```bash
nudo export src/api.js --format guard --out dist
```

Plain `typeof` checks, one function per export (`is<Fn>Output`). Use inside runtime code that must not import a schema library:

```js
export function iscreateUserOutput(data) {
  return typeof data === "object" && data !== null && data.id === 123 && data.name === "Ada" && data.age === 36;
}
```

### schema — Zod dialect source

```bash
nudo export src/api.js --format schema --dialect zod --out dist
# writes dist/*.nudo.schema.zod.ts
```

Prints per-case schema expressions (comments or file). Constant numeric bounds / `int` / string-length preds project when expressible; unprojectable preds appear under `dropped preds`. Assemble into your own module and hand to a resolver (React Hook Form, etc.).

### standard — Standard Schema validators

```bash
nudo export src/api.js --format standard --out dist
# writes <fn>.nudo.standard.ts
```

One validator per parameter (`<fn>_<param>`) plus the return (`<fn>Return` when a return contract exists). Contract refinements are baked in (`number().ge(0)` → `numBound { op: "ge", n: 0 }`). Consume anywhere Standard Schema is supported — no Zod dependency:

```js
const r = createUser_input["~standard"].validate(body);
if (r.issues) return Response.json({ errors: r.issues }, { status: 400 });
```

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

`export` exits `0` on success and `1` on usage / IO errors — it does not re-run the contract gate. Pair it with `check` (and optionally `health` when you freeze `call@` cases). Recipes: [Recipes](./recipes.md).

## Migration note

While bringing a legacy JS package onto Nudo, L2 entry may-throw can be noisy. Named gate profiles keep L1 strict while softening only L2:

```bash
nudo check src/ --profile adoption   # L2 → warning; L1 contract violations still error
nudo check src/ --profile strict     # default: L1 + L2 error
```

Explicit `--entry-throws error|warning|off` overrides the profile. See [nudo check](./check.md).

## Next

- [Runtime generation](./runtime-generation.md) — full export walkthrough
- [Competitive landscape](./competitive-landscape.md) — where Nudo sits vs schema libs / TS
- [nudo check](./check.md) — the gate that stays the source of truth
- [CLI Reference](../api/cli-reference.md#nudo-export)
