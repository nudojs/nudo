# @nudojs/harvester

Harvests TypeScript `@types` / `.d.ts` declarations into Nudo Abs env modules.

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); production analysis is Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/harvester` converts `.d.ts` files into env definitions (Abs constructors from `@nudojs/core`) that plug into the `/// @nudo:env` loading path.

- **Analysis auto-fill** — `@nudojs/service` harvests missing `@types` modules at analysis time; most users never call this package directly.
- **Env-package authoring** — generate `defineEnv` sources when building custom env faces.
- **Not a product CLI verb** — harvest is analysis-internal / env-package tooling (`nudo` primary verbs are `check` / `test` / `contract` / `export` / `health`).

Public API: `harvestDts` and `emitEnvModule`. Full reference: [website API docs](https://nudojs.github.io/nudo/docs/api/harvester) ([source](../../packages/website/docs/api/harvester.md)).

## Install

```bash
npm install @nudojs/harvester
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
