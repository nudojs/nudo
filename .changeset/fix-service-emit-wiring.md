---
"@nudojs/service": minor
"nudojs": minor
---

**BREAKING**: dts 面的**投影形状**变了 —— `.d.ts` 现在按**模块面**装配
（类作为**类声明**投影、成员在类体内；`export default` 保持默认形态；
`export * from` / `export { x } from` 的再导出被复现）；standard 面的输入面
导出名也统一成 `<fn>Input`（解构形参不再导出字段级校验器 `act_a` / `act_b`）。

谁会坏：消费方 `import` 生成 `.d.ts` 的类型并按**旧形状**引用的代码 ——

- 类成员此前被摊成**模块级**声明（源码里并不存在这些顶层符号）⇒ 旧 `.d.ts`
  的形状与新 `.d.ts` 不同 ⇒ 消费方 `tsc --noEmit` 会红；
- 再导出的符号此前**整个缺失** ⇒ 现在出现（反向：依赖「它不在」的代码会冲突）；
- standard 面解构形参的 `act_a` / `act_b` 导出**移除**，改为 `<fn>Input`。

怎么迁移：重新生成产物并按新形状引用（类成员走 `Class.member`，再导出符号现在
可用）；standard 面改 import `<fn>Input`。

Cross-shard wiring for the `service-emit` batch: the CLI now feeds the
product faces the same information the analyzer holds, and a frozen
witness no longer takes over a function's published type.

- `nudo export --format standard` builds its module with the service
  assembler (`absToStandardSchemaFunction`) instead of a hand-rolled
  projection, so the standard face has the same input validator as the zod
  face (`<fn>Input`, one validator for the whole argument object) and a
  destructured parameter no longer exports field-level validators
  (`act_a`, `act_b`) that reject the correct argument.
- The dts face is now assembled from the **module** surface: a class is
  projected once as a class declaration (members inside the class body)
  instead of one flat declaration per member, `export default` keeps its
  default form, and `export * from` / `export { x } from` re-exports are
  reproduced. Before, the class members were emitted as module-level
  declarations that did not exist in the source and a re-exported symbol
  was missing from the `.d.ts` entirely.
- A contract that declares an optional parameter now reaches the product
  faces: the constraint's `isOptional` is carried explicitly (the entry
  `Abs` does not keep it), so the zod input object renders
  `.optional()` and the dts declaration uses `x?: T`.
- `nudo contract --emit` renders each diagnostic exactly once. The emit
  summary already renders and consumes the issue list, so the CLI's
  trailing error-only loop printed the same diagnostic a second time on
  the dry-run path.
- `nudo contract --emit --write` now exits non-zero when it refuses to
  overwrite a hand-edited draft. The file is left untouched (as before),
  but a silent exit `0` told CI that the draft had been regenerated.
- `nudo check --fix` states explicitly when the fix did not turn the gate
  green but changed the diagnostic instead (for example the old
  `constraint-violated` became a new `entry-may-throw`). The previous
  message ("N residual error(s) remain") read as if the fix had worked.
- `nudo export` no longer collapses a function's published type to a
  single frozen call site. A `@nudo:case` witness without an assertion
  observes **one point**; it is not a domain claim, so it must not own the
  return face. `nudo test --freeze` writes exactly such a witness, so
  freezing a call used to narrow the zod face to `z.literal(3)` and the
  guard face to `data === 3` — a guard that rejects every legal call —
  while `nudo check` still reported `number | string` for the same
  function. A function whose only evidence is a point witness now keeps
  its inferred domain, and the zod, standard, guard and dts faces agree
  with the check face.
- `nudo test` classifies a case as synthetic by its **source** instead of
  by its name. A witness written by `--freeze` is named after the call
  site (`call@<file>:<line>`) but is declared in the source, so it was
  reported as synthetic and the run claimed "no declared @nudo:case
  expectations" even though the source now declares one.
- `nudo contract --emit` removes a generated section whose export no
  longer exists in the source. The stale section kept the name occupied
  in the sidecar, so a hand-written contract for a new function of the
  same name produced an invalid sidecar.
- A rest parameter is now observed as a **variable-length** argument, and
  the entry fallback observation of it is marked uncertain. Before,
  `xs.length` was observed as the literal `1` of the single placeholder
  argument, and the zod, standard and guard faces projected that
  one-off observation as the output domain (`literal(1)`) — a validator
  that rejects the value the exported function itself returns — while the
  dts face wrote `number`.
