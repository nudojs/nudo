---
"@nudojs/core": patch
---

fix(core): 无界 prim 契约的域隶属可证——裸 prim partial sum 臂不再误降 unproven-return（issue #115）：

- 关系比较块（`x < y` on narrowed string 字段）保持返回 sum 不合并时，`Number(x) - Number(y)` 派生臂是 term-less partial prim number（parent sum conf=partial，`isWidenedSumArm` 按 any 派生污染臂口径整臂跳过）→ 诚实的 `return number()` 契约被误降 `nudo:unproven-return` warning（1.3.9 回归；1.3.6 该臂被 nullish 成员访问整臂丢弃故不可见）。
- 修法：`provesBarePrimDomain`——契约是无界 prim（裸 `number()`/`string()`：prim + 无显式 pred + 无 int 义务 + 无结构面）时只问域隶属；裸 prim 臂的 partial conf 丢的是界/路径证据，不丢 prim 值域 → 臂 discharged，不降整体 unprovable。
- 口径不动：带界义务（gt/le/int…）对 term-less 臂仍 unprovable；错配 prim 的 disproved FP 保护（gold `nonEmpty` 面）与 OOB marker / nullish 显式化分支不变。
