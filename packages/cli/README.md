# @nudojs/cli

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。  
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

CLI and evaluator API for the [Nudo](https://github.com/nudojs/nudo) analysis engine.

## What is Nudo?

Nudo does not restrict how you write JavaScript. It executes code on Abs (`shape × term × pred × conf`) so you can observe intermediate values/results and enforce contracts sharper than ordinary TypeScript types.

## This package

`@nudojs/cli` provides:

- **CLI tool** — the `nudo` command: `check`, `test`, `contract`, `export`, `health`, `env harvest`
- **Evaluator API** — programmatic access to analysis entrypoints and module resolution

## Install

```bash
npm install @nudojs/cli
```

## Usage

```bash
# Day 0 — signatures + L2 entry throws
npx nudojs check src/utils.js

# Day 0 — every inferred case (synthetic call@ / entry@ included)
npx nudojs test src/utils.js

# Day 1 — draft / emit contracts
npx nudojs contract --draft src/utils.js --write
npx nudojs check src/utils.js

# Ecosystem — .d.ts / guard / zod projection
npx nudojs export src/utils.js --format dts --out dist/types
```

Primary verbs:

```text
nudo check <path> [--watch]     # gate + signatures (CI)
nudo test <path> [--watch]      # case report + declared assertions
nudo contract <path>            # draft / emit interfaces
nudo export <path>              # dts | guard | zod
nudo health [paths]             # drift + analysis errors
nudo env harvest <pkg>          # @types → env
```

Deprecated (stderr warning; removed next major): `infer`, `types`, `interface`/`refine`, `generate`/`emit`/`guard`, `doctor`, `watch`, top-level `harvest`. Use the verbs above instead.

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)

Docs: https://nudojs.github.io/nudo/ · Playground: https://nudojs.github.io/nudo/playground
