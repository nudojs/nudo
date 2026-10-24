---
"nudojs": major
---

**BREAKING**: `nudo export` 的四个产物面现在共用**同一条导出面规则**，且**硬失败**
不再静默发布产物。

- 四个产物面只投影**模块的公开导出面**（此前 zod / standard / guard 投影**每一个**
  函数，含内部实现）⇒ 未导出的内部实现**不再**有 `<fn>Input` / `is<fn>Output`
  之类的导出 ⇒ 直接 import 这些导出的消费方 `tsc --noEmit` 会红。
- `@nudo:skip` 的函数此前被导出面过滤器**排除**（它按设计没有 case 见证）⇒ 从不
  出现在任何产物面；现在它**照常投影** ⇒ 产物多出此前没有的导出。

谁会坏：按「产物里有某个函数」做**存在性**判断的消费方（内部实现不再有守卫 /
zod 校验器）；以及期待 `@nudo:skip` 的函数**不出现**在产物里的脚本。

怎么迁移：重新生成产物并只依赖**公开导出面**上的导出；`@nudo:skip` 现在会出现在
产物里（它只跳过 case 见证，不跳过投影）。

`nudo export` now refuses to publish a projection that contradicts the
contract, keeps the four product faces on one public-surface rule, and stops
dropping `@nudo:skip` functions.

- A sidecar (`*.nudo.js`) that failed to load was silently ignored: the
  contract was lost, and the artifacts published the "not declared" case as
  "no constraint" (zod `z.unknown()`) — no message on stderr, exit 0.
  `nudo export` now reports the real `nudo:interface-load` diagnostic and
  exits 1 without publishing anything.
- A contract parameter name that is not in the declared parameter list was
  projected as-is, so the zod face published an `<fn>Input` whose key the
  function signature does not have. `nudo export` now reports
  `nudo:interface-param-mismatch` and exits 1 without publishing anything.
- A contract whose conjunction is unsatisfiable (the source
  `@nudo:contract` contradicts the same-name sidecar) was projected with only
  half of the contract, producing a validator that can never pass.
  `nudo export` now reports `nudo:interface-conflict` and exits 1 without
  publishing anything.
- The dts face projected the module's **public surface** (export / export
  default / CJS exports), while the zod / Standard Schema / guard faces
  projected **every** function — internal implementations included. A module
  with no exports at all still produced three runtime validators while its
  `.d.ts` was silently missing. All four faces now share one export-surface
  rule, and a module with no public surface says so instead of producing
  nothing without a word.
- `@nudo:skip` functions were excluded from the export entry filter (they
  have no case witness by design), so they never reached any product face.
  They are now projected like any other exported function.
