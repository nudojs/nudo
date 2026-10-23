---
"nudojs": patch
---

fix(nudojs): `migrate strip` 的产物面事实回报 + 兜底闸门扩围（族 12 S2）

族 12 的六条缺陷（445 / 446 / 447 / 448 / 913 / 968）的**根因**全部在
`@nudojs/core` 的 `strip-types.ts`（已由 S1 修好）。本片只做**产物面**：

- **`migrate strip` 的 notes 跟事实**（`stripTsToJs`）：notes 现在基于
  `stripTypes` 的 `report` 事实回报，而不是「enum 被删」这一过时口径 ——
  运行时 enum 现在是**被合成**（不是被删除）⇒ note 改成「已合成运行时对象」，
  不再误报「runtime semantics lost」。另补：`export =` / `export as namespace`
  被剥除（CommonJS 出口面消失）、`this` 形参被剥除、类型专用 import 被消掉
  （tsc 同口径）、保守保留的 import（本地再导出 / 包说明符 / 未引用 ⇒ 产物
  可能链接失败）与「指令条数前后不一致」的提示。
- **兜底闸门扩围**（`migrate strip` 写盘前的「产物可解析性闸门」）：除
  `TSParameterProperty` 与 4 个类成员修饰符 flag 外，新增认得
  `export =` / `export as namespace`、类成员的 `x!` / `y?` / `m?()`、TS 的
  `this` 形参。**零误伤**：这些判据在纯 JS 源码里零命中（TS-only 节点类型 /
  TS-only 字段 / `this` 不是合法形参名）。
- **六条产物面回归钉**（`packages/nudojs/src/__tests__/cli-bug-445|446|447|
  448|913|968-migrate-strip-*.test.ts`）：产物必须 `node --check` 过、
  指令必须存活、门禁行为正确（源红 / 产物**同样红**，不再假绿）。

`migrate verify` 的语义**未改**（它的契约是「跑 `nudo check`」）；`nudojs` 的
公开导出面**零新增**。
