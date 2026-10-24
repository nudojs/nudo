---
"@nudojs/env": patch
---

fix(env): env 成员表对齐宿主实测（族 35 · Bug 1044 / 1047 / 1048 / 1049）

env 的成员表是**手写**的 ⇒ 两个方向的错都会进产品面：**缺**成员 ⇒ 闭 obj 缺槽
⇒ 成员读出 **exact `undefined`**（确定的错值）⇒ 调用即「确定抛 TypeError」⇒
**L2 门禁假红**；**写错返回域** ⇒ 宿主必抛的调用被判安全 ⇒ **L2 门禁假绿**。
本批把四条从未被任何批次处理过的成员表缺陷一并对齐，并补上**宿主实测护栏**。

- **Bug 1044（node env · `Response` 静态面 · 假绿）**：`Response.json` 的返回域
  写成了 `promise<unknown>`（WHATWG Fetch / undici：静态 `Response.json`
  **同步**返回 `Response`）⇒ `.then(...)` 被判安全而宿主必抛
  （`TypeError: Response.json(...).then is not a function`）。改成 `Response`
  **实例面**（brand），读面与宿主一致（`.status` → number、`.then` → exact
  `undefined`），与 web env 的静态面同源；**实例面**的 `json`（读 body ⇒ 真
  promise）保持不动。
  *已知偏差*：`.then(...)` 这一具体形态**仍不**被 L2 门禁标出——core 的
  「确定不可调用成员」判定只覆盖**平 obj 接收者**，brand 接收者的缺槽成员
  被调用时不记抛（core 侧问题，本包改不到）。
- **Bug 1047（node env · `performance` · 假红）**：补齐宿主真实存在的 6 个成员
  —— `toJSON` / `clearResourceTimings`（Performance Level 2 标准面，web env
  早已补过 ⇒ 两 env 不对称）/ `eventLoopUtilization` / `nodeTiming` /
  `setResourceTimingBufferSize` / `timerify`（perf_hooks 面）。`nodeTiming` 按
  宿主实测建模为**对象**，`timerify` 的返回域是**可调用**面（宿主返回包装函数，
  不是 `undefined`）。
- **Bug 1048（node env · `navigator` · 假红）**：补 `locks`（Web Locks API，W3C
  标准，浏览器 + node 24+ 都有）⇒ `navigator.locks` 不再读出 exact `undefined`，
  `navigator.locks.request(...)` 不再被判「确定抛 TypeError」。
- **Bug 1049（web env · `crypto.subtle` · 假红）**：补 4 个标准 WebCrypto API
  —— `deriveKey` / `deriveBits`（Level 1）/ `wrapKey` / `unwrapKey`（Level 2）
  ⇒ node env 同一对象早已声明前两个的**两 env 自相矛盾**消失。

**两 env 同源**：node env 的 `crypto.subtle` 同步补上 `wrapKey` / `unwrapKey`，
node / web 两 env 的 `crypto.subtle` 成员集合同源；web env 的 `navigator` 同步
补上 `locks`。node env 内部把 `performance`（全局对象面 + `Performance` 实例面）、
`navigator`（全局对象面 + `Navigator` 实例面）与 `crypto.subtle`（`crypto` 全局面
+ `SubtleCrypto` 实例面）改为**共用一份槽表**，杜绝「一处补了一处没补」的漂移。

**宿主实测护栏**：新增回归钉，对 `performance` / `navigator` / `crypto.subtle` /
`Response` 各断言「**宿主实测成员名 ⊆ env 表成员名**」（真 node 子进程跑
`Object.getOwnPropertyNames` 对照 env 表），并带**负控**（宿主没有的成员仍被判
「确定缺失」）⇒ 证明没有把整张表改成全放行。
