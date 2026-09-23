---
slug: /guides/env-harvest
description: Where dependency types come from — fixed es/web/node envs, silent @types auto-fill, and when to mock.
---

# Dependency types

Nudo types Node/Web and third-party packages without a user-facing harvest command. Product env is a **fixed set** (`es` / `web` / `node` via `@nudojs/env`); everything else is either silent analysis fill-in or your own mock.

## How types arrive

| Import target | What happens |
|---|---|
| Built-in APIs (`path`, `fs`, DOM…) | Handwritten `@nudojs/env` (`es` / `web` / `node`) |
| JS source package ships usable `.js`/`.mjs` | Analysis **executes** the source (Abs evaluator) |
| `@types/*` or package-shipped `.d.ts` | Analysis **auto-harvests** declarations into env modules — no CLI step |
| Neither source nor types | Empty modules → use `@nudo:mock` or a path-based `/// @nudo:env` |

Harvest is **not** a product verb. Third-party `@types` fill in during `nudo check` / `nudo test` / LSP analysis; handwritten `@nudojs/env` wins on overlapping module keys and export names.

## Named env vs path env

Named environments are fixed:

```javascript
/// @nudo:env node
```

For a custom surface (domain package, hand-tuned signatures), write or generate an env module and reference it by path:

```javascript
/// @nudo:env ./my-env.ts
```

Path envs export `defineEnv()` and use Abs constructors from `@nudojs/core`. `@nudojs/harvester` can generate that shape from `.d.ts` for **env package authors** — it is a library helper, not something end users run.

## Honest boundary

**Env / auto-harvest does not replace mocks.** Native runtime callbacks, dynamic `require`, and unmodeled natives can still surface as `unknown` / `entry@` results. Coverage baselines are **not** soundness claims. See [Limits](../concepts/limits.md) and [Language semantics](../concepts/semantics.md).

Mock instead when the API is process-local or heavily dynamic:

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

## Next

- [Directives — `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md) (env-authoring library)
- [Recipes](./recipes.md)
