# @nudojs/cli

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。  
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

CLI and evaluator API for the [Nudo](https://github.com/nudojs/nudo) analysis engine.

## What is Nudo?

Nudo does not restrict how you write JavaScript. It executes code on Abs (`shape × term × pred × conf`) so you can observe intermediate values/results and enforce contracts sharper than ordinary TypeScript types (`nudo check`).

## This package

`@nudojs/cli` provides:

- **CLI tool** — the `nudo` command for inferring types and generating `.d.ts` files
- **Evaluator API** — programmatic access to `evaluateFunction`, `evaluateProgram`, and module resolution

## Install

```bash
npm install @nudojs/cli
```

## Usage

```bash
# Infer types for a file
npx nudojs infer src/utils.js

# Generate .d.ts output
npx nudojs infer src/utils.js --dts
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)

Docs: https://nudojs.github.io/nudo/ · Playground: https://nudojs.github.io/nudo/playground
