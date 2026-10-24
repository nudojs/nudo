---
"@nudojs/core": patch
---

fix(core): brand 接收者的「确定缺失」判定补齐（族 46 · Bug 1044 收口）

`definitelyUncallableMember`（evaluator `$invoke` 的成员调用终判）此前首行
`if (s.k !== "obj") return false;` ⇒ **只判平 obj 接收者** ⇒ **brand 接收者**
的缺槽成员被调用时**不记抛** ⇒ env 声明的 brand（`Response` / `Headers` /
`Blob` / `FormData` / `Request` …）上调用宿主不存在的成员，原生恒抛
`TypeError`，引擎却折 `unknown`、零诊断 ⇒ **L2 门禁假绿**。

典型形态：`Response.json(x).then(cb)` —— `Response.json` 同步返回一个
**Response 实例**（brand），其内层槽表没有 `then` ⇒ 原生
`TypeError: Response.json(...).then is not a function` ⇒ 门禁应报错，实际不报。

⇒ **同一个缺陷 env 侧表现不一致**：web env 把 `Response` 建成**平 obj** ⇒
平 obj 规则早已判「确定抛」（web 假红）；node env 建成 **brand** ⇒ 一律不判
（node 假绿）。本修法让两者口径一致。

**修法**：brand 接收者 ⇒ 取内层 shape；**内层是闭合 obj**（closed + exact
conf、无 open / index 键域）⇒ 走既有「表外 ⇒ 确定缺失」逻辑；**内层不是
闭合 obj**（`unknown` / prim / arr / open / 带 index）⇒ **维持现状**（不记抛，
域不封闭 ⇒ 只能说「可能缺失」）。

**保守边界（缺席不可证 ⇒ 一律不判）**：

- Object.prototype 名（`toString` / `valueOf` / …）——原型上恒有；
- 引擎已为该 brand 建模原型面者：内建 brand（`Date` / `Map` / `Set` /
  `Promise` / Error 家族 / `ArrayBuffer` 族 / `URL` / `URLSearchParams` /
  `TextDecoder` / `WeakRef` / `FinalizationRegistry` / typed array 族）、
  装箱 brand（`String` / `Number` / `Boolean` / `Symbol` / `BigInt`）、
  `Proxy`（陷阱可给任意成员）、`Intl.*` 子构造器、原型对象 brand
  （`X.prototype` / `X.generatorProto`）⇒ 它们的内层槽表**不是**可调用面全集；
- 注册用户类（类注册表持有原型方法面，域不同）。

**钉**：新增回归钉（`eval-bug-1044-brand-missing-member.test.ts`），覆盖
表外成员记抛 / 表内成员不记抛 / 内层 `unknown` 与 open obj **不**记抛
（soundness 护栏）/ 平 obj 既有行为逐字不变 / 内建 brand 不误判 /
L2 门禁面（`nudo:entry-may-throw`）；并带**同步守卫**——引擎两张内建 brand
原型表的键集必须 ⊆ 排除名单（新增内建 brand 时漏同步 ⇒ 守卫变红 ⇒ 防止
「漏排除 ⇒ 合法调用被误判成确定抛」的假红）。

**已知偏差（诚实记录）**：本判定把 env 声明的 brand 实例面当作该 brand 的
**完整可调用面** ⇒ 若 env 声明漏了宿主真实存在的成员（如 node 22+ 的
`Response.prototype.bytes` / `textStream` / `Blob.prototype.textStream`），
该成员会被判成「确定不存在」⇒ **假红**。此偏差与 web env（平 obj 建模）
**今天已有**的行为完全一致（web env 的 `resp.bytes()` 已判「确定抛」）
⇒ 本修法只是让 node env 与 web env 口径一致；补齐 env 侧成员表即可同时
消掉两 env 的该条假红（env 包侧，不在本包范围）。
