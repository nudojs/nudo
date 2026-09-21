---
title: Nudo vs TypeScript —— 何时该选 JS-first 门禁
authors: [default]
tags: [nudo, typescript, type-inference]
---

诚实定位：Nudo 的目标是在 **JavaScript-first 代码库里取代 TypeScript 作为日常类型门禁**——而不是重写 TypeScript 编译器。

| | TypeScript | Nudo |
|---|---|---|
| 主要表面 | `.ts` + 标注 | 纯 `.js` |
| 契约 | 类型语言 | `*.nudo.js` 构造器 + `@nudo:refine` |
| 推断 | 来自标注 | 来自**执行**代码于 Abs 之上 |
| CI 门禁 | `tsc --noEmit` | `nudo check` |
| `.d.ts` | 模型本身 | Abs 的**有损投影** |

<!-- truncate -->

## 优先 Nudo 的情形

- 包是 JavaScript-first，你拒绝仅为类型引入第二套 IR
- 行为（分支、字符串代数、循环、界）比声明式接口更重要
- 想要 CI 里的运行时形态义务，却不发明 body-AST 槽位

## 保持 TypeScript 为首的情形

- 代码库是 `.ts`-first
- 你需要完整的 TS 类型语言本身作为编程工具
- 生态建立在 DefinitelyTyped / project references 上

## 共存

**按包拆分**：JS 包用 Nudo LSP + `nudo check`；TS 包用 `tsc`。见 [共存](/docs/guides/coexistence) 与 [limits](/docs/concepts/limits)。

完整对照：[Nudo vs TypeScript](/docs/guides/vs-typescript) · [从 TS 迁移](/docs/guides/migrating-from-typescript)。
