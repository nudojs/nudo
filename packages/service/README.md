# @nudojs/service

Shared inference service for [Nudo](https://github.com/nudojs/nudo) IDE integrations.

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); production analysis is Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/service` provides the high-level analysis API used by editor extensions and build tools.

Production evaluation is **Abs-native B-path** (`evalAbsModuleGraph` + `runTranspiled`); the TypeValue AST interpreter is gone. Prefer a focused subpath over the full barrel:

| Subpath | Face |
|---|---|
| `@nudojs/service/analysis` | File analysis, diagnostics, call records, Abs module-graph eval |
| `@nudojs/service/interface` | Interface / contract product (surface, emit, draft, derive) |
| `@nudojs/service/dts` | Extensional projections: dts / schema / standard / guard |
| `@nudojs/service/case` | Debug case reports + case directive emit (`nudo test`) |
| `@nudojs/service/lsp` | IDE surface (hover, completions, semantic tokens, inlays) |
| `@nudojs/service/harvest` | `@types` → Abs env harvesting |
| `@nudojs/service/evaluator` | Host API surface (env/config/CallRecord) — not the eval engine |
| `@nudojs/service` | Full barrel (stable; all of the above) |

Highlights:

- **File analysis** — `analyzeFile` returns diagnostics, function analyses, and case results
- **IDE features** — `getTypeAtPosition`, `getCompletionsAtPosition`, `getCasesForFile`
- **DTS generation** — `generateDts` / `absToTSType` for producing `.d.ts` output from Abs
- **Schema projection** — `absToSchemaSource` / `projectAbsToSchema` produce dialect schema source
- **Guard generation** — `generateGuardFunction` produces zero-dependency runtime type guards

## Install

```bash
npm install @nudojs/service
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
