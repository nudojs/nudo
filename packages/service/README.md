# @nudojs/service

Shared inference service for [Nudo](https://github.com/nudojs/nudo) IDE integrations.

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/service` provides the high-level analysis API used by editor extensions and build tools:

- **File analysis** — `analyzeFile` returns diagnostics, function analyses, and case results
- **IDE features** — `getTypeAtPosition`, `getCompletionsAtPosition`, `getCasesForFile`
- **DTS generation** — `generateDts` and `typeValueToTSType` for producing `.d.ts` output

## Install

```bash
npm install @nudojs/service
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
