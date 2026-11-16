# packages/core/src/algebra/__tests__/algebra-eval-control.test.ts

模块套件：求值面：控制流/迭代/守卫/作用域。

审计：260 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
引擎结果 = 原生 15（修前：TDZ ReferenceError 被用户 catch 吞掉 ⇒ 0）；签名面写 15（不是 => 0）；参数版签名面与无碰撞对照逐字一致（修前：=> 0）；无假 nudo:opaque-result（修前：模块 fail-closed ⇒ unknown + 假 opaque）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
用户写 __nudoTm_0：模块不退化 unknown（结果 = 原生 8）；用户写 __nudoE_0：catch 载体不遮蔽用户绑定（结果 = 原生 8）；用户写 __nudoArgs：arguments 槽不重复声明（结果 = 原生 0）；整模块不再 fail-closed：无关导出 g 仍拿到签名（与无碰撞对照逐字一致）；无假 nudo:opaque-result（修前：整模块 unknown + 2 条假 opaque）；不退化 unknown（修前：f/g 全	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
内部临时名逐字保持原形（__nudoTm_0 / __nudoRet / __nudoArgs，无后缀改名）；同一源码转译两次 ⇒ 产物逐字相同（确定性：缓存键 / 差分语料依赖它）；撞名时改名后仍确定（同源两次转译逐字相同）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
单元素解构：值面 = 迭代序第 1 个值（原生 1，此前折确定 undefined）；多元素解构：第 1 位 = 迭代序第 1 个值；多元素解构：第 2 位 = 迭代序第 2 个值（原生 2，此前折确定 undefined）；赋值形态（[p, q] = it）同样按迭代序；形参位解构（function h([a, b]) {…} h(userIter)）同样按迭代序；用户**迭代器**对象（自带 next + @@iterator）按迭代序取值；副产物：引擎原生迭代器不被误判	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
if 臂里的 break 退出 switch（原生 ""）；if 臂里的 break 退出 switch（块形态）；if/else 形态：else 分支的 break 也退出 switch；命中第二个 case 时，if 臂里的 break 不影响 default 臂；条件 break：假分支继续贯穿（原生 "bb"）；条件 break：真分支退出 switch（原生 ""）；负控制：臂内循环的 break 退出循环（不是 switch）；负控制：臂内循环的 continue	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
循环后 var 头仍可见（typeof x === number）；循环后 var 头持有末轮值；for (var k in …) 头同样是函数级绑定；for (var k in …) 头持有末轮键；var 头共享同一绑定（闭包全部看到末轮值）；for (var k in …) 头共享同一绑定（闭包看到末轮键）；var 头在循环体内可见（逐轮读到当轮项）；var 头可再赋（var 是可写绑定）；var 头解构：子名同样是函数级绑定（末轮值）；var 头解构：子名在循环后仍可见	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
"for (var x of items) 后的 x 折出 number 臂（不再是恒 undefined）"	"- `let` / `const` 头是**块级、每轮新绑定**（per-iteration）——循环后 不可见，闭包各捕获各的轮次值。 修复前：头绑定一律实现成「回调形参」⇒ ① 形参遮蔽函数级 `var` 槽 ⇒ 循环外读 `x` 恒 `undefined`； 断言：expect(r.summary.errors).toBe(0);；expect(sigOf(r, \"f\")).toMatch(/number/);"	没测该层	keep	keep	—
for (let x of …) 循环后不可见；for (const x of …) 循环后不可见；for (let x of …) 闭包各捕获各轮（per-iteration）；for (const x of …) 闭包各捕获各轮；for (let k in …) 循环后不可见；普通 var（非头）提升语义不变	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
@nudo:as 只覆盖被登记的那条语句（同行下一条不受影响）；@nudo:as 仍覆盖被登记的那条语句（负控制）；@nudo:replace 只命中被登记的那个节点（同行同文本的兄弟节点不受影响）；@nudo:replace 仍替换被登记的那个节点（负控制：兄弟节点不被波及）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
命中第一个 case：后续 case 测试不求值（原生 1）；命中第二个 case：第一个 case 测试仍求值（原生 2）；全不命中：所有 case 测试都求值（原生 2）；命中即停：命中后的 case 测试的副作用不发生（原生 "t1,one"）；命中即停：命中后的 case 体的副作用也不发生（原生 101）；负控制：每个 case 测试只求值一次（原生 1）；负控制：抽象判别式下 case 测试全部求值（副作用不丢）；负控制：相邻形态（if/else 判别）不受影响	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
case 测试的写保留（原生 11）；case 测试的副作用日志保留（原生 "t1,one"）；未命中时前面 case 测试的副作用保留（原生 "t1,t2,two"）；抽象判别式下 case 测试的副作用同样保留（上界）；负控制：case 测试只求值一次（不重复计数，原生 1）；负控制：无 case 测试的 switch 不受影响（原生 5）；负控制：臂体的写仍以基线为起点（臂间隔离不破）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
体里的 break 跳出循环（不是跳出函数）；体里的 continue 转到条件求值（首轮后不再执行体）；条件里的 break（事实臂）同样只跳出循环；负控制：无 break/continue 的 do-while 轮数与返回值不变；负控制：嵌套 do-while 的 break 只跳出内层循环；负控制：while / for 的 break 语义不受影响	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
用户声明 _d0：模块仍可求值（不再重复声明 SyntaxError）；用户声明 _n1（嵌套解构临时名）：模块仍可求值；用户声明 _p0（形参占位名）：模块仍可求值；用户声明 _rest0（rest 形参占位名）：模块仍可求值；用户声明 _pd0（默认参解构临时名）：模块仍可求值；负控制：无撞名时解构行为不变（精确值）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
模块首条语句即解构声明 + 用户模块级 _d0：模块可求值且值正确；后续语句解构 + 用户模块级 _d0：模块可求值且值正确；模块首条语句即嵌套解构 + 用户模块级 _n1：模块可求值且值正确；模块级 fail-closed 面解除：无关函数不再被拖成 unknown；两处解构 + 用户模块级 _d0：模块可求值且值正确；产物不与用户同名绑定重复声明（临时名让开）；负控制：无撞名时临时名与行为不变；负控制：用户 _d0 在函数体内（跨作用域）不受影响；负控制：形参占位名族（_	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
早返回形态：后续路径不排除 NaN ⇒ return number().gt(0) 不成立（error）；语义等价的事实臂写法仍证得（结论一致）；尾句非全终止的早退形态（早退提升路径）同口径（error）；负控制：返回字面量的早退形态仍判违约（0 不满足 positive）；负控制：事实臂不终止的普通 if/else 同样不断言否定界（判违约的依据不是否定界）；负控制：四种关系算子的后续路径**同口径**（四种形态都在 NaN 上违约）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
for (; v !== null; ) { return v.length; } 零 L2（native 永不抛）；与 while 写法结论一致（同守卫同机制）；for 体内的 nullish 守卫对成员读生效（v.length 不撞 null 臂）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
for (; x > 0; ) { return x; } 满足 return number().gt(0)；与 if 写法结论一致（同守卫同机制）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
for (; v !== null; ) 在 v 为 null 时不进体（返回 0）；for (; v !== null; ) 在 v 为字符串时进体（返回长度）；for 主路径的循环变量不被影子参数顶掉（i 逐轮递增）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
无守卫的 for 体内读 null 臂成员仍报 L2；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L2	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
命中事实：`case 1:` 臂内判别值 = 字面量 1（返回域 1 | 2）；排除事实：`default:` 臂排除 `case null` ⇒ v.length 不判 may-throw；排除事实：`case null:` 之外的臂（`case 1:`）同样排除 null；多个 case 标签：命中事实取并集（1 | 2 | 3）；负控制：臂内写判别绑定 ⇒ 跳过窄化（影子参数会吞掉臂内写）；负控制：非字面量 case 标签不产事实（臂内判别值不被改写）；负控制：相邻形态	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
第 2 轮起体内成立 x > 0 事实 ⇒ return x 满足契约；与 while 写法结论一致（同守卫换结构结论相同）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
首轮拷贝保持未收窄（先于测试求值 ⇒ 无 > 0 事实，仍报 L1）；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1；循环体外的读不携带关系事实（仍报 L1）；do-while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
do-while 体至少执行一次（先于测试）；第 2 轮的 return 取到 x（运行时取值不变）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
while (x > 0) { return x; } 满足 return number().gt(0)；与 if 写法结论一致（同守卫换结构结论相同）；while (x >= 0) 的关系事实同样接进体内	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1；循环体外的读不携带关系事实（仍报 L1）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
while (x > 0) 在 x 为正时进体（返回 x）；while (x > 0) 在 x 为负时进不了体（返回 1）；while (v !== null) 的 nullish 收窄不改变取值	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
裸块：{ if (v === null) { return 0; } } return v.length; 零 L2；try 块：同段代码零 L2；catch 块：同段代码零 L2；finally 块：同段代码零 L2；对照组：函数体顶层同段代码零 L2（既有口径不回归）；四种嵌套形态与顶层形态签名一致	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
裸块：v 为 null → 0；v 为字符串 → 长度；try 块：v 为 null → 0；v 为字符串 → 长度；catch 块：v 为 null → 0；v 为字符串 → 长度；finally 块：v 为 null → 0；v 为字符串 → 长度	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
嵌套块内无早退守卫 → 仍报 L2；非 nullish 早退守卫（v === 1）不产生补集窄化 → 仍报 L2；块内有词法声明时不摊平（名字不外泄到函数作用域）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
o.b?.().c on {b:null} → undefined（不抛）；o.b?.().c on {b:undefined} → undefined；o.b?.().c on {}（b 缺失） → undefined；o.b?.()['c'] on {b:null} → undefined（计算成员读同口径）；o.b?.().c.d on {b:null} → undefined（多级尾随读）；o.b?.().c?.d on {b:null} → undefined（尾随	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
o.b?.().c on 函数 b → 读到 c；o.b?.().c 方法体 this 仍绑 o；o.b?.().c on 函数 b 返回 {c:{d:8}} → 多级读通；o?.m?.().c on {m:()=>({c:4})} → 读到 c；o[k]?.().c on {b:()=>({c:5})} → 读到 c；调用跳无尾随成员：o.b?.() on {b:null} → undefined；调用跳无尾随成员：o.b?.() 仍调用方法；成员跳既有语义：o?.b.c	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
`() => o.n++` 返回写前值 0（原生同），写回仍发生（o.n = 1）；可选链 delete 的写回已下沉到表达式内（无语句级二次发射）；async 表达式体的删除/写回同在 $async thunk 内（写回不逸出 thunk）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
块体箭头的写回照旧发生；只读箭头取值不变；函数表达式的块体体不受影响（返回写前值）；捕获临时名避让用户标识符（用户自己有 __mutRet 不得 TDZ）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
实例方法摘下后调用 → 正常返回（原生 this=undefined，方法体不碰 this）；静态方法摘下后调用 → 正常返回；从原型对象上摘下后调用 → 正常返回；摘下后仍是函数值（typeof → function）；摘下后调用不记 may-throw（throws 域干净——L2 门禁不再假报）；方法体真读 this 时仍定抛 TypeError（原生 this=undefined ⇒ this.x 抛）；负控制：直接调用（a.m()）不受影响	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
for-of 里 break ⇒ 调 return()；for-of 里条件 break ⇒ 调 return()；for-of 循环体抛错 ⇒ 调 return()（抛错被捕获后副作用可见）；label break ⇒ 调 return()；循环体里 return ⇒ 调 return()（函数返回值先算，close 副作用后置可见）；解构模式填满而迭代器未耗尽 ⇒ 调 return()；return() 的返回值不是对象 ⇒ 原生定抛 TypeError；return 槽	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
for-of 调用 @@iterator 与 next（原生 1 + 3 = 4 次）；spread 调用 @@iterator 与 next；rest 参数展开调用 @@iterator 与 next；混合 spread（数组 + 用户 iterable）调用 @@iterator 与 next；解构只取第 1 个元素 ⇒ 只驱动到第 1 次 next；for-of 取到的是迭代序的值（不是索引序）；负控制：内建可迭代体的 next 计数不变	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
Array.from(o) 调用 @@iterator 与 next（原生 1 + 3 = 4 次）；Array.from(o) 取到的是迭代序的元素；Array.from(o, mapFn) 逐位应用 mapper（下标自 0 起）；Array.from(o).length = 迭代出的元素数；负控制：array-like 接收者（无 @@iterator）仍走索引读路径；负控制：内建可迭代体不受影响（Array / Set / 字符串路径不驱动用户迭代器）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
try 里的 break：catch 体不跑、循环退出；try 里的 break：循环计数停在 break 点；try 里的 continue：catch 体不跑、迭代继续；嵌套循环：try 里的 break 退出**内层**循环（外层继续）；负控制：真异常仍被 catch 吞掉（catch 体照跑）；负控制：无 try 的 break 仍退出循环；负控制：try/finally 路径不变（finally 照跑、break 生效）；负控制：try 块正常路径不受影响；负控制：	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
"%s：公理 last >= 0 → 返回契约 ge(0) 证得（无 error）+ invariant-relied 审计"	表驱动用例：%s：公理 last >= 0 → 返回契约 ge(0) 证得（无 error）+ invariant-relied 审计；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"%s 对照（无公理）：证不出 → 返回义务未证得（负控制：不得被本修复波及）"	表驱动用例：%s 对照（无公理）：证不出 → 返回义务未证得（负控制：不得被本修复波及）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
弱公理不得证明强契约（方向性诚实）：@nudo:invariant last >= 0 vs 契约 ge(1)；抽象预算耗尽路径（不可判定条件）不受影响：公理照常实施	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
矛盾公理（last >= 0 vs 参数契约 n ≤ -5）：门禁红（constraint-violated），不得判绿；签名面：矛盾合取不得出现在返回值的 pred 上（n ≤ -5 ∧ n ≥ 0 是 ex falso 指纹）；对照（无公理）：同样的红（公理被拒后行为与「没写公理」同口径）；非矛盾公理照常实施（负控制：不得把公理一律丢掉）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
矛盾叶子（le(n,-5) + 公理 ge 0）：pred 保持原样，不得并入 ≥ 0；相容叶子（ge(n,1) + 公理 le 10）：两个界都在（不得误拒）；反向矛盾（ge(n,0) + 公理 le -5）：同样被拒；字面量叶子不改写（既有守卫仍在）：具体值自带真值	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
返回域含被丢掉的分支（0 | 1）；返回域含被丢掉的分支（无 default ⇒ 隐式 no-match 臂）；返回域含多个非字面量 case 臂；L1 门禁：契约真实违约被报出（不再假绿）；负控制：全字面量 case 的 switch 仍精确匹配（返回域不含未命中臂）；负控制：同语义的 if 写法结论不变（同样报违约）；负控制：字面量判别式 + 字面量 case ⇒ 仍是精确命中（单一分支）；负控制：非字面量 case 测试仍按序惰性求值（命中即停，Bug 168 口径）	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
`case v === null:` 的 miss 路径 → default 臂的 v.length 不报 may-throw；`case v == null:`（松散）的 miss 路径 → 收窄到非 nullish；两个 nullish 比较臂：default 路径排除 null 与 undefined；`case v === undefined:` 的 miss 路径只排除 undefined（null 仍在 ⇒ 仍可抛）；负向比较 `case v !== null:`	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
spread 展开下标序列（node: "abc,b"）；for-of 逐元素累加（node: "abcb"）；数组解构取捕获组（node: "123123"）；spread 保持未参与捕获组的 undefined 槽（node: ["az",null] 的展开面）；非全局 match 的结果同样可迭代（node: "a"）；matchAll 的每个匹配项可迭代（node: "ab"）；indices 镜像（/d 标志）原生同为 Array ⇒ 同样可迭代（node: 2）；	algebra-eval-control 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
引擎结果 = 原生 15（修前：TDZ ReferenceError 被用户 catch 吞掉 ⇒ 0）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
签名面写 15（不是 => 0）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
参数版签名面与无碰撞对照逐字一致（修前：=> 0）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
无假 nudo:opaque-result（修前：模块 fail-closed ⇒ unknown + 假 opaque）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户写 __nudoTm_0：模块不退化 unknown（结果 = 原生 8）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户写 __nudoE_0：catch 载体不遮蔽用户绑定（结果 = 原生 8）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户写 __nudoArgs：arguments 槽不重复声明（结果 = 原生 0）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
整模块不再 fail-closed：无关导出 g 仍拿到签名（与无碰撞对照逐字一致）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
无假 nudo:opaque-result（修前：整模块 unknown + 2 条假 opaque）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
不退化 unknown（修前：f/g 全 unknown）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
内部临时名逐字保持原形（__nudoTm_0 / __nudoRet / __nudoArgs，无后缀改名）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
同一源码转译两次 ⇒ 产物逐字相同（确定性：缓存键 / 差分语料依赖它）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
撞名时改名后仍确定（同源两次转译逐字相同）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
单元素解构：值面 = 迭代序第 1 个值（原生 1，此前折确定 undefined）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
多元素解构：第 1 位 = 迭代序第 1 个值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
多元素解构：第 2 位 = 迭代序第 2 个值（原生 2，此前折确定 undefined）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
赋值形态（[p, q] = it）同样按迭代序	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
形参位解构（function h([a, b]) {…} h(userIter)）同样按迭代序	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户**迭代器**对象（自带 next + @@iterator）按迭代序取值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
副产物：引擎原生迭代器不被误判为用户 iterable（spread 不假抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：内建可迭代体（tuple / 字符串 / Set / Map）解构仍是精确值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：any 接收者仍保持 any 面（探针不过度命中）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：非可迭代接收者仍抛 TypeError（守卫不被绕过）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：生成器对象 / 集合迭代器（引擎自有元素模型）不被探针误伤	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
if 臂里的 break 退出 switch（原生 ""）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
if 臂里的 break 退出 switch（块形态）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
if/else 形态：else 分支的 break 也退出 switch	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中第二个 case 时，if 臂里的 break 不影响 default 臂	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
条件 break：假分支继续贯穿（原生 "bb"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
条件 break：真分支退出 switch（原生 ""）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：臂内循环的 break 退出循环（不是 switch）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：臂内循环的 continue 退出循环（不是 switch）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：带标签 break 仍指向带标签块	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：臂顶层的裸 break 仍退出 switch	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
循环后 var 头仍可见（typeof x === number）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
循环后 var 头持有末轮值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (var k in …) 头同样是函数级绑定	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (var k in …) 头持有末轮键	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
var 头共享同一绑定（闭包全部看到末轮值）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (var k in …) 头共享同一绑定（闭包看到末轮键）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
var 头在循环体内可见（逐轮读到当轮项）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
var 头可再赋（var 是可写绑定）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
var 头解构：子名同样是函数级绑定（末轮值）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
var 头解构：子名在循环后仍可见	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
嵌套块里的 var 头仍是函数级绑定	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (let x of …) 循环后不可见	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (const x of …) 循环后不可见	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (let x of …) 闭包各捕获各轮（per-iteration）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (const x of …) 闭包各捕获各轮	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (let k in …) 循环后不可见	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
普通 var（非头）提升语义不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
@nudo:as 只覆盖被登记的那条语句（同行下一条不受影响）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
@nudo:as 仍覆盖被登记的那条语句（负控制）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
@nudo:replace 只命中被登记的那个节点（同行同文本的兄弟节点不受影响）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
@nudo:replace 仍替换被登记的那个节点（负控制：兄弟节点不被波及）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中第一个 case：后续 case 测试不求值（原生 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中第二个 case：第一个 case 测试仍求值（原生 2）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
全不命中：所有 case 测试都求值（原生 2）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中即停：命中后的 case 测试的副作用不发生（原生 "t1,one"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中即停：命中后的 case 体的副作用也不发生（原生 101）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：每个 case 测试只求值一次（原生 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：抽象判别式下 case 测试全部求值（副作用不丢）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：相邻形态（if/else 判别）不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
case 测试的写保留（原生 11）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
case 测试的副作用日志保留（原生 "t1,one"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
未命中时前面 case 测试的副作用保留（原生 "t1,t2,two"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
抽象判别式下 case 测试的副作用同样保留（上界）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：case 测试只求值一次（不重复计数，原生 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：无 case 测试的 switch 不受影响（原生 5）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：臂体的写仍以基线为起点（臂间隔离不破）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
体里的 break 跳出循环（不是跳出函数）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
体里的 continue 转到条件求值（首轮后不再执行体）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
条件里的 break（事实臂）同样只跳出循环	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：无 break/continue 的 do-while 轮数与返回值不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：嵌套 do-while 的 break 只跳出内层循环	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：while / for 的 break 语义不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户声明 _d0：模块仍可求值（不再重复声明 SyntaxError）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户声明 _n1（嵌套解构临时名）：模块仍可求值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户声明 _p0（形参占位名）：模块仍可求值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户声明 _rest0（rest 形参占位名）：模块仍可求值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
用户声明 _pd0（默认参解构临时名）：模块仍可求值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：无撞名时解构行为不变（精确值）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
模块首条语句即解构声明 + 用户模块级 _d0：模块可求值且值正确	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
后续语句解构 + 用户模块级 _d0：模块可求值且值正确	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
模块首条语句即嵌套解构 + 用户模块级 _n1：模块可求值且值正确	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
模块级 fail-closed 面解除：无关函数不再被拖成 unknown	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
两处解构 + 用户模块级 _d0：模块可求值且值正确	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
产物不与用户同名绑定重复声明（临时名让开）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：无撞名时临时名与行为不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：用户 _d0 在函数体内（跨作用域）不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：形参占位名族（_p0）与 rest 族（_rest0）不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
早返回形态：后续路径不排除 NaN ⇒ return number().gt(0) 不成立（error）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
语义等价的事实臂写法仍证得（结论一致）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
尾句非全终止的早退形态（早退提升路径）同口径（error）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：返回字面量的早退形态仍判违约（0 不满足 positive）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：事实臂不终止的普通 if/else 同样不断言否定界（判违约的依据不是否定界）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：四种关系算子的后续路径**同口径**（四种形态都在 NaN 上违约）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (; v !== null; ) { return v.length; } 零 L2（native 永不抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
与 while 写法结论一致（同守卫同机制）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for 体内的 nullish 守卫对成员读生效（v.length 不撞 null 臂）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (; x > 0; ) { return x; } 满足 return number().gt(0)	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
与 if 写法结论一致（同守卫同机制）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (; v !== null; ) 在 v 为 null 时不进体（返回 0）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for (; v !== null; ) 在 v 为字符串时进体（返回长度）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for 主路径的循环变量不被影子参数顶掉（i 逐轮递增）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
无守卫的 for 体内读 null 臂成员仍报 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
命中事实：`case 1:` 臂内判别值 = 字面量 1（返回域 1 | 2）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
排除事实：`default:` 臂排除 `case null` ⇒ v.length 不判 may-throw	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
排除事实：`case null:` 之外的臂（`case 1:`）同样排除 null	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
多个 case 标签：命中事实取并集（1 | 2 | 3）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：臂内写判别绑定 ⇒ 跳过窄化（影子参数会吞掉臂内写）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：非字面量 case 标签不产事实（臂内判别值不被改写）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
成员判别式：case 标签剪影 union 成员（index 读不记 may-throw）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：成员判别式的 case 标签**不是**字面量 ⇒ 不剪影（index 读记 may-throw）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
第 2 轮起体内成立 x > 0 事实 ⇒ return x 满足契约	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
与 while 写法结论一致（同守卫换结构结论相同）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
首轮拷贝保持未收窄（先于测试求值 ⇒ 无 > 0 事实，仍报 L1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
循环体外的读不携带关系事实（仍报 L1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
do-while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
do-while 体至少执行一次（先于测试）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
第 2 轮的 return 取到 x（运行时取值不变）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (x > 0) { return x; } 满足 return number().gt(0)	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
与 if 写法结论一致（同守卫换结构结论相同）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (x >= 0) 的关系事实同样接进体内	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (x > 0) 在 x 为正时进体（返回 x）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (x > 0) 在 x 为负时进不了体（返回 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
while (v !== null) 的 nullish 收窄不改变取值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
裸块：{ if (v === null) { return 0; } } return v.length; 零 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
try 块：同段代码零 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
catch 块：同段代码零 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
finally 块：同段代码零 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
对照组：函数体顶层同段代码零 L2（既有口径不回归）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
四种嵌套形态与顶层形态签名一致	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
裸块：v 为 null → 0；v 为字符串 → 长度	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
try 块：v 为 null → 0；v 为字符串 → 长度	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
catch 块：v 为 null → 0；v 为字符串 → 长度	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
finally 块：v 为 null → 0；v 为字符串 → 长度	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
嵌套块内无早退守卫 → 仍报 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
非 nullish 早退守卫（v === 1）不产生补集窄化 → 仍报 L2	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
块内有词法声明时不摊平（名字不外泄到函数作用域）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c on {b:null} → undefined（不抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c on {b:undefined} → undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c on {}（b 缺失） → undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.()['c'] on {b:null} → undefined（计算成员读同口径）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c.d on {b:null} → undefined（多级尾随读）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c?.d on {b:null} → undefined（尾随链自身可选）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o?.m?.().c on {}（m 缺失） → undefined（接收者+方法双可选）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o[k]?.().c on {b:null} → undefined（invokeKey hop 同款）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o?.[k]?.().c on {} → undefined（invokeKey + 接收者可选）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.()() on {b:null} → undefined（尾随调用同属链，ES 同口径）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c() on {b:null} → undefined（尾随成员读 + 调用）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.()[0] on {b:null} → undefined（尾随下标读）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c on 函数 b → 读到 c	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c 方法体 this 仍绑 o	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o.b?.().c on 函数 b 返回 {c:{d:8}} → 多级读通	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o?.m?.().c on {m:()=>({c:4})} → 读到 c	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
o[k]?.().c on {b:()=>({c:5})} → 读到 c	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
调用跳无尾随成员：o.b?.() on {b:null} → undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
调用跳无尾随成员：o.b?.() 仍调用方法	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
成员跳既有语义：o?.b.c on null → undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
成员跳既有语义：o?.b.c on {b:{c:1}} → 1	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
接收者可选的调用跳既有语义：o?.m() on null → undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
接收者可选的调用跳既有语义：o?.m() this 仍绑 o	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
真正该抛的 TypeError 不被吞：调用结果为 null 时的 .c	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
调用结果为 {c:null} → 值 null（不是抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
真正该抛的 TypeError 不被吞：o?.b().c 且 b 非函数	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
`() => o.n++` 返回写前值 0（原生同），写回仍发生（o.n = 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
可选链 delete 的写回已下沉到表达式内（无语句级二次发射）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
async 表达式体的删除/写回同在 $async thunk 内（写回不逸出 thunk）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
块体箭头的写回照旧发生	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
只读箭头取值不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
函数表达式的块体体不受影响（返回写前值）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
捕获临时名避让用户标识符（用户自己有 __mutRet 不得 TDZ）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
实例方法摘下后调用 → 正常返回（原生 this=undefined，方法体不碰 this）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
静态方法摘下后调用 → 正常返回	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
从原型对象上摘下后调用 → 正常返回	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
摘下后仍是函数值（typeof → function）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
摘下后调用不记 may-throw（throws 域干净——L2 门禁不再假报）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
方法体真读 this 时仍定抛 TypeError（原生 this=undefined ⇒ this.x 抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：直接调用（a.m()）不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 里 break ⇒ 调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 里条件 break ⇒ 调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 循环体抛错 ⇒ 调 return()（抛错被捕获后副作用可见）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
label break ⇒ 调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
循环体里 return ⇒ 调 return()（函数返回值先算，close 副作用后置可见）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
解构模式填满而迭代器未耗尽 ⇒ 调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
return() 的返回值不是对象 ⇒ 原生定抛 TypeError	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
return 槽是非可调用值 ⇒ 原生定抛 TypeError（GetMethod）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
return() 自身抛错 ⇒ 该抛错取代原完成值并冒泡	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：continue 不调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：自然耗尽不调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：迭代器无 return 槽 ⇒ 不凭空抛、不凭空调	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：rest 模式把迭代器读空 ⇒ 不调 return()	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 调用 @@iterator 与 next（原生 1 + 3 = 4 次）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
spread 调用 @@iterator 与 next	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
rest 参数展开调用 @@iterator 与 next	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
混合 spread（数组 + 用户 iterable）调用 @@iterator 与 next	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
解构只取第 1 个元素 ⇒ 只驱动到第 1 次 next	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 取到的是迭代序的值（不是索引序）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：内建可迭代体的 next 计数不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
Array.from(o) 调用 @@iterator 与 next（原生 1 + 3 = 4 次）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
Array.from(o) 取到的是迭代序的元素	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
Array.from(o, mapFn) 逐位应用 mapper（下标自 0 起）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
Array.from(o).length = 迭代出的元素数	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：array-like 接收者（无 @@iterator）仍走索引读路径	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：内建可迭代体不受影响（Array / Set / 字符串路径不驱动用户迭代器）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
try 里的 break：catch 体不跑、循环退出	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
try 里的 break：循环计数停在 break 点	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
try 里的 continue：catch 体不跑、迭代继续	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
嵌套循环：try 里的 break 退出**内层**循环（外层继续）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：真异常仍被 catch 吞掉（catch 体照跑）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：无 try 的 break 仍退出循环	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：try/finally 路径不变（finally 照跑、break 生效）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：try 块正常路径不受影响	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：catch 体里的 break 仍透传到循环（不被 catch 体自身的内层 try 吞掉）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
弱公理不得证明强契约（方向性诚实）：@nudo:invariant last >= 0 vs 契约 ge(1)	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
抽象预算耗尽路径（不可判定条件）不受影响：公理照常实施	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
矛盾公理（last >= 0 vs 参数契约 n ≤ -5）：门禁红（constraint-violated），不得判绿	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
签名面：矛盾合取不得出现在返回值的 pred 上（n ≤ -5 ∧ n ≥ 0 是 ex falso 指纹）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
对照（无公理）：同样的红（公理被拒后行为与「没写公理」同口径）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
非矛盾公理照常实施（负控制：不得把公理一律丢掉）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
矛盾叶子（le(n,-5) + 公理 ge 0）：pred 保持原样，不得并入 ≥ 0	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
相容叶子（ge(n,1) + 公理 le 10）：两个界都在（不得误拒）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
反向矛盾（ge(n,0) + 公理 le -5）：同样被拒	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
字面量叶子不改写（既有守卫仍在）：具体值自带真值	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
返回域含被丢掉的分支（0 | 1）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
返回域含被丢掉的分支（无 default ⇒ 隐式 no-match 臂）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
返回域含多个非字面量 case 臂	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
L1 门禁：契约真实违约被报出（不再假绿）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：全字面量 case 的 switch 仍精确匹配（返回域不含未命中臂）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：同语义的 if 写法结论不变（同样报违约）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：字面量判别式 + 字面量 case ⇒ 仍是精确命中（单一分支）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：非字面量 case 测试仍按序惰性求值（命中即停，Bug 168 口径）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
`case v === null:` 的 miss 路径 → default 臂的 v.length 不报 may-throw	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
`case v == null:`（松散）的 miss 路径 → 收窄到非 nullish	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
两个 nullish 比较臂：default 路径排除 null 与 undefined	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
`case v === undefined:` 的 miss 路径只排除 undefined（null 仍在 ⇒ 仍可抛）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负向比较 `case v !== null:` 的 default 路径 v 仍是 null ⇒ 仍可抛	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
判别式不是字面量 true 时不产事实（未命中≠测试为假）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
收窄不误伤：default 臂读 v 之外的东西不报 may-throw	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
spread 展开下标序列（node: "abc,b"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
for-of 逐元素累加（node: "abcb"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
数组解构取捕获组（node: "123123"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
spread 保持未参与捕获组的 undefined 槽（node: ["az",null] 的展开面）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
非全局 match 的结果同样可迭代（node: "a"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
matchAll 的每个匹配项可迭代（node: "ab"）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
indices 镜像（/d 标志）原生同为 Array ⇒ 同样可迭代（node: 2）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
原生不可迭代对象仍定抛 TypeError（负控制：普通 obj 不是数组）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
槽读面不回归：m[0] / m.length / m.index / m.input	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
JSON 视图不回归：JSON.stringify(m) → '["abc","b"]'	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
枚举面不回归：Object.keys(m) 只有原生 5 个自有可枚举键（@@iterator 不可见）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：全局 match（纯串数组）与无匹配（null）行为不变	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
负控制：数组方法面不回归（join / slice / map / toString / isArray）	dup:algebra-eval-control 聚合矩阵	commit:6e96354b
```
