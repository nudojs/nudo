---
"@nudojs/service": minor
---

**BREAKING**: standard 面的**导出集**变了 —— 解构形参的字段级校验器
（`act_a` / `act_b`）**移除**，改为整参校验器 `<fn>Input`（与 zod 面同名同义）。

谁会坏：`import { act_a } from "*.nudo.standard"` 的消费方 —— 这些导出**不再
存在** ⇒ 消费方 `tsc --noEmit` 会红（此前它们拒收正确入参、收下错误入参，本就
不可用）。

怎么迁移：改 import `<fn>Input`（一个校验器校验**整个**入参对象）并重新生成
产物。

`nudo export --format standard` now produces a product that compiles in a
strict TypeScript project, keeps literal values intact, and exposes one
input validator with the same name as the zod face.

- The generated module was plain JavaScript with a `.ts` extension, so every
  helper parameter and local was an implicit `any`: `tsc --noEmit --strict`
  reported a dozen `TS7006` / `TS7005` / `TS7034` errors per file and the
  product was unusable in a strict project, while the zod face of the same
  export compiled cleanly. The helpers now carry their types
  (`__nudoTypeOf(v: unknown): string`,
  `__nudoCheck(node: NudoSchemaNode, value: unknown, path: (string | number)[], issues: NudoIssue[]): void`)
  and the module ships the `NudoSchemaNode` / `NudoIssue` type aliases it
  needs.
- Schema nodes were serialized with `JSON.stringify`, which has no notation
  for non-finite numbers: `Infinity` was silently written as `null`, so the
  exported validator rejected the value the function always returns and
  accepted a value it never returns — the opposite of the zod, guard and
  `nudo check` faces. Nodes are now written as source text, so `Infinity`,
  `-Infinity` and `NaN` survive; a `bigint` literal no longer throws
  `Do not know how to serialize a BigInt`, which used to abort the whole
  `nudo export` run and lose the other dialects' output as well.
- The input face of a function with a destructured parameter exported the
  contract's field-level entries as if they were whole parameters
  (`act_a`, `act_b`), so `act_a.validate({ a: 1, b: 2 })` rejected the
  correct argument and `act_a.validate(1)` accepted a wrong one. A
  function-level assembler (`absToStandardSchemaFunction`) now emits
  `<fn>Input` — one validator for the whole argument object, named like the
  zod face — keeps `<fn>_<param>` for real parameters, and never lifts a
  destructured field to a top-level parameter validator.
