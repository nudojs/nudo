# nudo

Thin installer shell for the **`nudo`** command — it exists so that `npm i -g nudo` (or `npx nudo`) gives you the `nudo` CLI directly. Everything is delegated to [`@nudojs/cli`](https://www.npmjs.com/package/@nudojs/cli), the CLI of the Nudo type inference engine for JavaScript.

```bash
npm i -g nudo
nudo infer file.js

# or without installing
npx nudo infer file.js
```

Nudo infers types by executing your code with symbolic type values (`T.number`, `T.string`, …) — see the monorepo packages for the actual engine:

- [`@nudojs/cli`](https://github.com/nudojs/nudo/tree/main/packages/cli) — CLI (`infer`, `check`, `types`, `watch`, `generate`, `interface`, …)
- [`@nudojs/core`](https://github.com/nudojs/nudo/tree/main/packages/core) — the Abs type system (shape × term × pred × conf)
- [`@nudojs/parser`](https://github.com/nudojs/nudo/tree/main/packages/parser) — Babel-based parser and `@nudo:` directive extraction
- [`@nudojs/service`](https://github.com/nudojs/nudo/tree/main/packages/service) — analyzer orchestration, TypeValue evaluator API (`@nudojs/service/evaluator`), dts generation, harvest
- [`@nudojs/env`](https://github.com/nudojs/nudo/tree/main/packages/env) — ES / Web / Node API type definitions

> Installing both `nudo` and `@nudojs/cli` globally is redundant; pick one. This package only reserves the npm name and re-exports the CLI entry.

Full documentation (English + 中文): <https://nudojs.github.io/nudo/>
