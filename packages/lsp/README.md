# @nudojs/lsp

Language Server Protocol implementation for the [Nudo](https://github.com/nudojs/nudo) type inference engine.

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); production analysis is Abs-native. Inference executes observed call sites via abstract interpretation — no TypeScript, no build step. Contracts come from `*.nudo.js` sidecars + `@nudo:refine` / `@nudo:interface`.

Primary CLI verbs for agents/CI: `nudo check` (signatures + gate), `nudo test` (case report), `nudo contract` (interfaces), `nudo export` (dts/guard/zod), `nudo health` (drift). Observation is check/test/IDE hover — there is no `nudo infer` primary verb.

## This package

`@nudojs/lsp` implements an LSP server that provides Nudo-powered features to any editor:

- Hover type information
- Completions based on inferred types
- Diagnostics from abstract interpretation (L1 contracts + L2 entry throws)
- Debug scenario navigation for `@nudo:case` witnesses (contract CodeLens first; case is the debug sub-layer)
- Go-to-Definition
- Find References
- Rename Symbol
- Signature Help (parameter hints)
- Code Actions / Quick Fixes
- Semantic Tokens (type-aware highlighting)
- Inlay Hints

Typically consumed by the [nudo-vscode](https://marketplace.visualstudio.com/items?itemName=wmzy.nudo-vscode) extension, but compatible with any LSP client.

## Install

```bash
npm install @nudojs/lsp
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
