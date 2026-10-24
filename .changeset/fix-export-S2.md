---
"nudojs": minor
---

**BREAKING**: `nudo export` 的四个产物面现在共用**同一条导出面规则** ——
未导出的内部实现**不再**发布运行时守卫（guard 面），zod / standard / dts 三面
此前投影**每一个**函数（含内部实现），现在只投影**模块的公开导出面**。

谁会坏：直接 `import { is<fn>Output } from "*.nudo.guard"` 的消费方 —— 未导出
（内部实现）的函数此前**有**守卫导出，现在**没有**了 ⇒ 消费方的
`tsc --noEmit` 会红；guard 的**返回域**也改成与 zod / standard / dts 同一条
（此前 guard 用单次调用的**观测**返回，与契约域矛盾）。

怎么迁移：重新生成产物；只对**公开导出**的函数使用 guard 导出（内部实现不再有
守卫 —— 这是「一个导出一个出口域」的统一口径）。

`nudo export` now publishes one exit domain across its product faces, and a
parameter named `__proto__` no longer disappears from the zod artifact.

- The guard face (`--format guard`) took the **observed** return value of a
  single call site, so a function with a declared return contract published a
  guard that rejected every value the contract allows (`return data === 0.5;`
  for a contract of "number between 0 and 1"), while the zod face of the very
  same run published the contract domain. The guard now consumes the same
  unified return face as the zod / Standard Schema / dts faces, so one export
  gives one exit domain. A contract the implementation violates is still
  projected as the implementation actually behaves — in every face.
- The zod input object was assembled into an ordinary object, so a parameter
  named `__proto__` was swallowed by the inherited prototype setter and never
  became an own key: the artifact published `<fn>Input` without that
  parameter, while the `.d.ts` of the same run kept it. The slot table is now
  assembled without a prototype, so the parameter is no longer lost while the
  artifact is assembled (the other inherited key names are kept as well).
- The guard face now inherits the shared export-surface rule: a function that
  is not exported no longer publishes a runtime guard.
