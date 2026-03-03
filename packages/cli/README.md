# @nudojs/cli

CLI and evaluator API for the [Nudo](https://github.com/nudojs/nudo) type inference engine.

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

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
npx nudo infer src/utils.js

# Generate .d.ts output
npx nudo infer src/utils.js --dts
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
