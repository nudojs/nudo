# @nudojs/core

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。  
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

Core Abs type system for the [Nudo](https://github.com/nudojs/nudo) analysis engine.

## What is Nudo?

Nudo does not restrict how you write JavaScript. It executes code on Abs (`shape × term × pred × conf`) so you can faithfully observe intermediate values and results, and validate them with contracts sharper than ordinary TypeScript types.

## This package

`@nudojs/core` provides the foundational type representations and operations:

- **Abs** — `shape × term × pred × conf`; constraints participate in algebra
- **Type operations** — union simplification, assignability (`leqAbs`), check/gate
- **Operators & dispatch** — binary ops, property access, method calls on Abs
- **Rendering** — `formatShape` / `formatAbs`, one-way projections (`absToTSType`, zod)
- **Environment** — scoped variable bindings for the abstract interpreter

## Install

```bash
npm install @nudojs/core
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
