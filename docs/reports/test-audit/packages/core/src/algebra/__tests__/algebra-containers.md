# packages/core/src/algebra/__tests__/algebra-containers.test.ts

模块套件：数组/Map/Set/迭代器/HOF 运行时面。

审计：185 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
顶层形参（对照组）topLevel([1]) ⇒ 报 length(xs) ≥ 2；shape 槽位 nested({ list: [1] }) ⇒ 报 length(s.list) ≥ 2（改前零诊断）；数组元素位 [[1]]（array(array(...).min(2))）⇒ 报违例	algebra-containers 聚合矩阵	没测该层	keep	keep	—
"负控制：%s 收到满足长度界的 %s ⇒ 零违例"	表驱动用例：负控制：%s 收到满足长度界的 %s ⇒ 零违例；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"负控制：非 nullish 接收者仍不抛（join / sort / concat）"	"回归：`Array.prototype.sort / reverse / fill / copyWithin / concat` 借用给 **nullish 接收者**必须记抛（ES2023 RequireObjectCoercible(this)）。 `$lit(null/undefined)` 的 shape.k 是 \"unknown\" 而非 \"prim\"，此前绕过 prim 守卫 ⇒ sort 一族原样返回 nullish、concat 包成 [null]（假绿 + 错值）。 断言：expect(isNever(r.result), body).toBe(false);"	旧断言钉错	keep	keep	—
f([5]) 合法 ⇒ 零违例（改前报 missing field x）；f([-1]) 违例 ⇒ 报 x > 0，actual 是元素值 -1（不是整只数组）；不再出现 missing field x 文案	algebra-containers 聚合矩阵	没测该层	keep	keep	—
返回 [] ⊭ array(number()).min(1) ⇒ error（此前零诊断假绿）；返回 [1] ⊭ array(number()).min(2) ⇒ error；返回 [1, 2] ⊭ array(number()).max(1) ⇒ error；返回 [1, 2] ⊭ array(number()).length(1) ⇒ error；不制造假红：[1] 满足 min(1) / length(1)，[] 满足 max(1)；元素域仍照旧对账（长度通道不得掩盖元	algebra-containers 聚合矩阵	没测该层	keep	keep	—
Object.setPrototypeOf(Object.prototype, null) ⇒ 不抛（native：no-throw；修前：threw）；Reflect.setPrototypeOf(Object.prototype, null) ⇒ true（native：true；修前：false）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
Object.setPrototypeOf(Object.prototype, {}) ⇒ 仍抛 TypeError（native：同款）；Reflect.setPrototypeOf(Object.prototype, {}) ⇒ 仍返 false（native：false）；Object.prototype 的原型链面不变：typeof Object.prototype.toString === "function"（native 同款）；其余内建原型照旧可改：Objec	algebra-containers 聚合矩阵	没测该层	keep	keep	—
异构数组字面量 [1,"a"] ⇒ α 不绑成 number（落 any，不窄于真实类型）；异构数组字面量 [1,"a"] ⇒ 返回类型不窄于真实类型 `(number|string)[]`；异构数组字面量（string 在前）⇒ 同样落 any（首元素不是 number 也不该被当成全域）；同型数组字面量 [1,2] ⇒ α 仍绑成 number（Bug 453 的 L2 修复不回退）；同型数组字面量 [1,2] ⇒ 元素域按 TS 侧字面量拓宽落 base prim（不是	algebra-containers 聚合矩阵	没测该层	keep	keep	—
"异构元素域用 anyAbs（不是 unknown——unknown 是推断失败，any 是未约束）"	"arr 形参（收割的 `T[]`）× tuple 实参（引擎的数组字面量）： α 绑定**只取首元素** ⇒ 异构数组 `[1,\"a\"]` 被推成 `number[]` ——比真实类型 `(number|string)[]` **更窄** ⇒ 把「不知道」升级成「知道」 ⇒ 下游按该类型执法时假绿（契约 `array(number())` 被判满足，而实参里 可能有 string）／假红（契约 `array(string())`）。 异构 ⇒ `any`（诚实的「不知道」）。 断言：expect(out.shape).toBe(anyAbs.shape);；expect(out.shape).toEqual({ k: \"any\" }"	夹具漏形态	keep	keep	—
[1,2] ⇒ number（同型 base prim，字面量拓宽）；[1,null] ⇒ number | null（nullish 只贡献可空性，不判异型）；[1,undefined] ⇒ number | undefined；[null] ⇒ null（已知类型，不是 any）；[undefined] ⇒ undefined（已知类型，不是 any）；[1,"a"] ⇒ any（异型：既有保守口径，本轮不变）；真·未知元素（unknown 形状且无已知 lit）⇒ un	algebra-containers 聚合矩阵	没测该层	keep	keep	—
修前：nullish 元素命中 `shape.k === "unknown"` 一刀切 ⇒ 域退 any；修后：同一输入不再退 any（null / number | null）；仓内口径：unknown = 推导失败，any = 无约束并集（二者不可互换）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
[null, undefined] ⇒ null | undefined（两个已知 nullish 都保留）；[1, null, null] ⇒ number | null（重复 nullish 去重）；[null, 1] ⇒ number | null（nullish 位置不影响结果）；[1, null, "a"] ⇒ any（异型优先：仍不窄化成联合）；[null, 真·未知] ⇒ unknown（真·推断失败优先于可空性）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
e4(1)（x = -5，契约 x > 0）⇒ 报违例（默认值违约不沉默）；e4() 仍然报（Bug 444 的零参补齐不回归）；默认值合规时不报（x = 5，契约 x > 0，e4(1) ⇒ 零诊断）；多个尾部位置都补齐（f(1) ⇒ b = -1、c = -2 都按默认值执法）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
数字字面量 receiver → boolean，定抛面消失；显式 undefined receiver → boolean（此前「never throws TypeError」）；null receiver 控制组结论不变 → boolean；三种非对象 receiver 均不记 may-throw（规范返回面是 false 不是异常）；非对象 receiver ⇒ 写门失败，target 不变（原生 [[Set]] 不落写）；对象 receiver 的既有语义不受影响（写	algebra-containers 聚合矩阵	没测该层	keep	keep	—
throws TypeError instead of silently iterating nothing；valid user iterators keep working	algebra-containers 聚合矩阵	没测该层	keep	keep	—
new Set(xs).size（xs: any）是 number(path)，不是 exact 0；new Set(xs).size（xs: number[]）不再是 exact 1——长度不可知；同一 Set 的 size 与 Array.from(...).length 同结论（都非 exact number）；new Set(xs).has("a") 是 partial boolean，不是 exact false；new Map(xs).size 是 number(	algebra-containers 聚合矩阵	没测该层	keep	keep	—
sort writes the sorted order back (host: 'a')；reverse writes the reversed order back (host: 'b')；fill writes the window (host: 'x')；copyWithin copies within the receiver (host: 'b' at 0)；no may-throw is recorded for array-like receivers (na	algebra-containers 聚合矩阵	没测该层	keep	keep	—
binary recursion terminates and reports recursion truncation；linear recursion keeps working (control)	algebra-containers 聚合矩阵	没测该层	keep	keep	—
forEach：体内改写元素值对后续迭代可见（原生 1,9,3）；forEach：体内截断长度 ⇒ 缺席位不再回调（原生只剩第 0 位）；forEach：体内 shift ⇒ 缺席位跳过（原生 1,3）；map / filter / reduce：同样读当前容器；for-of：元素值现读（原生 1,9,3）；for-of：长度现读——体内 shift 收缩（原生 1,3）；for-of：长度现读——体内截断（原生只剩 1）；对照：无体内变异时行为不变（原生 1,2,3）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
push：写 length + 索引槽，返回新长度；pop：删末位 + 收缩 length，返回被删元素；shift：前移 + 收缩 length，返回原首位；unshift：整体右移 + 插入，返回新长度；splice：删窗口 + 插入 items + 写回 length（原生语义）；splice 零实参：原生不删（长度与内容不变）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
push.call({length:0},5)：写回原接收者的 length 与索引槽；push.call({length:0},5)：接收者的索引槽被写入；push.call({length:0},5)：返回值是新长度；pop.call({length:1,0:9})：返回被删元素；shift.call([1,2])：返回原首位；shift.call("ab")：字符串接收者原生定抛 TypeError（只读 length）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
fill() 把整条数组填成 undefined（长度不变）；fill() 的第 0 位不再是原值 0；对照：fill(value) 语义不变	algebra-containers 聚合矩阵	没测该层	keep	keep	—
Array.isArray(/a(b)c/.exec("abc")) 折 true（值面）；JSON.stringify("abc".match(/b/)) → '["b"]'（JSON 视图）；形状级：match 结果 Abs 带 view: "array"，浅拷贝携带（身份侧表会丢）；形状级：markArrayView 不可变替换 shape（原形状不被就地改写）；数组方法派发仍工作：/a(b)c/.exec("abc").map((x) => x) → ["abc","	algebra-containers 聚合矩阵	没测该层	keep	keep	—
push.call(5, 1) = 1（原生；此前定抛 TypeError）；unshift.call(5, 1) = 1（原生）；pop.call(5) / shift.call(5) 不抛（原生 pop → undefined、shift → undefined）；字符串接收者仍定抛（push.call('ab',1) / pop.call('ab') → TypeError）；数组 / 对象接收者不受影响（push.call([1],2)=2 / push.call({	algebra-containers 聚合矩阵	没测该层	keep	keep	—
keys()：身份键先插 → 迭代在前（宿主 obj,a）；values()：值顺序同样跟插入序（宿主 first,second）；entries() / for-of 解构：条目顺序同样跟插入序；table 面：字面量键与身份键混插时按写入序投影；重写既有键不换位；delete 后再写排到末尾（宿主语义）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
concat.call('ab') = 1 个元素（原生；此前 2 个）；concat.call('ab')[0] = 'ab'（原生；此前 'a'）；concat.call(闭 obj) = 1 个元素（原生；此前 2 个）；数组接收者不受影响（concat.call([7,8]) = 2 个元素）；普通数组路径不受影响（[].concat('ab') = 1 个元素）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
sort.call({a:1}) = 接收者对象（此前折空数组）；reverse.call({a:1}) = 接收者对象；fill.call({a:1}, 0) = 接收者对象；copyWithin.call({a:1}, 0) = 接收者对象；数组接收者不受影响（sort.call([3,1,2]) 仍折排序元组）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
with.call(1, 0, 2) 定抛 RangeError（原生；此前恒不抛 ⇒ 假绿）；with.call(true, 0, 'x') 同样定抛 RangeError；负下标也越界（with.call(1, -1, 2) → RangeError；RelativeIndex 钳到 0）；字符串接收者不抛（with.call('ab', 0, 'x') 走字符元组）；数组接收者不受影响（with.call([1,2], 0, 9) = [9,2]）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
toSpliced() 零实参：原样保留（原生 1,2,3）；toSpliced(0, undefined)：skipCount 在场（undefined ⇒ 0）⇒ 原样保留；对照：toSpliced(0) skipCount 缺省 ⇒ 删到尾（原生空）；对照：toSpliced(1,1) ⇒ 删一个（原生 1,3）；对照：splice() 零实参 ⇒ 原生不删（被删数组为空）；对照：splice(0, undefined) ⇒ deleteCount 在场（0）⇒ 不删（	algebra-containers 聚合矩阵	没测该层	keep	keep	—
array() 抛 Nudo 原生诊断（点名构造器 + 给出写法）；array(undefined) 与 array() 同口径（不得静默变 lit(undefined)）；显式写法 array(lit(undefined)) 仍然合法（元素可为 undefined）；正常元素约束不受影响；产品面：合法数组实参不再被判违反（改前 3 条假红）；对照组：显式元素契约仍然执法（array(number()) 抓非数字元素）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
元素超长 ⇒ 报违例（改前 0 error 假绿）；元素合规 ⇒ 不报违例（负控制）；违例文案点名元素位（length(a[0]) ≤ 1）而不是整个数组	algebra-containers 聚合矩阵	没测该层	keep	keep	—
`a→b` 后 `b→a` ⇒ 抛 TypeError（native：TypeError: Cyclic __proto__ value）；用户 try/catch 捕到（native："threw"）；自环 `Object.setPrototypeOf(a, a)` ⇒ 抛 TypeError（native：同款）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
`Reflect.setPrototypeOf(b, a)`（a→b 已成环）⇒ false（native：false）；自环 ⇒ false（native：false）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
`Object.setPrototypeOf(a, b)` 生效（native：getPrototypeOf(a) === b）；`Reflect.setPrototypeOf(a, b)` 返 true（native：true）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
array destructured param records pattern kind array；object destructured param records pattern kind object；array pattern renders as [ x, y ] not { x, y }；object pattern still renders as { a, b }；generalize keeps array pattern signature name；	algebra-containers 聚合矩阵	没测该层	keep	keep	—
array pattern bound name resolves to the element index；array pattern contract hit carries no object-slot fieldPath；object pattern contract hit keeps the property-key addressing；whole-param contract name still resolves to the pattern index	algebra-containers 聚合矩阵	没测该层	keep	keep	—
array pattern exposes the element index of every top-level binding；array pattern has no property-key table (arrays have no slots)；object pattern keeps the property-key table and no index table；default + array pattern still records the array	algebra-containers 聚合矩阵	没测该层	keep	keep	—
1n + [] folds to string "1" (native), not never/TypeError；[] + 1n / [1] + 1n / 1n + [1,2] fold to the native join strings；bigint ⊗ array records NO may-throw (原生从不抛 ⇒ 不得进 L2 假红)；抽象 bigint 面 ⊗ 数组 / 抽象数组 ⊗ bigint ⇒ string，不折 unknown/never	algebra-containers 聚合矩阵	没测该层	keep	keep	—
number ⊗ 数组仍是 string 拼接（1 + [] = "1"，无 may-throw）；bigint ⊗ string 仍是拼接（1n + "s" = "1s"）；确定混型 bigint ⊗ number 仍硬抛 TypeError（never）；无字符串分支的算子仍抛：1n - [] / 1n * []（原生恒抛 TypeError，硬抛可被 catch 吸收）；catch 语义：1n + [] 原生不抛 ⇒ try 块正常走完（改前误进 catch）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
x & 1 / 1 - x（x: number|[]，无 bigint 参与）不记任何 may-throw；对照：1n + x（x: number|[]）记 may-throw 是 sound 的——number 成员混型原生恒抛（1n+1 THROW），arr 成员不抛（1n+[] = "1"）⇒ 并集恰为 may；对照：any/obj 成员（可 @@toPrimitive 成 Symbol/bigint）仍记 may-throw；对照：unknown 成员照记 may-t	algebra-containers 聚合矩阵	没测该层	keep	keep	—
getter 不进普查；setter 不进普查；普通方法仍进普查（对照）；getter ⇒ check 不造假的入口 may-throw（无 error）；setter ⇒ check 不造假的入口 may-throw（无 error）	algebra-containers 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
顶层形参（对照组）topLevel([1]) ⇒ 报 length(xs) ≥ 2	dup:algebra-containers 聚合矩阵	commit:54f54850
shape 槽位 nested({ list: [1] }) ⇒ 报 length(s.list) ≥ 2（改前零诊断）	dup:algebra-containers 聚合矩阵	commit:54f54850
数组元素位 [[1]]（array(array(...).min(2))）⇒ 报违例	dup:algebra-containers 聚合矩阵	commit:54f54850
f([5]) 合法 ⇒ 零违例（改前报 missing field x）	dup:algebra-containers 聚合矩阵	commit:54f54850
f([-1]) 违例 ⇒ 报 x > 0，actual 是元素值 -1（不是整只数组）	dup:algebra-containers 聚合矩阵	commit:54f54850
不再出现 missing field x 文案	dup:algebra-containers 聚合矩阵	commit:54f54850
返回 [] ⊭ array(number()).min(1) ⇒ error（此前零诊断假绿）	dup:algebra-containers 聚合矩阵	commit:54f54850
返回 [1] ⊭ array(number()).min(2) ⇒ error	dup:algebra-containers 聚合矩阵	commit:54f54850
返回 [1, 2] ⊭ array(number()).max(1) ⇒ error	dup:algebra-containers 聚合矩阵	commit:54f54850
返回 [1, 2] ⊭ array(number()).length(1) ⇒ error	dup:algebra-containers 聚合矩阵	commit:54f54850
不制造假红：[1] 满足 min(1) / length(1)，[] 满足 max(1)	dup:algebra-containers 聚合矩阵	commit:54f54850
元素域仍照旧对账（长度通道不得掩盖元素违约）	dup:algebra-containers 聚合矩阵	commit:54f54850
单元面：抽象 arr（长度事实已丢）⇒ unprovable，不得伪装 proved	dup:algebra-containers 聚合矩阵	commit:54f54850
Object.setPrototypeOf(Object.prototype, null) ⇒ 不抛（native：no-throw；修前：threw）	dup:algebra-containers 聚合矩阵	commit:54f54850
Reflect.setPrototypeOf(Object.prototype, null) ⇒ true（native：true；修前：false）	dup:algebra-containers 聚合矩阵	commit:54f54850
Object.setPrototypeOf(Object.prototype, {}) ⇒ 仍抛 TypeError（native：同款）	dup:algebra-containers 聚合矩阵	commit:54f54850
Reflect.setPrototypeOf(Object.prototype, {}) ⇒ 仍返 false（native：false）	dup:algebra-containers 聚合矩阵	commit:54f54850
Object.prototype 的原型链面不变：typeof Object.prototype.toString === "function"（native 同款）	dup:algebra-containers 聚合矩阵	commit:54f54850
其余内建原型照旧可改：Object.setPrototypeOf(Array.prototype, {}) 不抛（native：no-throw）	dup:algebra-containers 聚合矩阵	commit:54f54850
异构数组字面量 [1,"a"] ⇒ α 不绑成 number（落 any，不窄于真实类型）	dup:algebra-containers 聚合矩阵	commit:54f54850
异构数组字面量 [1,"a"] ⇒ 返回类型不窄于真实类型 `(number|string)[]`	dup:algebra-containers 聚合矩阵	commit:54f54850
异构数组字面量（string 在前）⇒ 同样落 any（首元素不是 number 也不该被当成全域）	dup:algebra-containers 聚合矩阵	commit:54f54850
同型数组字面量 [1,2] ⇒ α 仍绑成 number（Bug 453 的 L2 修复不回退）	dup:algebra-containers 聚合矩阵	commit:54f54850
同型数组字面量 [1,2] ⇒ 元素域按 TS 侧字面量拓宽落 base prim（不是 1|2 / 不是 1）	dup:algebra-containers 聚合矩阵	commit:54f54850
同型数组字面量 ["a"] ⇒ α 绑成 string	dup:algebra-containers 聚合矩阵	commit:54f54850
空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）	dup:algebra-containers 聚合矩阵	commit:54f54850
同 kind 臂不受影响：arr 形参 × arr 实参仍绑出元素类型（既有 deep-α 用例护栏）	dup:algebra-containers 聚合矩阵	commit:54f54850
异构 ⇒ α 绑成 any（绑上去而非跳过）：后续形参不得把同一个 α 绑成窄类型	dup:algebra-containers 聚合矩阵	commit:54f54850
[1,2] ⇒ number（同型 base prim，字面量拓宽）	dup:algebra-containers 聚合矩阵	commit:54f54850
[1,null] ⇒ number | null（nullish 只贡献可空性，不判异型）	dup:algebra-containers 聚合矩阵	commit:54f54850
[1,undefined] ⇒ number | undefined	dup:algebra-containers 聚合矩阵	commit:54f54850
[null] ⇒ null（已知类型，不是 any）	dup:algebra-containers 聚合矩阵	commit:54f54850
[undefined] ⇒ undefined（已知类型，不是 any）	dup:algebra-containers 聚合矩阵	commit:54f54850
[1,"a"] ⇒ any（异型：既有保守口径，本轮不变）	dup:algebra-containers 聚合矩阵	commit:54f54850
真·未知元素（unknown 形状且无已知 lit）⇒ unknown（推导失败，不是 any）	dup:algebra-containers 聚合矩阵	commit:54f54850
修前：nullish 元素命中 `shape.k === "unknown"` 一刀切 ⇒ 域退 any	dup:algebra-containers 聚合矩阵	commit:54f54850
修后：同一输入不再退 any（null / number | null）	dup:algebra-containers 聚合矩阵	commit:54f54850
仓内口径：unknown = 推导失败，any = 无约束并集（二者不可互换）	dup:algebra-containers 聚合矩阵	commit:54f54850
[null, undefined] ⇒ null | undefined（两个已知 nullish 都保留）	dup:algebra-containers 聚合矩阵	commit:54f54850
[1, null, null] ⇒ number | null（重复 nullish 去重）	dup:algebra-containers 聚合矩阵	commit:54f54850
[null, 1] ⇒ number | null（nullish 位置不影响结果）	dup:algebra-containers 聚合矩阵	commit:54f54850
[1, null, "a"] ⇒ any（异型优先：仍不窄化成联合）	dup:algebra-containers 聚合矩阵	commit:54f54850
[null, 真·未知] ⇒ unknown（真·推断失败优先于可空性）	dup:algebra-containers 聚合矩阵	commit:54f54850
e4(1)（x = -5，契约 x > 0）⇒ 报违例（默认值违约不沉默）	dup:algebra-containers 聚合矩阵	commit:54f54850
e4() 仍然报（Bug 444 的零参补齐不回归）	dup:algebra-containers 聚合矩阵	commit:54f54850
默认值合规时不报（x = 5，契约 x > 0，e4(1) ⇒ 零诊断）	dup:algebra-containers 聚合矩阵	commit:54f54850
多个尾部位置都补齐（f(1) ⇒ b = -1、c = -2 都按默认值执法）	dup:algebra-containers 聚合矩阵	commit:54f54850
数字字面量 receiver → boolean，定抛面消失	dup:algebra-containers 聚合矩阵	commit:54f54850
显式 undefined receiver → boolean（此前「never throws TypeError」）	dup:algebra-containers 聚合矩阵	commit:54f54850
null receiver 控制组结论不变 → boolean	dup:algebra-containers 聚合矩阵	commit:54f54850
三种非对象 receiver 均不记 may-throw（规范返回面是 false 不是异常）	dup:algebra-containers 聚合矩阵	commit:54f54850
非对象 receiver ⇒ 写门失败，target 不变（原生 [[Set]] 不落写）	dup:algebra-containers 聚合矩阵	commit:54f54850
对象 receiver 的既有语义不受影响（写落 receiver）	dup:algebra-containers 聚合矩阵	commit:54f54850
throws TypeError instead of silently iterating nothing	dup:algebra-containers 聚合矩阵	commit:54f54850
valid user iterators keep working	dup:algebra-containers 聚合矩阵	commit:54f54850
new Set(xs).size（xs: any）是 number(path)，不是 exact 0	dup:algebra-containers 聚合矩阵	commit:54f54850
new Set(xs).size（xs: number[]）不再是 exact 1——长度不可知	dup:algebra-containers 聚合矩阵	commit:54f54850
同一 Set 的 size 与 Array.from(...).length 同结论（都非 exact number）	dup:algebra-containers 聚合矩阵	commit:54f54850
new Set(xs).has("a") 是 partial boolean，不是 exact false	dup:algebra-containers 聚合矩阵	commit:54f54850
new Map(xs).size 是 number(path)，不是 exact 0	dup:algebra-containers 聚合矩阵	commit:54f54850
代表表的 table 面：size/has/确切长度都不折确定值	dup:algebra-containers 聚合矩阵	commit:54f54850
确切迭代源仍折 exact（tuple / nullish 空容器，无回归）	dup:algebra-containers 聚合矩阵	commit:54f54850
sort writes the sorted order back (host: 'a')	dup:algebra-containers 聚合矩阵	commit:54f54850
reverse writes the reversed order back (host: 'b')	dup:algebra-containers 聚合矩阵	commit:54f54850
fill writes the window (host: 'x')	dup:algebra-containers 聚合矩阵	commit:54f54850
copyWithin copies within the receiver (host: 'b' at 0)	dup:algebra-containers 聚合矩阵	commit:54f54850
no may-throw is recorded for array-like receivers (native never throws)	dup:algebra-containers 聚合矩阵	commit:54f54850
control: push on the same receiver kind already agreed with the host	dup:algebra-containers 聚合矩阵	commit:54f54850
sort with a comparator sorts the array-like receiver	dup:algebra-containers 聚合矩阵	commit:54f54850
binary recursion terminates and reports recursion truncation	dup:algebra-containers 聚合矩阵	commit:54f54850
linear recursion keeps working (control)	dup:algebra-containers 聚合矩阵	commit:54f54850
forEach：体内改写元素值对后续迭代可见（原生 1,9,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
forEach：体内截断长度 ⇒ 缺席位不再回调（原生只剩第 0 位）	dup:algebra-containers 聚合矩阵	commit:54f54850
forEach：体内 shift ⇒ 缺席位跳过（原生 1,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
map / filter / reduce：同样读当前容器	dup:algebra-containers 聚合矩阵	commit:54f54850
for-of：元素值现读（原生 1,9,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
for-of：长度现读——体内 shift 收缩（原生 1,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
for-of：长度现读——体内截断（原生只剩 1）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：无体内变异时行为不变（原生 1,2,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
push：写 length + 索引槽，返回新长度	dup:algebra-containers 聚合矩阵	commit:54f54850
pop：删末位 + 收缩 length，返回被删元素	dup:algebra-containers 聚合矩阵	commit:54f54850
shift：前移 + 收缩 length，返回原首位	dup:algebra-containers 聚合矩阵	commit:54f54850
unshift：整体右移 + 插入，返回新长度	dup:algebra-containers 聚合矩阵	commit:54f54850
splice：删窗口 + 插入 items + 写回 length（原生语义）	dup:algebra-containers 聚合矩阵	commit:54f54850
splice 零实参：原生不删（长度与内容不变）	dup:algebra-containers 聚合矩阵	commit:54f54850
push.call({length:0},5)：写回原接收者的 length 与索引槽	dup:algebra-containers 聚合矩阵	commit:54f54850
push.call({length:0},5)：接收者的索引槽被写入	dup:algebra-containers 聚合矩阵	commit:54f54850
push.call({length:0},5)：返回值是新长度	dup:algebra-containers 聚合矩阵	commit:54f54850
pop.call({length:1,0:9})：返回被删元素	dup:algebra-containers 聚合矩阵	commit:54f54850
shift.call([1,2])：返回原首位	dup:algebra-containers 聚合矩阵	commit:54f54850
shift.call("ab")：字符串接收者原生定抛 TypeError（只读 length）	dup:algebra-containers 聚合矩阵	commit:54f54850
fill() 把整条数组填成 undefined（长度不变）	dup:algebra-containers 聚合矩阵	commit:54f54850
fill() 的第 0 位不再是原值 0	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：fill(value) 语义不变	dup:algebra-containers 聚合矩阵	commit:54f54850
Array.isArray(/a(b)c/.exec("abc")) 折 true（值面）	dup:algebra-containers 聚合矩阵	commit:54f54850
JSON.stringify("abc".match(/b/)) → '["b"]'（JSON 视图）	dup:algebra-containers 聚合矩阵	commit:54f54850
形状级：match 结果 Abs 带 view: "array"，浅拷贝携带（身份侧表会丢）	dup:algebra-containers 聚合矩阵	commit:54f54850
形状级：markArrayView 不可变替换 shape（原形状不被就地改写）	dup:algebra-containers 聚合矩阵	commit:54f54850
数组方法派发仍工作：/a(b)c/.exec("abc").map((x) => x) → ["abc","b"]	dup:algebra-containers 聚合矩阵	commit:54f54850
join：两侧都带数组视图 ⇒ facet 传递；一侧是普通对象 ⇒ facet 丢弃	dup:algebra-containers 聚合矩阵	commit:54f54850
guard 面读 facet：数组视图要求 Array.isArray（修前 !Array.isArray ⇒ 真值被判假）	dup:algebra-containers 聚合矩阵	commit:54f54850
push.call(5, 1) = 1（原生；此前定抛 TypeError）	dup:algebra-containers 聚合矩阵	commit:54f54850
unshift.call(5, 1) = 1（原生）	dup:algebra-containers 聚合矩阵	commit:54f54850
pop.call(5) / shift.call(5) 不抛（原生 pop → undefined、shift → undefined）	dup:algebra-containers 聚合矩阵	commit:54f54850
字符串接收者仍定抛（push.call('ab',1) / pop.call('ab') → TypeError）	dup:algebra-containers 聚合矩阵	commit:54f54850
数组 / 对象接收者不受影响（push.call([1],2)=2 / push.call({},2)=1）	dup:algebra-containers 聚合矩阵	commit:54f54850
原始值接收者的读方法也落地（slice.call(5).length = 0）	dup:algebra-containers 聚合矩阵	commit:54f54850
keys()：身份键先插 → 迭代在前（宿主 obj,a）	dup:algebra-containers 聚合矩阵	commit:54f54850
values()：值顺序同样跟插入序（宿主 first,second）	dup:algebra-containers 聚合矩阵	commit:54f54850
entries() / for-of 解构：条目顺序同样跟插入序	dup:algebra-containers 聚合矩阵	commit:54f54850
table 面：字面量键与身份键混插时按写入序投影	dup:algebra-containers 聚合矩阵	commit:54f54850
重写既有键不换位；delete 后再写排到末尾（宿主语义）	dup:algebra-containers 聚合矩阵	commit:54f54850
concat.call('ab') = 1 个元素（原生；此前 2 个）	dup:algebra-containers 聚合矩阵	commit:54f54850
concat.call('ab')[0] = 'ab'（原生；此前 'a'）	dup:algebra-containers 聚合矩阵	commit:54f54850
concat.call(闭 obj) = 1 个元素（原生；此前 2 个）	dup:algebra-containers 聚合矩阵	commit:54f54850
数组接收者不受影响（concat.call([7,8]) = 2 个元素）	dup:algebra-containers 聚合矩阵	commit:54f54850
普通数组路径不受影响（[].concat('ab') = 1 个元素）	dup:algebra-containers 聚合矩阵	commit:54f54850
sort.call({a:1}) = 接收者对象（此前折空数组）	dup:algebra-containers 聚合矩阵	commit:54f54850
reverse.call({a:1}) = 接收者对象	dup:algebra-containers 聚合矩阵	commit:54f54850
fill.call({a:1}, 0) = 接收者对象	dup:algebra-containers 聚合矩阵	commit:54f54850
copyWithin.call({a:1}, 0) = 接收者对象	dup:algebra-containers 聚合矩阵	commit:54f54850
数组接收者不受影响（sort.call([3,1,2]) 仍折排序元组）	dup:algebra-containers 聚合矩阵	commit:54f54850
with.call(1, 0, 2) 定抛 RangeError（原生；此前恒不抛 ⇒ 假绿）	dup:algebra-containers 聚合矩阵	commit:54f54850
with.call(true, 0, 'x') 同样定抛 RangeError	dup:algebra-containers 聚合矩阵	commit:54f54850
负下标也越界（with.call(1, -1, 2) → RangeError；RelativeIndex 钳到 0）	dup:algebra-containers 聚合矩阵	commit:54f54850
字符串接收者不抛（with.call('ab', 0, 'x') 走字符元组）	dup:algebra-containers 聚合矩阵	commit:54f54850
数组接收者不受影响（with.call([1,2], 0, 9) = [9,2]）	dup:algebra-containers 聚合矩阵	commit:54f54850
toSpliced() 零实参：原样保留（原生 1,2,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
toSpliced(0, undefined)：skipCount 在场（undefined ⇒ 0）⇒ 原样保留	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：toSpliced(0) skipCount 缺省 ⇒ 删到尾（原生空）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：toSpliced(1,1) ⇒ 删一个（原生 1,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：splice() 零实参 ⇒ 原生不删（被删数组为空）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：splice(0, undefined) ⇒ deleteCount 在场（0）⇒ 不删（被删数组为空）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：splice(1) ⇒ deleteCount 缺省 ⇒ 删到尾（被删 2,3）	dup:algebra-containers 聚合矩阵	commit:54f54850
array() 抛 Nudo 原生诊断（点名构造器 + 给出写法）	dup:algebra-containers 聚合矩阵	commit:54f54850
array(undefined) 与 array() 同口径（不得静默变 lit(undefined)）	dup:algebra-containers 聚合矩阵	commit:54f54850
显式写法 array(lit(undefined)) 仍然合法（元素可为 undefined）	dup:algebra-containers 聚合矩阵	commit:54f54850
正常元素约束不受影响	dup:algebra-containers 聚合矩阵	commit:54f54850
产品面：合法数组实参不再被判违反（改前 3 条假红）	dup:algebra-containers 聚合矩阵	commit:54f54850
对照组：显式元素契约仍然执法（array(number()) 抓非数字元素）	dup:algebra-containers 聚合矩阵	commit:54f54850
元素超长 ⇒ 报违例（改前 0 error 假绿）	dup:algebra-containers 聚合矩阵	commit:54f54850
元素合规 ⇒ 不报违例（负控制）	dup:algebra-containers 聚合矩阵	commit:54f54850
违例文案点名元素位（length(a[0]) ≤ 1）而不是整个数组	dup:algebra-containers 聚合矩阵	commit:54f54850
`a→b` 后 `b→a` ⇒ 抛 TypeError（native：TypeError: Cyclic __proto__ value）	dup:algebra-containers 聚合矩阵	commit:54f54850
用户 try/catch 捕到（native："threw"）	dup:algebra-containers 聚合矩阵	commit:54f54850
自环 `Object.setPrototypeOf(a, a)` ⇒ 抛 TypeError（native：同款）	dup:algebra-containers 聚合矩阵	commit:54f54850
`Reflect.setPrototypeOf(b, a)`（a→b 已成环）⇒ false（native：false）	dup:algebra-containers 聚合矩阵	commit:54f54850
自环 ⇒ false（native：false）	dup:algebra-containers 聚合矩阵	commit:54f54850
`Object.setPrototypeOf(a, b)` 生效（native：getPrototypeOf(a) === b）	dup:algebra-containers 聚合矩阵	commit:54f54850
`Reflect.setPrototypeOf(a, b)` 返 true（native：true）	dup:algebra-containers 聚合矩阵	commit:54f54850
array destructured param records pattern kind array	dup:algebra-containers 聚合矩阵	commit:54f54850
object destructured param records pattern kind object	dup:algebra-containers 聚合矩阵	commit:54f54850
array pattern renders as [ x, y ] not { x, y }	dup:algebra-containers 聚合矩阵	commit:54f54850
object pattern still renders as { a, b }	dup:algebra-containers 聚合矩阵	commit:54f54850
generalize keeps array pattern signature name	dup:algebra-containers 聚合矩阵	commit:54f54850
check signature line shows the array pattern	dup:algebra-containers 聚合矩阵	commit:54f54850
array pattern bound name resolves to the element index	dup:algebra-containers 聚合矩阵	commit:54f54850
array pattern contract hit carries no object-slot fieldPath	dup:algebra-containers 聚合矩阵	commit:54f54850
object pattern contract hit keeps the property-key addressing	dup:algebra-containers 聚合矩阵	commit:54f54850
whole-param contract name still resolves to the pattern index	dup:algebra-containers 聚合矩阵	commit:54f54850
array pattern exposes the element index of every top-level binding	dup:algebra-containers 聚合矩阵	commit:54f54850
array pattern has no property-key table (arrays have no slots)	dup:algebra-containers 聚合矩阵	commit:54f54850
object pattern keeps the property-key table and no index table	dup:algebra-containers 聚合矩阵	commit:54f54850
default + array pattern still records the array kind and index	dup:algebra-containers 聚合矩阵	commit:54f54850
array destructuring still evaluates at runtime (no regression)	dup:algebra-containers 聚合矩阵	commit:54f54850
1n + [] folds to string "1" (native), not never/TypeError	dup:algebra-containers 聚合矩阵	commit:54f54850
[] + 1n / [1] + 1n / 1n + [1,2] fold to the native join strings	dup:algebra-containers 聚合矩阵	commit:54f54850
bigint ⊗ array records NO may-throw (原生从不抛 ⇒ 不得进 L2 假红)	dup:algebra-containers 聚合矩阵	commit:54f54850
抽象 bigint 面 ⊗ 数组 / 抽象数组 ⊗ bigint ⇒ string，不折 unknown/never	dup:algebra-containers 聚合矩阵	commit:54f54850
number ⊗ 数组仍是 string 拼接（1 + [] = "1"，无 may-throw）	dup:algebra-containers 聚合矩阵	commit:54f54850
bigint ⊗ string 仍是拼接（1n + "s" = "1s"）	dup:algebra-containers 聚合矩阵	commit:54f54850
确定混型 bigint ⊗ number 仍硬抛 TypeError（never）	dup:algebra-containers 聚合矩阵	commit:54f54850
无字符串分支的算子仍抛：1n - [] / 1n * []（原生恒抛 TypeError，硬抛可被 catch 吸收）	dup:algebra-containers 聚合矩阵	commit:54f54850
catch 语义：1n + [] 原生不抛 ⇒ try 块正常走完（改前误进 catch）	dup:algebra-containers 聚合矩阵	commit:54f54850
x & 1 / 1 - x（x: number|[]，无 bigint 参与）不记任何 may-throw	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：1n + x（x: number|[]）记 may-throw 是 sound 的——number 成员混型原生恒抛（1n+1 THROW），arr 成员不抛（1n+[] = "1"）⇒ 并集恰为 may	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：any/obj 成员（可 @@toPrimitive 成 Symbol/bigint）仍记 may-throw	dup:algebra-containers 聚合矩阵	commit:54f54850
对照：unknown 成员照记 may-throw（pinned 口径：unknown 令牌=真值未知，保守记；仅顶层 unknown 豁免）	dup:algebra-containers 聚合矩阵	commit:54f54850
getter 不进普查	dup:algebra-containers 聚合矩阵	commit:54f54850
setter 不进普查	dup:algebra-containers 聚合矩阵	commit:54f54850
普通方法仍进普查（对照）	dup:algebra-containers 聚合矩阵	commit:54f54850
getter ⇒ check 不造假的入口 may-throw（无 error）	dup:algebra-containers 聚合矩阵	commit:54f54850
setter ⇒ check 不造假的入口 may-throw（无 error）	dup:algebra-containers 聚合矩阵	commit:54f54850
```
