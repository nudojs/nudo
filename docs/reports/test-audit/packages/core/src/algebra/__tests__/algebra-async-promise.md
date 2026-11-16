# packages/core/src/algebra/__tests__/algebra-async-promise.test.ts

模块套件：core algebra 面。

审计：272 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
thenable 的兑现值进 promise 的值域（原生 5，引擎改前 { then: (r) => ? }）；非 thenable 对照：回调返回普通值 ⇒ 逐字不变（promise<7>）；非 thenable 对照：回调返回普通对象 ⇒ 逐字不变（promise<{ a: 1 }>）；负控：then 不是函数 ⇒ 按普通值兑现（原生同款，promise<{ then: 1 }>）；负控：then 调过但没 settle ⇒ 永挂（unsettled，不猜）；负控：th	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
catch 臂的回调返回值是 thenable ⇒ 同款采纳（原生 5）；非 thenable 对照：catch 回调返回普通值 ⇒ 逐字不变（promise<7>）；负控：catch 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）；负控：catch 回调返回的 thenable 调 reject ⇒ rejected 通道记录该 reason	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
finally 臂的回调返回值是 thenable ⇒ 同款采纳（原生：兑现值丢弃，保留原值 1）；非 thenable 对照：finally 回调返回普通值 ⇒ 逐字不变（promise<1>）；负控：finally 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）；负控：finally 回调返回的 thenable 调 reject ⇒ 结果被拒（reason 替换原 reason）；finally 臂的拒绝通道透传 + thenable 调	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
await then 臂的 thenable 兑现值（原生 6）；await catch 臂的 thenable 兑现值（原生 6）；await finally 臂的 thenable ⇒ 原生保留原值（2）；await 拒绝通道：then 臂的 thenable 调 reject ⇒ await 抛该 reason；await 非 thenable 不受影响（原生 8）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
thenable 的兑现值进 promise 的值域（原生 1，引擎改前 { then: (r) => ? }）；负控制：非 thenable 的值不被采纳（Promise.resolve(1) → promise<1>）；负控制：非 thenable 的对象照旧（Promise.resolve({a:1}) → promise<{ a: 1 }>）；负控制：promise 实参仍走 promise 通道（Promise.resolve(Promise.resolve(1))	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
执行器 resolve 采到 thenable ⇒ 兑现值进 promise 的值域（原生 1）；执行器 resolve 采到非 thenable ⇒ 照旧（promise<{ a: 1 }>）；执行器 resolve 采到 thenable 且 then 调 reject ⇒ 拒绝通道带 reason	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
await thenable 仍交付 settle 值（原生 6，机制同款）；await promise 面采纳后的兑现值（await Promise.resolve(thenable) → 1）；await 非 thenable 不受影响（await 5 → 5）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
next() 返回 promise（typeof next().then === function）；next() 的结果是 Promise 实例；装 @@asyncIterator 自返方法；Object.prototype.toString 折 [object AsyncGenerator]；同步迭代面缺席（原生无 @@iterator）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
async *m(){}：next() 返回 promise；async *m(){}：装 @@asyncIterator；async *m(){}：tag 折 [object AsyncGenerator]	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
next() 仍是裸函数（非 promise）；同步 generator 仍有 @@iterator；同步 generator 的 next() 不是 promise	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
async generator（函数表达式面）：for-await 累加精确 3（原生 1+2=3）；async generator：三个 yield 累加精确 6（原生 1+2+3=6）；async generator：单个 yield 精确 7；async generator：字符串元素逐项拼接精确 "ab"（原生 "ab"）；async generator：空生成器 → 0 次迭代，精确 0（原生 0）；class async *m(){}：for-await 累加精确	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
同步 generator 的 for-await（同步迭代器回退）仍是精确 3；数组的 for-await（同步回退）仍是精确 3；同步 generator 的 for-of（同步迭代面）仍是精确 3；普通 async 函数（非 generator）不受影响；非生成器的仅异步可迭代对象：元素域仍折 unknown（不得臆造元素）；async generator 的 next() 仍返 promise（Bug 141 主修复面不回归）；同步 generator 的 next()	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
嵌套声明：next() 返回 promise（typeof next().then === function）；嵌套声明：next() 的结果是 Promise 实例；嵌套声明：装 @@asyncIterator 自返方法；嵌套声明：Object.prototype.toString 折 [object AsyncGenerator]；嵌套声明：同步迭代面缺席（原生无 @@iterator）；模块级声明：next() 返回 promise；模块级声明：装 @@asyncIte	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
同步 generator 声明：next() 不是 promise；同步 generator 声明：仍有 @@iterator；同步 generator 声明：next() 仍是裸函数（无 then）；async 函数（非 generator）声明：仍返回 promise	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
static async 方法返回 promise（typeof → object）；static async 方法的返回是 Promise 实例；体内 throw 不同步抛到调用点（此前同步抛）；负控制：实例 async 方法仍返回 promise；负控制：静态同步方法仍返回原始值；负控制：静态同步方法的 throw 仍同步抛	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
原生：f() 返回后 await 之前的写可见、之后的写不可见（n = 0）；原生：await 之后的副作用不进调用方的同步窗口（log = "a"）；原生：for-await 体的 await 之后的效果同样延后；原生：async 函数返回 pending promise（Promise { 0 } ⇒ promise<0>）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
await 之前的写保留（原生 1，引擎改前 11）；调用点自身的同步语句不被 async 续体插队（原生 "1,3,4"）；await 之后的写对 typeof 观察不可见（原生 "undefined"）；箭头 async 体同样挂起（原生 "a,c"，引擎改前 "a,b,c"）；pending promise 不被穿行（原生 "a"，引擎改前 "a,b"）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
const x = await f()：同步段拿不到被等待值；return await g()：调用点先返回；h(await x)：实参位置同样挂起；x + await y：二元表达式位置同样挂起；const {a} = await f()：解构位置同样挂起；await 前的表达式照常求值（原生 3）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
await 后的返回值进 promise 的 inner；await 链的值域逐跳传递；负控制：已 settle 的 promise 的 await 取值仍精确（await Promise.resolve(1) → 1）；负控制：async 函数仍返回 promise 形态（值域不被截断成 unknown）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
c1 构造点：n = 0（步骤 3：体在消费点跑，构造点 native 0 精确）；c2 构造点：log = "" | "ab"（native "" ∈ join；改前 wrong-exact "ab"）；c3 it.next() 后：n = 1（步骤 4 挂起点回放；native 1，步骤 3 为 0 | 5）；c4 it.next() 后：log = "a"（步骤 4 挂起点回放；native "a"，步骤 3 为 "" | "ab"）；步骤 4 · 连续两次 next(	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
双臂 promise：try 臂与 catch 臂都可达（并集）；负控制：确定拒绝的 promise —— catch 臂取值不变（"c:k"）；负控制：确定 fulfilled 的 promise —— 只有 fulfilled 臂	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
thenable 的 res 值被交付（原生 number，引擎改前 object）；thenable 的 res 值可以是字符串；负控制：非 thenable 的普通值不被采纳（await 5 → 5）；负控制：promise 仍走 promise 通道（await Promise.resolve(1) → 1）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
.return(v) 转发给委托迭代器（委托的清理副作用不再丢失）；负控制：非委托挂起点的 .return(v) 不转发（无委托 → 无副作用）；负控制：普通生成器的 .return(v) 语义不变（{value: v, done: true}）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
Object.keys(g) → ""（改前："0,next,return,throw,constructor,@@iterator"）；Object.getOwnPropertyNames(g) → ""；for-in 累积 → ""；hasOwnProperty("next") → false（协议方法在原型上，不在自有面）；负控制：协议面仍可用（typeof gi.next → "function"，gi.next().value → 1）；负控制："next" in	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
签名面不发布协议方法槽（无 next/return/throw/constructor/@@iterator）；签名面保留数字下标元素域（yield* s → "0": string）——族 01 口径不被破；@@iterator 槽按符号键投影建模（"@@iterator" 槽带 symbolKey 标记）；负控制：协议面在运行面仍可用（typeof gi.next → "function"）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
恒假条款 `typeof data["@@iterator"] === "function"` 消失；协议槽条款全消失（next / return / throw / constructor）；guard 产物逐条等于期望串（改前多出 6 条协议槽条款）；guard 访问的成员键里没有 internal 协议槽键；数字下标槽（元素域）仍被发布——族 01 约定不被破；负控制：普通对象的非 internal 成员仍出现在 guard 里（guard 面没被改空）；负控制：非 i	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
改前的恒假条款在原生生成器上恒 false（问题确实存在）；改后 guard 的逐条原生求值：仅元素域条款为 false（族 01 已知残留）；负控制：普通对象的 guard 每条在原生对象上都是 true	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
协议槽不进约束产物；数字下标槽（元素域）仍被发布（族 01 约定）；负控制：普通对象的公有字段仍在约束产物里	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
私有字段槽不进 guard（改前恒假条款 `data["#C::x"] === 1` 消失）；原生 oracle：私有字段不是自有属性（恒假条款的依据）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
签名面（S18）仍不发布 internal 槽——本分片不回退；Bug 191：访问器键的 guard 仍按 getter 读域判定（不被本分片改坏）；Bug 191：访问器键的约束投影仍取 getter 读域	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
all：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）；race：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）；any：全拒 → AggregateError（原生 errors 数组 + 固定 message）；race：结算值按 PromiseResolve unwrap（元素 promise → 其值，非 promise 本身）；race：混合元素 → 兑现域非 object（	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
执行器抛错 → promise 以抛出值拒绝（catch 臂可达）；执行器抛错 → fulfilled 域 never + rejected 通道带 reason；先 settle 获胜：执行器先 resolve 后抛错 → 仍兑现（原生 first-wins）；负控制：空执行器（永不 settle）仍是 promise<unknown>（不假装 settle）；负控制：只 reject 的执行器仍是确定拒绝（Bug 36 通道）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
Promise.resolve(1)：直接命名空间调用不抛，值域是 promise<1>；Promise.resolve.call(null, 1)：this 为 nullish ⇒ TypeError；Promise.resolve.call({}, 1)：this 非构造器 ⇒ TypeError；Promise.resolve.call(Promise, 1)：this 是构造器 ⇒ 合法，值域是 promise<1>；const r = Promise.resolve	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
机制面：命名空间派发带 this → 非构造器接收者抛 TypeError；机制面：直接命名空间调用（this 缺席）合法 → 不抛；机制面：构造器接收者合法（Promise 的 Abs 面 = fn + ctor:true）；机制面：不可判接收者（any）→ 记 may-throw，不硬抛（不制造假抛）；机制面：this 为 undefined（undefAbs 形态）→ TypeError（原生 PromiseResolve 非对象）；端到端：Promise.resolv	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
rejected 元素 → reason 槽装真 reason（读 .reason.message 不抛）；fulfilled 元素 → value 槽装解包后的值（非 promise 本身）；fulfilled 元素 → status 恒 "fulfilled"（判别联合，不与 rejected 并集）；混合元素 → 逐元素投影（长度与原生一致）；负控制：非 promise 元素的既有口径不变（status 两态并集 + value/reason 双槽）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
then({}) → 透传原值（非调用 → ≡ undefined）；then([1, 2]) → 透传原值；then(null) → 透传原值（既有 nullish 口径不变）；catch({}) → 拒绝透传（非调用 handler ≡ undefined，不吞拒绝）；负控制：可调用 handler 仍真执行（映射 / 捕获）；负控制：非函数 prim handler 仍是 identity（既有口径不变）；签名面：非可调用 handler 的结果 promise 是 p	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
宿主实测：writable:true 的重定义把 [[Writable]] 翻回 true（node 原生）；引擎：普通对象 —— 重定义后描述符读出**新的** writable（原生 true）；引擎：原型对象 —— 重定义后描述符读出**新的** writable（原生 true）；引擎：重定义后写门放开（原生 o.x = 2 成功）；负控：writable:true → false 的收紧仍生效（原生 false）；负控：不可配置 + writable:false 的	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
宿主实测：Error.prototype 的自有键与 hasOwn 判定（node 原生）；引擎：gOPN(Error.prototype) 精确列出自有键（原生同款）；引擎：gOPN(TypeError.prototype) 精确（toString 是**继承**的，不入自有键）；引擎：Object.hasOwn(Error.prototype, ...) 折确定 boolean（原生 true/false）；引擎：TypeError.prototype 的 toStrin	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
宿主实测：类原型的自有键 / 可枚举键 / hasOwn（node 原生）；引擎：gOPN(类原型) 精确列出 constructor + 自有方法（原生同款）；引擎：gOPN(只有访问器的类原型) 精确列出 constructor + 访问器（原生同款）；引擎：gOPN(类原型) 按**定义序**列出 constructor + 自有方法（原生同款）；引擎：gOPN(子类原型) 不列**继承**的祖先成员（原生同款）；引擎：Object.keys(类原型) 折精确空元组（原	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
宿主实测：%GeneratorPrototype% 的协议面**真实存在**（node 原生）；引擎：g.prototype.next 可读（typeof "function"，原生同款）；引擎：g.prototype.return / throw 可读（原生同款）；引擎：借用调用 g.prototype.next.call(it) 推进生成器（原生 {value:1,done:false}）；引擎：无接收者调用 g.prototype.next() 原生定抛 TypeErr	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
宿主实测：Buffer 实例的 length 真实存在（node 原生 3）；引擎：任意 brand 的 "length" 槽可读（Buffer 同形 brand → number）；引擎：brand 的 "length" 槽与成员读面同口径（$get 同槽）；负控：无 length 槽的 brand 仍折 unknown（逐字不变）；负控：对象字面量 / 字符串 / 数组的 length 逐字不变（原生 7 / 3 / 3）	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
await Promise.all([inner(), inner()])（inner 2 个 await）= 4（原生 4）；check 面签名：promise<4>（原生 4；修前是 promise<number | string>）；组合子自身：返回值即 [2, 2]（原生 [2, 2]；修前是占位符 unknown）；兑现序：组合子在**两个元素都 settle 之后**才兑现（原生 "a,a,b,b,all"）；混合元素（pending + 已 settle）= 7	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
then 在 pending 接收者上：回调读到终值（原生 3；修前 promise<number | string>）；then 在 pending 接收者上：await 面读到终值（原生 3）；check 面签名：promise<3>（原生 3；修前 promise<number | string>）；then 在 pending 接收者上：拒绝 ⇒ onRejected 臂可达（原生 "rej:boom"）；catch 在 pending 接收者上：catch 臂可达（	algebra-async-promise 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
thenable 的兑现值进 promise 的值域（原生 5，引擎改前 { then: (r) => ? }）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
非 thenable 对照：回调返回普通值 ⇒ 逐字不变（promise<7>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
非 thenable 对照：回调返回普通对象 ⇒ 逐字不变（promise<{ a: 1 }>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：then 不是函数 ⇒ 按普通值兑现（原生同款，promise<{ then: 1 }>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：then 调过但没 settle ⇒ 永挂（unsettled，不猜）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：then 调 reject ⇒ rejected 通道记录该 reason	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 体抛错 ⇒ 结果被拒（reason = 抛出的值）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
first-wins：then 先 res 后 rej ⇒ 只认第一次 settle（原生兑现 5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
递归采纳：兑现值仍是 thenable ⇒ 再采纳一层（原生 7）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
回调返回 promise ⇒ 既有口径不变（promise<5>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
catch 臂的回调返回值是 thenable ⇒ 同款采纳（原生 5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
非 thenable 对照：catch 回调返回普通值 ⇒ 逐字不变（promise<7>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：catch 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：catch 回调返回的 thenable 调 reject ⇒ rejected 通道记录该 reason	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
finally 臂的回调返回值是 thenable ⇒ 同款采纳（原生：兑现值丢弃，保留原值 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
非 thenable 对照：finally 回调返回普通值 ⇒ 逐字不变（promise<1>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：finally 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：finally 回调返回的 thenable 调 reject ⇒ 结果被拒（reason 替换原 reason）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
finally 臂的拒绝通道透传 + thenable 调 reject ⇒ reason 替换（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await then 臂的 thenable 兑现值（原生 6）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await catch 臂的 thenable 兑现值（原生 6）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await finally 臂的 thenable ⇒ 原生保留原值（2）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 拒绝通道：then 臂的 thenable 调 reject ⇒ await 抛该 reason	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 非 thenable 不受影响（原生 8）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
thenable 的兑现值进 promise 的值域（原生 1，引擎改前 { then: (r) => ? }）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非 thenable 的值不被采纳（Promise.resolve(1) → promise<1>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非 thenable 的对象照旧（Promise.resolve({a:1}) → promise<{ a: 1 }>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：promise 实参仍走 promise 通道（Promise.resolve(Promise.resolve(1)) → promise<1>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：then **不是函数** ⇒ 不当作 thenable（按普通值兑现）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
reject 通道：thenable 的 then 调 reject ⇒ 拒绝 reason 落 rejected 通道	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
reject 通道：await 该 promise ⇒ 抛 reason（catch 臂可达）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 体抛错 ⇒ promise 被拒绝（reason = 抛出的值）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 不 settle ⇒ promise 永挂（值域 unknown，unsettled）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
first-wins：then 先 res 后 rej ⇒ 只认第一次 settle（原生兑现 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
first-wins：then 先 rej 后 res ⇒ 拒绝（原生 reason = boom）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
settle 之后的抛错被忽略（原生：thenable job 的抛错不改已定的兑现）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
执行器 resolve 采到 thenable ⇒ 兑现值进 promise 的值域（原生 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
执行器 resolve 采到非 thenable ⇒ 照旧（promise<{ a: 1 }>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
执行器 resolve 采到 thenable 且 then 调 reject ⇒ 拒绝通道带 reason	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await thenable 仍交付 settle 值（原生 6，机制同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await promise 面采纳后的兑现值（await Promise.resolve(thenable) → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 非 thenable 不受影响（await 5 → 5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
next() 返回 promise（typeof next().then === function）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
next() 的结果是 Promise 实例	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
装 @@asyncIterator 自返方法	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Object.prototype.toString 折 [object AsyncGenerator]	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步迭代面缺席（原生无 @@iterator）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async *m(){}：next() 返回 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async *m(){}：装 @@asyncIterator	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async *m(){}：tag 折 [object AsyncGenerator]	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
next() 仍是裸函数（非 promise）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 仍有 @@iterator	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 的 next() 不是 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator（函数表达式面）：for-await 累加精确 3（原生 1+2=3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator：三个 yield 累加精确 6（原生 1+2+3=6）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator：单个 yield 精确 7	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator：字符串元素逐项拼接精确 "ab"（原生 "ab"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator：空生成器 → 0 次迭代，精确 0（原生 0）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
class async *m(){}：for-await 累加精确 3（原生 1+2=3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
元素域不是 unknown（不得退成 number | unknown）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 的 for-await（同步迭代器回退）仍是精确 3	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
数组的 for-await（同步回退）仍是精确 3	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 的 for-of（同步迭代面）仍是精确 3	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
普通 async 函数（非 generator）不受影响	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
非生成器的仅异步可迭代对象：元素域仍折 unknown（不得臆造元素）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async generator 的 next() 仍返 promise（Bug 141 主修复面不回归）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 的 next() 仍返裸 iterResult（非 promise）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
嵌套声明：next() 返回 promise（typeof next().then === function）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
嵌套声明：next() 的结果是 Promise 实例	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
嵌套声明：装 @@asyncIterator 自返方法	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
嵌套声明：Object.prototype.toString 折 [object AsyncGenerator]	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
嵌套声明：同步迭代面缺席（原生无 @@iterator）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
模块级声明：next() 返回 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
模块级声明：装 @@asyncIterator + tag 折 [object AsyncGenerator]	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 声明：next() 不是 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 声明：仍有 @@iterator	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
同步 generator 声明：next() 仍是裸函数（无 then）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
async 函数（非 generator）声明：仍返回 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
static async 方法返回 promise（typeof → object）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
static async 方法的返回是 Promise 实例	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
体内 throw 不同步抛到调用点（此前同步抛）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：实例 async 方法仍返回 promise	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：静态同步方法仍返回原始值	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：静态同步方法的 throw 仍同步抛	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
原生：f() 返回后 await 之前的写可见、之后的写不可见（n = 0）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
原生：await 之后的副作用不进调用方的同步窗口（log = "a"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
原生：for-await 体的 await 之后的效果同样延后	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
原生：async 函数返回 pending promise（Promise { 0 } ⇒ promise<0>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 之前的写保留（原生 1，引擎改前 11）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
调用点自身的同步语句不被 async 续体插队（原生 "1,3,4"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 之后的写对 typeof 观察不可见（原生 "undefined"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
箭头 async 体同样挂起（原生 "a,c"，引擎改前 "a,b,c"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
pending promise 不被穿行（原生 "a"，引擎改前 "a,b"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
const x = await f()：同步段拿不到被等待值	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
return await g()：调用点先返回	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
h(await x)：实参位置同样挂起	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
x + await y：二元表达式位置同样挂起	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
const {a} = await f()：解构位置同样挂起	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 前的表达式照常求值（原生 3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 后的返回值进 promise 的 inner	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await 链的值域逐跳传递	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：已 settle 的 promise 的 await 取值仍精确（await Promise.resolve(1) → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：async 函数仍返回 promise 形态（值域不被截断成 unknown）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
c1 构造点：n = 0（步骤 3：体在消费点跑，构造点 native 0 精确）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
c2 构造点：log = "" | "ab"（native "" ∈ join；改前 wrong-exact "ab"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
c3 it.next() 后：n = 1（步骤 4 挂起点回放；native 1，步骤 3 为 0 | 5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
c4 it.next() 后：log = "a"（步骤 4 挂起点回放；native "a"，步骤 3 为 "" | "ab"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
步骤 4 · 连续两次 next() 单调推进到第二个挂起点（native 5 / "ab"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
步骤 4 · 分段读取：两个挂起点各自的绑定值分别精确（native 1:5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
四种 $gen 发射点同编：函数表达式 / 对象方法 / 类方法 / async 生成器（各 n = 0）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
eager 值域承重不回归：体写外层绑定的生成器，元素面仍 exact（元素域来自 yield 收集，与外层 join 无关）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
容器 mutator 接收者同样入快照集：arr.length 折成长度域（native 构造点 0 ∈ 域；改前 wrong-exact 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
const 别名组一起快照：const a = {...}; const b = a; 经 a 写后 b.v = 0（步骤 3 构造点精确）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：协议面与 yield 序列（族 01 eager 收集口径）不变	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：解构 lowering 取到元素（const [a] = g() → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：不写外层绑定的生成器体产物逐字不变（值面 1:2 精确）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：体内 var / 形参写是生成器局部，不入快照集（值面不折 join）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
双臂 promise：try 臂与 catch 臂都可达（并集）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：确定拒绝的 promise —— catch 臂取值不变（"c:k"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：确定 fulfilled 的 promise —— 只有 fulfilled 臂	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
thenable 的 res 值被交付（原生 number，引擎改前 object）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
thenable 的 res 值可以是字符串	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非 thenable 的普通值不被采纳（await 5 → 5）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：promise 仍走 promise 通道（await Promise.resolve(1) → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
.return(v) 转发给委托迭代器（委托的清理副作用不再丢失）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非委托挂起点的 .return(v) 不转发（无委托 → 无副作用）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：普通生成器的 .return(v) 语义不变（{value: v, done: true}）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Object.keys(g) → ""（改前："0,next,return,throw,constructor,@@iterator"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Object.getOwnPropertyNames(g) → ""	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
for-in 累积 → ""	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
hasOwnProperty("next") → false（协议方法在原型上，不在自有面）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：协议面仍可用（typeof gi.next → "function"，gi.next().value → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制："next" in gi → true（原型链命中，与原生一致）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：解构 lowering 仍按序取到元素（const [a] = gi → 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
签名面不发布协议方法槽（无 next/return/throw/constructor/@@iterator）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
签名面保留数字下标元素域（yield* s → "0": string）——族 01 口径不被破	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
@@iterator 槽按符号键投影建模（"@@iterator" 槽带 symbolKey 标记）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：协议面在运行面仍可用（typeof gi.next → "function"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
恒假条款 `typeof data["@@iterator"] === "function"` 消失	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
协议槽条款全消失（next / return / throw / constructor）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
guard 产物逐条等于期望串（改前多出 6 条协议槽条款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
guard 访问的成员键里没有 internal 协议槽键	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
数字下标槽（元素域）仍被发布——族 01 约定不被破	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：普通对象的非 internal 成员仍出现在 guard 里（guard 面没被改空）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非 internal 成员仍被 guard 访问（不是被剔除成空）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
改前的恒假条款在原生生成器上恒 false（问题确实存在）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
改后 guard 的逐条原生求值：仅元素域条款为 false（族 01 已知残留）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：普通对象的 guard 每条在原生对象上都是 true	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
协议槽不进约束产物	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
数字下标槽（元素域）仍被发布（族 01 约定）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：普通对象的公有字段仍在约束产物里	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
私有字段槽不进 guard（改前恒假条款 `data["#C::x"] === 1` 消失）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
原生 oracle：私有字段不是自有属性（恒假条款的依据）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
签名面（S18）仍不发布 internal 槽——本分片不回退	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Bug 191：访问器键的 guard 仍按 getter 读域判定（不被本分片改坏）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Bug 191：访问器键的约束投影仍取 getter 读域	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
all：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any：全拒 → AggregateError（原生 errors 数组 + 固定 message）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：结算值按 PromiseResolve unwrap（元素 promise → 其值，非 promise 本身）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：混合元素 → 兑现域非 object（原生恒 number）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：无拒绝组合的投影不变（all 元素数组 / race·any 元素联合）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：单 promise 的 await 拒绝面不变（Bug 36 通道）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
漂移门：aggregateErrorAbs 槽位口径与 errorBrandAbs 同款（Bug 293 本地构造）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
执行器抛错 → promise 以抛出值拒绝（catch 臂可达）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
执行器抛错 → fulfilled 域 never + rejected 通道带 reason	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
先 settle 获胜：执行器先 resolve 后抛错 → 仍兑现（原生 first-wins）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：空执行器（永不 settle）仍是 promise<unknown>（不假装 settle）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：只 reject 的执行器仍是确定拒绝（Bug 36 通道）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.resolve(1)：直接命名空间调用不抛，值域是 promise<1>	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.resolve.call(null, 1)：this 为 nullish ⇒ TypeError	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.resolve.call({}, 1)：this 非构造器 ⇒ TypeError	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.resolve.call(Promise, 1)：this 是构造器 ⇒ 合法，值域是 promise<1>	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
const r = Promise.resolve; r(1)：this 缺席（undefined）⇒ TypeError	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.resolve.call(undefined, 1)：this 显式 undefined ⇒ TypeError	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：Math.max.call(null, 1, 2) 不抛且返回 2（this 判定只对 Promise 生效）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
全族：7 个 Promise 静态 × {null, {}, Promise} 接收者与原生逐格一致	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
机制面：命名空间派发带 this → 非构造器接收者抛 TypeError	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
机制面：直接命名空间调用（this 缺席）合法 → 不抛	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
机制面：构造器接收者合法（Promise 的 Abs 面 = fn + ctor:true）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
机制面：不可判接收者（any）→ 记 may-throw，不硬抛（不制造假抛）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
机制面：this 为 undefined（undefAbs 形态）→ TypeError（原生 PromiseResolve 非对象）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
端到端：Promise.resolve.call(null, 1)（待 member.ts 转发 this 的越界一行）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：直接调用与构造器接收者不抛（原生合法路径）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：其它命名空间静态不因 this 通道受影响（Math.max.call(null, …) 合法）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
rejected 元素 → reason 槽装真 reason（读 .reason.message 不抛）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
fulfilled 元素 → value 槽装解包后的值（非 promise 本身）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
fulfilled 元素 → status 恒 "fulfilled"（判别联合，不与 rejected 并集）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
混合元素 → 逐元素投影（长度与原生一致）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非 promise 元素的既有口径不变（status 两态并集 + value/reason 双槽）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then({}) → 透传原值（非调用 → ≡ undefined）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then([1, 2]) → 透传原值	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then(null) → 透传原值（既有 nullish 口径不变）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
catch({}) → 拒绝透传（非调用 handler ≡ undefined，不吞拒绝）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：可调用 handler 仍真执行（映射 / 捕获）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非函数 prim handler 仍是 identity（既有口径不变）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
签名面：非可调用 handler 的结果 promise 是 promise<1>（非 promise<never>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
宿主实测：writable:true 的重定义把 [[Writable]] 翻回 true（node 原生）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：普通对象 —— 重定义后描述符读出**新的** writable（原生 true）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：原型对象 —— 重定义后描述符读出**新的** writable（原生 true）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：重定义后写门放开（原生 o.x = 2 成功）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：writable:true → false 的收紧仍生效（原生 false）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：不可配置 + writable:false 的属性改 writable:true 原生定抛 TypeError（引擎同抛）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：不可配置属性上的同值重定义仍合法（原生 1）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
宿主实测：Error.prototype 的自有键与 hasOwn 判定（node 原生）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(Error.prototype) 精确列出自有键（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(TypeError.prototype) 精确（toString 是**继承**的，不入自有键）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：Object.hasOwn(Error.prototype, ...) 折确定 boolean（原生 true/false）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：TypeError.prototype 的 toString 是继承的 ⇒ hasOwn 折 false（原生 false）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：Object.keys(Error.prototype) 折精确空元组（原生 []——自有成员全不可枚举）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余已收口：内建原型的 gOPN 与宿主对拍（不再保守 string[]）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余已收口：Object.prototype 的 hasOwn 折确定值（不再保守 boolean）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
宿主实测：类原型的自有键 / 可枚举键 / hasOwn（node 原生）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(类原型) 精确列出 constructor + 自有方法（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(只有访问器的类原型) 精确列出 constructor + 访问器（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(类原型) 按**定义序**列出 constructor + 自有方法（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：gOPN(子类原型) 不列**继承**的祖先成员（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：Object.keys(类原型) 折精确空元组（原生 []——类成员全不可枚举）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：Object.hasOwn(类原型, ...) 折确定 boolean（原生 true/false）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余：方法与访问器交错定义序已复原（宿主对拍，不再是保守域）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余：定义序反转（访问器在前）仍按源码序，不是「先方法后访问器」	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余：多成员交错；静态 / 私有方法不进原型自有键	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
A10 残余：字符串计算键经 rekey 换真名且保持源码序	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
宿主实测：%GeneratorPrototype% 的协议面**真实存在**（node 原生）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：g.prototype.next 可读（typeof "function"，原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：g.prototype.return / throw 可读（原生同款）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：借用调用 g.prototype.next.call(it) 推进生成器（原生 {value:1,done:false}）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：无接收者调用 g.prototype.next() 原生定抛 TypeError（引擎同抛）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：生成器实例自身的 next 面逐字不变（typeof "function"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：协议方法不是原型对象的自有键 —— gOPN(g.prototype) 精确空元组（原生 []）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：协议槽是 internal ⇒ 原型对象上 hasOwn("next") 折 false（原生 false）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
宿主实测：Buffer 实例的 length 真实存在（node 原生 3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：任意 brand 的 "length" 槽可读（Buffer 同形 brand → number）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
引擎：brand 的 "length" 槽与成员读面同口径（$get 同槽）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：无 length 槽的 brand 仍折 unknown（逐字不变）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控：对象字面量 / 字符串 / 数组的 length 逐字不变（原生 7 / 3 / 3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
await Promise.all([inner(), inner()])（inner 2 个 await）= 4（原生 4）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
check 面签名：promise<4>（原生 4；修前是 promise<number | string>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
组合子自身：返回值即 [2, 2]（原生 [2, 2]；修前是占位符 unknown）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
兑现序：组合子在**两个元素都 settle 之后**才兑现（原生 "a,a,b,b,all"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
混合元素（pending + 已 settle）= 7（原生 7）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
元素拒绝 ⇒ 组合子拒绝（catch 臂可达：原生 "caught:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
元素拒绝 ⇒ 组合子的 promise 面确定拒绝（fulfilled 域 never + reason 通道）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
一个元素拒绝 ⇒ 组合子拒绝（原生 "caught:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：inner 无 await 时行为不变（原生 4）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：inner 1 个 await 时行为不变（原生 4）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：元素全部已 settle 时走快路径（金标零漂移：promise<[1, 2]>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：非可迭代输入不同步抛（原生折 rejection：promise<unknown>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 在 pending 接收者上：回调读到终值（原生 3；修前 promise<number | string>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 在 pending 接收者上：await 面读到终值（原生 3）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
check 面签名：promise<3>（原生 3；修前 promise<number | string>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
then 在 pending 接收者上：拒绝 ⇒ onRejected 臂可达（原生 "rej:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
catch 在 pending 接收者上：catch 臂可达（原生 "caught:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.all(...).then(cb)：回调读到聚合终值（原生 4；修前 promise<number | string>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
Promise.all(...).then(cb)：await 面读到终值（原生 4）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
兑现序：then 回调在 all 兑现之后（原生 "a,a,b,b,then:2,after"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：已 settle 接收者的反应面产物逐字不变（promise<2> / promise<43>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：已 settle 的元素先赢（原生 9；修前 promise<unknown | 9>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：await 面读到赢家终值（原生 9）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race：pending 元素后 settle 不改写赢家（原生 9）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any：首个 fulfilled 赢（原生 9；修前 promise<unknown | 9>）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any：await 面读到赢家终值（原生 9）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any：全拒 ⇒ AggregateError（原生 AggregateError:All promises were rejected）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any：pending 元素 fulfill 赢（原生 2）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
allSettled：等全部 settle，逐项记 fulfilled（原生 "fulfilled:2,fulfilled:9"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
allSettled：逐项记 rejected（原生 "rejected:boom,fulfilled:9"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
负控制：race/any/allSettled 快路径产物逐字不变	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
组合子拒绝 ⇒ then 的 onRejected 臂可达（原生 "rej:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
组合子拒绝 ⇒ catch 臂可达（原生 "caught:boom"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
race 拒绝 ⇒ then 的 onRejected 臂可达（原生 "rej:r"）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
any 全拒 ⇒ then 的 onRejected 臂拿到 AggregateError（原生同名）	dup:algebra-async-promise 聚合矩阵	commit:e7d05f2e
```
