# nudojs

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

The **`nudo`** CLI of the Nudo type inference engine for JavaScript.

```bash
npm i -g nudojs
nudo check file.js
nudo test file.js

# or without installing
npx nudojs check file.js
```

Primary verbs: `check` · `test` · `contract` · `export` · `health`. `migrate` is the one-way TypeScript retirement gate.

```text
nudojs <version>
@nudojs/core <version>   # when resolvable
```

> **Migration:** `@nudojs/cli` is a deprecated stub that forwards here. Install `nudojs` only.

Full documentation: <https://nudojs.github.io/nudo/>
