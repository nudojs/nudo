# @nudojs/service

Shared inference service for [Nudo](https://github.com/nudojs/nudo) IDE integrations.

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); production analysis is Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/service` provides the analysis core used by editor extensions and build tools.

Production evaluation is **Abs-native B-path** (`evalAbsModuleGraph` + `runTranspiled`); the TypeValue AST interpreter is gone. Prefer a focused subpath over the full barrel:

| Subpath | Face |
|---|---|
| `@nudojs/service/analysis` | File analysis, diagnostics, call records, Abs module-graph eval |
| `@nudojs/service/evaluator` | Host API surface (env/config/CallRecord) — not the eval engine |
| `@nudojs/service` | Full barrel (stable; analysis face) |

Emit products live in `@nudojs/service/emit` (interface/contract, dts, schema, guard, case reports). IDE surface lives in `@nudojs/lsp`; `@types` harvest in `@nudojs/harvester`.

Highlights:

- **File analysis** — `analyzeFile` returns diagnostics, function analyses, and case results
- **Module graph** — `evalAbsModuleGraph` evaluates a file's import closure as Abs
- **Session caches** — analysis / fn / B-path caches with eviction and project-config limits

## Install

```bash
npm install @nudojs/service
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
