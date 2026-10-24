---
"@nudojs/core": patch
---

fix(core): sum 里的**构造器成员**（fn 形状）不再被误判「确定没有此方法」

**病灶**（`packages/core/src/algebra/exec/class/invoke.ts` · `memberLikelyHasMethod`）：
union 派发面按「成员大概有这个方法吗」过滤 sum 成员，旧判据只有
prim / brand / obj / arr / tuple / eff 分支 —— **fn 落尾部 `return false`**
⇒ sum 里的 fn 成员一律被判「确定没有此方法」⇒ 被跳过 ⇒ 合并 fn 全局的
**静态成员调用**（`Response.json(x)`）折 `unknown`。

触发面：多个 `@nudo:env` 名合并成**并集**后，同名全局（如 `Response`）是两个
构造器声明的 **sum** ⇒ `mk(x) { return Response.json(x); }` 的签名从
`Response | {…}`（单 env 时的精度）退成 `unknown`，并附一条
`nudo:unknown-inference` warning。

**修法**：给 `memberLikelyHasMethod` 补 **fn 分支** —— 判据改为「fn 的
**静态槽**（dual-facet：构造器静态成员挂在 fn 的 `shape.slots` 上）里有没有这个名」：

- 静态槽里有 ⇒ 可派发；
- 静态槽**明确不含** ⇒ 确定没有（原生读 undefined ⇒ 调用 TypeError）⇒ 记
  may-throw + 跳过该成员（该分支不贡献值）；
- fn **没有静态面模型**（`shape.slots` 缺席）⇒ 判据不足 ⇒ **保守放行**
  （不可判不可抛：宁可多派发一次，不可凭空造 may-throw ⇒ 假红）。

「没有 slots」与「slots 为空对象」的区别已写进代码注释：`slots === undefined`
= 没有静态面模型（判据不足）；`slots` 存在但为空 = 静态面模型为**空**（表外名
确定缺席）。另：`Function.prototype` / `Object.prototype` 名（`toString` /
`call` / `bind` …）沿函数对象恒可得 ⇒ 不得判缺席。

**影响面**：prim / brand / obj / arr / tuple / eff 的既有 union 派发行为**逐字不变**
（判据分支只新增 fn 一支）；新增的 may-throw 只在「sum 成员是 fn 且其静态面
模型明确不含该名」时出现（原生该分支确实抛 TypeError）。
