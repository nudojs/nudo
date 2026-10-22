---
"nudojs": patch
---

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
