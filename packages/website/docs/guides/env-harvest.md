---
slug: /guides/env-harvest
description: nudo env harvest — convert @types declarations into Nudo env modules.
---

# nudo env harvest

`nudo env harvest` converts `@types/<pkg>` declarations into a Nudo env module so `@nudo:env` can type Node/Web APIs during analysis.

```bash
npx nudojs env harvest <pkg> [--out dir]
npx nudojs env harvest node
```

Reference the generated env from source:

```ts
/// @nudo:env ./nudo-harvest-node.ts
```

Built-in `es` / `web` / `node` envs already cover a large slice of common APIs (`@nudojs/env`).

## Honest boundary

**Env / harvest does not replace mocks.** Native runtime callbacks, dynamic `require`, and unmodeled natives can still surface as `unknown` / `entry@` results. Coverage baselines are **not** soundness claims. See [Limits](../concepts/limits.md) and [Language semantics](../concepts/semantics.md).

Mock instead when the API is process-local or heavily dynamic:

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

## Next

- [Directives — `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md)
- [Recipes](./recipes.md)
