# @nudojs/env

Built-in ES, Web, and Node.js API environments for the [Nudo](https://github.com/nudojs/nudo) type inference engine.

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); production analysis is Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/env` supplies the standard-library Abs environments selected by the `/// @nudo:env` directive (`es` / `web` / `node`):

| Subpath | Face |
|---|---|
| `@nudojs/env/es` | ECMAScript built-ins (Array, String, Math, …) |
| `@nudojs/env/web` | Web platform APIs (fetch, URL, Storage, …) |
| `@nudojs/env/node` | Node.js APIs (fs, path, process, …) |

Notes:

- Env fills **API signatures** so analysis can resolve built-in calls. It **never replaces mocks** — use `@nudo:mock` / `@nudo:mock-module` for project-specific stubs and external packages.
- Leaf-clean residual `any` (formats still mentioning unknown/any) is tracked in [`docs/reports/env-coverage-baseline.md`](../../docs/reports/env-coverage-baseline.md). Coverage numbers are informational, not a soundness gate.
- Handwritten env wins over harvested `@types` fill on overlapping modules/exports (see `@nudojs/harvester`).

## Install

```bash
npm install @nudojs/env
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
