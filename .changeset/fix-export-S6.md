---
"@nudojs/service": patch
---

`nudo export` 的 standard / guard 两面不再丢符号名与可选性。

- **standard 面的返回面导出名恒为 `<fn>Output`**（Bug 614）。此前返回面的名字
  与符号来源耦合：有返回契约时叫 `<fn>Return`，走观测时叫 `<fn>Output`，同一
  个函数换个源码状态就换了名字——下游 `import { <fn>Output } from
  "*.nudo.standard"` 直接报错，而同一次导出的 zod 面**恒叫** `<fn>Output`，
  两面同物异名。现在名字与来源解耦，恒叫 `<fn>Output`（内容仍按「契约返回优
  先，否则观测返回」取值）。
- **standard 面的顶层形参保住可选性**（Bug 627）。顶层形参导出走的是独立值节
  点（不是对象槽），结构上无处挂 `optional`，契约允许的 `undefined` 被运行时
  拒收（`number().optional()` 的形参，`act_x.validate(undefined)` 应当通过）。
  现在契约级可选性（`StandardSchemaFunctionSpec.inputs[].optional`）与声明级
  可选性（默认形参）都被保真：可选位的整参校验器接受 `undefined`
  （`T | undefined`，与 zod 面 `.optional()` 同判据），`<fn>Input` 的对应槽位
  带 `optional`（键可缺席）。
- **guard 面的导出名可以模块内去重**（Bug 608）。守卫名此前只过字符清洗
  （`A.b` → `isA_bOutput`），两个不同的源函数清洗后同名就会在同一份守卫产物里
  产生两个 `export function isA_bOutput`（node 下 `SyntaxError`，tsc 下
  `TS2323` / `TS2393`）。`generateGuardFunctionFromAbs(name, abs, used?)` 现在
  接受一个**模块级去重集合**（与 zod 面 `safeExportIdent(name, used)` 同一套
  口径：`isA_bOutput` / `isA_bOutput_2`）；不传该集合时行为与旧版一致。
