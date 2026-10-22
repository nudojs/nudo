---
"@nudojs/core": patch
---

fix(core): 等式蕴含序关系、字面量同一性按 SameValue、默认形参可省略、strict 端点放松只做一次

- Bug 387：`implies` 补「**等式 ⇒ 序关系 / 对称**」规则——`x === y` ⇒
  `x <= y` ∧ `x >= y`（`===` 排除 NaN ⇒ 等值必然不小于也不大于）、`x === x` ⇒
  `x <= x`；等式事实同时给出对称式 `x === y` ⇒ `y === x`（**不含** `lt` / `gt`：
  等值不蕴含严格序）。此前 `a === b` 前提消解不掉 `a <= b` 的分支可达性 ⇒
  恒假分支被算成可达（`nudo check` 签名 `f(a, any, b: any) => 1 | 2 | 3`，应为
  `1 | 3`）。
- Bug 398：`leqAbs` 的字面量同一性按注释宣称的 **SameValue**（`Object.is`）判定，
  不再按 `===`——`0 === -0` 为 true ⇒ `lit(-0)` 与 `lit(0)` 互相「满足」⇒ 精确
  期望被静默放宽（native `Object.is(0, -0) === false`）。NaN ≡ NaN 的口径不变；
  失败原因串里的 `-0` 与 `0` 现在可区分。
- Bug 399（读侧）：fn shape 新增**可选**字段 `optionalParams?: boolean[]`（与
  `params` 同下标，true = 该位可省），`leq` 据此算必选元数——默认形参
  （`f(a, b = 1)`）在形参表面只是光秃秃的名字，此前被计成必选元数 ⇒
  `nudo:assign-mismatch` 假红。`requiredFnArity` 的公开签名与既有行为一字不改
  （无标记时回退名字后缀判据）。
- Bug 1004：strict 端点的 1 ULP 离散性放松**只做一次**——同项比较时按 IEEE 格点
  读事实端点（`t > L` ⟺ `t >= nextUp(L)`；`t >= L` 不步进）⇒ `x > 0 ⇒ x + 1`
  的后置 `number().ge(1)` 不再假红（`nudo:constraint-violated`）。区间层的
  `nextDown` 放松**保留**（它是保真所需：`x>0 ∧ y>=1 ⊬ x+y>1` 依赖它才不假证）。
