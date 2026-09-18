---
sidebar_position: 8
slug: /guides/coexistence
description: Run Nudo on JS while TypeScript stays on TS packages — monorepo recipes that do not fight.
---

# Coexistence with TypeScript

Nudo and `tsc` can share a repo. Nudo targets **JavaScript** (and stripped `.ts` sources); it does not replace the TS compiler for `.ts`-first packages.

## Recipe 1: JS packages use Nudo, TS packages use tsc

```
apps/
  web/          # TypeScript → tsc / ts-node
packages/
  legacy-js/    # plain .js → nudo check + Nudo LSP
```

`packages/legacy-js/package.json`:

```json
{
  "nudo": {
    "interface": { "autoBind": true },
    "analysis": { "mode": "exports", "diagnostics": "default" }
  }
}
```

CI for that package:

```bash
npx nudojs check packages/legacy-js/src
```

Do **not** run `nudo check` over `apps/web/**/*.ts` unless you intentionally strip types.

## Recipe 2: Only `src/**/*.js` under Nudo

```json
{
  "nudo": {
    "analysis": {
      "include": ["src/**/*.js"],
      "exclude": ["**/node_modules/**", "**/dist/**", "**/*.ts"],
      "mode": "exports"
    }
  }
}
```

`.ts` files stay with tsc. Nudo LSP provides hover/inlays for opened `.js` files that match `include` **only when** `analysis.mode` is `exports` or `all`.

> **Default note:** `nudo.analysis.mode` currently defaults to `"directives"` — plain `.js` files without `@nudo:` are not analyzed by the IDE until you opt in. Named-path CLI commands (`nudo check src/lib.js`) still analyze that file regardless of mode.

## Recipe 3: Gradual contracts

1. Infer first — no directives required.
2. When a function needs a CI gate, add `fn.nudo.js` next to it.
3. `nudo check` enforces only **handwritten** sidecars; `@generated` segments are facts + drift, not new obligations.

## What not to do

- Do not expect Nudo to understand TypeScript type syntax (conditional types, `infer`, etc.).
- Do not point both tools at the same `.ts` sources with conflicting severity without splitting paths.
- Do not treat `.d.ts` projection (`nudo emit`) as the source of truth — Abs is; `.d.ts` is a one-way compatibility channel.

## IDE

Install the Nudo VS Code extension alongside the built-in TS server. They coexist: TS handles `.ts`, Nudo analyzes `.js` according to `nudo.analysis.mode`. **Shipped default is `"directives"`** — set `"exports"` or `"all"` to analyze unannotated `.js` in the IDE.
