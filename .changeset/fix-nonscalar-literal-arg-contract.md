---
"@nudojs/core": minor
---

**BREAKING**: `nudo check` 的调用点契约执法补上**非标量字面量实参**：函数 / 箭头 /
类表达式、`new Date(0)` / `new Map()` / `new Set()`、正则字面量、`Symbol(...)`、
`NaN` / `Infinity` / `-Infinity`、模板字面量、`void 0` 不再对形参契约零义务。

此前这些实参在**函数体内**的调用点被整条跳过（`parseCallArgs` 落兜底
`absUnknown()` ⇒ `hasInfo=false`），同一个实参在顶层调用却报违例 ⇒ 同一义务两套
裁决。例：

- `/** @nudo:contract x positive */ function u(x){…}` + `u(() => 1)` ⇒ 0 条（假绿）
- `u(new Date(0))` / `u(/re/)` / `u(new Map())` 对 `number()` / `string()` ⇒ 0 条
- `u(NaN)` 对 `number().gt(0)` / `u(Infinity)` 对 `number().lt(10)` ⇒ 0 条

另外 `brand` 包装（`new Date(0)` / 正则 / boxed prim）在 `typeof` 通道不拆壳 ⇒
即便实参 Abs 到了分类器（顶层执行态回退），裸 prim 契约仍零义务；而同一 `typeof`
判据在 union 面会拆 brand。现在两条通道同口径，`shape` 通道也拆 brand（`new
Date(0)` 对空 shape = 任意对象不再误报「object shape」，对带必填字段的 shape 报
missing field）。

**只报确定事实**（宁漏勿错）：函数/箭头/类恒为 function，正则 / 内建 `new` 恒为
对象，模板恒为 string，`Symbol()` 恒为 symbol，未遮蔽的 `NaN` / `Infinity` 恒为
number 字面量；`NaN` 仍是 `number`（裸 `number()` 放行），`Infinity > 0` 放行。
未知形态（任意用户构造器的 `new`——`new` 可能返回原语、动态模板、被遮蔽的内建名、
无法求值的表达式）仍落 unknown ⇒ 不猜。

谁可能坏：此前依赖「函数体里的非标量字面量实参静默」的 CI 流水线会开始非零退出。
这些调用点本来就是 L1 义务的覆盖空洞（同一份契约在顶层调用上已执法）。
