# @nudojs/parser

Babel-based parser and directive extraction for [Nudo](https://github.com/nudojs/nudo).

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/parser` handles source code parsing and Nudo directive extraction:

- **Parsing** — wraps Babel parser for JavaScript/TypeScript source files
- **Directives** — extracts `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, and `@nudo:returns` directives from comments
- **Type expressions** — parses inline type value expressions used in directives

## Install

```bash
npm install @nudojs/parser
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
