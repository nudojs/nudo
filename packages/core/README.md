# @nudojs/core

Core type value primitives and type system for the [Nudo](https://github.com/nudojs/nudo) inference engine.

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

## This package

`@nudojs/core` provides the foundational type representations and operations:

- **Type values** — `TypeValue`, `LiteralValue`, `Refinement`, and the `T` namespace of built-in types
- **Type operations** — union simplification, subtype checking, narrowing, widening
- **Operators & dispatch** — binary ops, property access, method calls on type values
- **Environment** — scoped variable bindings for the abstract interpreter

## Install

```bash
npm install @nudojs/core
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
