# nudojs

Thin installer shell for the **`nudo`** command — it exists so that `npm i -g nudojs` (or `npx nudojs`) gives you the `nudo` CLI directly. Everything is delegated to [`@nudojs/cli`](https://www.npmjs.com/package/@nudojs/cli), the CLI of the Nudo type inference engine for JavaScript.

> The bare npm name `nudo` was unavailable, so this package is published as **`nudojs`**. The installed command is still `nudo`.

```bash
npm i -g nudojs
nudo infer file.js

# or without installing
npx nudojs infer file.js
```

Nudo infers types by executing your code under abstract interpretation on **Abs** (`shape × term × pred × conf`) — constraints participate in algebra. There is no `T.*` type-value IR. Contracts come from `*.nudo.js` / `@nudo:refine`; call sites are evidence. See the monorepo packages for the actual engine:

- [`@nudojs/cli`](https://github.com/nudojs/nudo/tree/main/packages/cli) — CLI (`infer`, `check`, `types`, `watch`, `generate`, `interface`, …)
- [`@nudojs/core`](https://github.com/nudojs/nudo/tree/main/packages/core) — the Abs type system (shape × term × pred × conf)
- [`@nudojs/parser`](https://github.com/nudojs/nudo/tree/main/packages/parser) — Babel-based parser and `@nudo:` directive extraction
- [`@nudojs/service`](https://github.com/nudojs/nudo/tree/main/packages/service) — analyzer orchestration, Abs-native evaluator API (`@nudojs/service/evaluator`), dts generation, harvest
- [`@nudojs/env`](https://github.com/nudojs/nudo/tree/main/packages/env) — ES / Web / Node API type definitions

> Installing both `nudojs` and `@nudojs/cli` globally is redundant; pick one. This package only re-exports the CLI entry under the short `nudo` bin.

Full documentation (English + 中文): <https://nudojs.github.io/nudo/>
