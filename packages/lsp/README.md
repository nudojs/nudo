# @nudojs/lsp

Language Server Protocol implementation for the [Nudo](https://github.com/nudojs/nudo) type inference engine.

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/lsp` implements an LSP server that provides Nudo-powered features to any editor:

- Hover type information
- Completions based on inferred types
- Diagnostics from abstract interpretation
- Case navigation for `@nudo:case` directives

Typically consumed by the [nudo-vscode](https://marketplace.visualstudio.com/items?itemName=wmzy.nudo-vscode) extension, but compatible with any LSP client.

## Install

```bash
npm install @nudojs/lsp
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
