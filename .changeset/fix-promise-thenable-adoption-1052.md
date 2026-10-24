---
"@nudojs/core": patch
---

fix(core): `Promise.resolve(thenable)` / `new Promise(resolve => resolve(thenable))` 走 **thenable 采纳** —— promise 的值域不再是 thenable 对象本身（族 38 · Bug 1052）

原生（ES2023 `PromiseResolve` / `NewPromiseCapability` + `PromiseResolveThenableJob`）：
对**非 promise 值**，`resolve(x)` 要取 `then = Get(resolution, "then")`，
**可调用**则调 `then(resolveFn, rejectFn)`，由它决定兑现值 ⇒
`Promise.resolve({ then: (r) => r(1) })` 兑现 **`1`**（number）。

引擎此前**只认 `eff(promise)`**（`unwrapThenable` 只做「promise ⇒ inner」的单层
解包），带 `then` 成员的普通对象**原样穿过** ⇒ promise 的值域 = **thenable 对象
本身**（`promise<{ then: (r) => ? }>`）⇒ 与宿主的 `1` **互斥**（wrong-exact）
⇒ 该值域一路进 dts / zod / guard / standard 产物面（消费方看到「一个带 then 的
对象」，而运行时兑现的是 `1`）。

**根因**：`thenableRiskOf` 能识别「这个值**可能**自带 then 采纳面」，但它的
**唯一**用途是给 promise 打 `unsettled` 标记 ⇒ **风险被识别了，采纳却没做**。

**修法**（`packages/core/src/algebra/builtins/promise.ts`）：

- 新增 thenable 采纳机制 `thenableAdoption` / `adoptThenableChain`——把「风险面」
  **一分为二**：`noThen`（确定无 `then`）/ `thenNotCallable`（有 `then` 但不可
  调用 ⇒ 原生按**普通值**兑现）/ `undecidable`（any/unknown/fn/开对象 ⇒ 采纳面
  不可判 ⇒ 仍标 unsettled）/ `settled`（兑现值 / 拒绝 reason）/ `pending`（`then`
  调过但没 settle ⇒ 原生 promise 永挂）；
- 采纳入口统一走它：`Promise.resolve` 静态臂、`new Promise` 执行器 `resolve`
  采集臂、**以及 `await` 面**（`exec/runtime/async.ts` 的 `adoptThenable`
  **复用同一套**判定与调用，不另造——await 面的既有语义逐字保留）。

修后：

- `Promise.resolve({ then: (r) => r(1) })` ⇒ `promise<1>`（原生同）；
- `new Promise((resolve) => resolve({ then: (r) => r(1) }))` ⇒ `promise<1>`；
- 兑现值仍是 thenable ⇒ **递归**采纳一层（原生同款）；
- 采纳的 settle 语义 = 原生 **first-wins**（`then` 同时调 res 与 rej ⇒ 只认第一
  次；`then` 在 settle **之后**抛错 ⇒ 忽略）；
- thenable 的 `then` 调 `reject` ⇒ 拒绝 reason 落 promise 的 **rejected 通道**
  （`await` 该 promise ⇒ 抛该 reason，catch 臂可达）；`then` 体抛错 ⇒ promise
  被拒绝；
- **负控**：`Promise.resolve(1)` ⇒ `promise<1>`；`Promise.resolve({a: 1})` ⇒
  `promise<{ a: 1 }>`；**`then` 不是函数** ⇒ 不当作 thenable（原生
  `Get(then)` 不可调用 ⇒ 以该值兑现）⇒ `promise<{ then: 1 }>`（确定 fulfilled，
  不再是 unsettled）。

**口径边界（已登记）**：宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调
（`await` 面同款近似）⇒ **兑现值**同款，但 `then` 体副作用的**时序**与原生不同。

采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标 unsettled（settle
不可判，不猜）。

`await` 面此前在 `then` **同时**调 res 与 rej 时**优先取拒绝** ⇒ 现按原生
**first-wins**（先 res ⇒ 兑现）；该边界**无既有断言覆盖**（`await` 面其余语义
逐字保留，含「`then` 不可调用 ⇒ 抛 TypeError」的既有口径）。
