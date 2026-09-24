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
