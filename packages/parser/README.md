# @nudojs/parser

Babel-based parser and directive extraction for [Nudo](https://github.com/nudojs/nudo).

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); analysis runs Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/parser` handles source code parsing and Nudo directive extraction:

- **Parsing** — wraps Babel parser for JavaScript/TypeScript source files
- **Directives** — extracts `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:env`, `@nudo:mock-module`, `@nudo:as`, and `@nudo:replace` from comments. `@nudo:contract` / `@nudo:import` are parsed in `@nudojs/core` (`algebra/refine.ts`).
- **Case arg expressions** — parses constraint builders and concrete literals used in directives

## Install

```bash
npm install @nudojs/parser
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
