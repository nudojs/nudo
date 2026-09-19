# nudojs

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。  
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

Thin installer shell for the **`nudo`** command — it exists so that `npm i -g nudojs` (or `npx nudojs`) gives you the `nudo` CLI directly. Everything is delegated to [`@nudojs/cli`](https://www.npmjs.com/package/@nudojs/cli), the CLI of the Nudo type inference engine for JavaScript.

> The bare npm name `nudo` was unavailable, so this package is published as **`nudojs`**. The installed command is still `nudo`.

```bash
npm i -g nudojs
nudo check file.js
nudo test file.js

# or without installing
npx nudojs check file.js
```

Primary verbs: `check` · `test` · `contract` · `export` · `health` · `env harvest`.

Nudo infers types by **executing** your code on Abs (`shape × term × pred × conf`) — see the monorepo packages for the actual engine:

- [`@nudojs/cli`](https://github.com/nudojs/nudo/tree/main/packages/cli) — CLI (`check`, `test`, `contract`, `export`, `health`, `env harvest`)
- [`@nudojs/core`](https://github.com/nudojs/nudo/tree/main/packages/core) — the Abs type system (shape × term × pred × conf)
- [`@nudojs/parser`](https://github.com/nudojs/nudo/tree/main/packages/parser) — Babel-based parser and `@nudo:` directive extraction
- [`@nudojs/service`](https://github.com/nudojs/nudo/tree/main/packages/service) — analyzer orchestration, Abs-native evaluator API (`@nudojs/service/evaluator`), dts generation, harvest
- [`@nudojs/env`](https://github.com/nudojs/nudo/tree/main/packages/env) — ES / Web / Node API type definitions

> Installing both `nudojs` and `@nudojs/cli` globally is redundant; pick one. This package only re-exports the CLI entry under the short `nudo` bin.

Full documentation (English + 中文): <https://nudojs.github.io/nudo/><br/>
Playground: <https://nudojs.github.io/nudo/playground>
