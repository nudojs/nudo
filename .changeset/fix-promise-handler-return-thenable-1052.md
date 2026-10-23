---
"@nudojs/core": patch
---

fix(core): `then` / `catch` / `finally` **回调返回值**的 thenable 采纳 —— 结果 promise 的值域不再是 thenable 对象本身（族 50 · Bug 1052 邻面）

原生（ES2023 `PerformPromiseThen` + `PromiseResolve` + `PromiseResolveThenableJob`）：
回调的**返回值**也要走 `PromiseResolve` ⇒ 返回值是对象且 `Get(then)` **可调用**
⇒ 调 `then(resolveFn, rejectFn)` ⇒ 结果 promise 的兑现值 = 该 settle 值
（**不是** thenable 对象本身）。
`await Promise.resolve(1).then(() => ({ then: (r) => r(5) }))` ⇒ 原生 **`5`**。

引擎此前只认 `eff(promise)`（`unwrapThenable` 只做「promise ⇒ inner」的单层解包）
⇒ 回调返回带 `then` 成员的普通对象时**原样穿过** ⇒ 结果 promise 的值域 =
**thenable 对象本身**（`promise<{ then: (r) => ? }>`）⇒ 与宿主的 `5` **互斥**
（wrong-exact）⇒ 该值域一路进 dts / zod / guard / standard 产物面。

**根因**：族 38（Bug 1052 本体）已建立**唯一**的 thenable 采纳机制
（`thenableAdoption` / `adoptThenableChain`），但只接在 `Promise.resolve` /
`new Promise` / `await` 三条通道上 ⇒ **回调返回值**这条通道漏接。

**修法**（`packages/core/src/algebra/builtins/promise.ts`）：**复用**族 38 的
`adoptThenableChain`（**不另造一套**——采纳机制唯一），在 then / catch /
finally 的**回调返回值记账点**按 `Promise.resolve` 面同款映射：
`settled`+resolved ⇒ 兑现值；`settled`+rejected ⇒ 拒绝通道（reason）；
`pending`（`then` 调过没 settle）⇒ 永挂（unsettled，不猜）；`undecidable`
（采纳面不可判）⇒ 原值 + 永挂；`noThen` / `thenNotCallable` ⇒ 普通值
（原生 `Get(then)` 不可调用 ⇒ 以该值兑现，不抛 TypeError）。

修后：

- `Promise.resolve(1).then(() => ({ then: (r) => r(5) }))` ⇒ `promise<5>`（原生同）；
- `Promise.reject("x").catch(() => ({ then: (r) => r(5) }))` ⇒ `promise<5>`；
- `Promise.resolve(1).finally(() => ({ then: (r) => r(5) }))` ⇒ `promise<1>`
  ——原生 `finally` **不改 settled value**（thenable 只作「等待」用，兑现值丢弃）；
- 回调返回的 thenable 调 `reject` ⇒ 结果被拒、reason 落 **rejected 通道**
  （`finally` 臂的 reason **替换**原 reason——原生同款）；
- 回调返回的 thenable 没 settle ⇒ 结果 promise **永挂**（标 unsettled，不猜）；
- 兑现值仍是 thenable ⇒ **递归**采纳一层（原生同款，深度上限 8 与族 38 一致）；
- **非 thenable 对照逐字不变**：`then(() => 7)` ⇒ `promise<7>`；
  `then(() => ({ a: 1 }))` ⇒ `promise<{ a: 1 }>`；`then` 不是函数 ⇒
  `promise<{ then: 1 }>`（确定 fulfilled）。

**口径边界（已登记）**：宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调
（`await` 面 / `Promise.resolve` 面同款近似）⇒ **兑现值**同款，但 `then` 体副作用的
**时序**与原生不同。采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标
unsettled（settle 不可判，不猜）——与 `Promise.resolve` 面同款。

**未改的记账点（诚实登记）**：纯 **relation** 回调（`fnImpl.relation` 且无
body/apply）的返回值是**类型层**的值（非运行时对象）⇒ 无 thenable 采纳面 ⇒
该路径保持原样，未接采纳。
