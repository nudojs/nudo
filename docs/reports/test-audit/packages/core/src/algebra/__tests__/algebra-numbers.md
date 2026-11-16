# packages/core/src/algebra/__tests__/algebra-numbers.test.ts

模块套件：数值/字面量/比较/算术端点面。

审计：482 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
存在 export namespace 时无关函数仍是精确值（改前 unknown）；顶层常量导出同样不退化；check 面的问题集合与无 namespace 的同一模块一致（不再假绿）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
变量键查找 map[k]（any #path）⇒ 零违例（改前假红）；any 形参作实参 ⇒ 零违例（与 any #path 同口径）；null 字面量放行（434 不回归）；0 字面量仍判违例，expected 指向 x = null	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
numOrStr（number().gt(0) | string().min(1)）收到 %s ⇒ 1 条违例	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
负控制：numOrStr 收到满足某一支的 %s ⇒ 零违例	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
shapeOrNum 收到 %s ⇒ 1 条违例	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
负控制：shapeOrNum 收到满足某一支的 %s ⇒ 零违例	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
numOrStrNoLen 收到 %s ⇒ 仍报 1 条	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
返回位：x 的谓词已证明落在 union 内（status）⇒ 零 error；返回位：同 prim **字符串**字面量 union 同样不得假红；负控制：返回值确定不在 union 内 ⇒ 仍报 error（整体蕴含不放宽确定违约）；负控制：值域宽于 union（x 只是裸 number）⇒ 仍是 error	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
非字面量返回值（x + 0.5）不再假绿：出 unproven-return warning、无 error；整性可从前提传导：x 声明为 int ⇒ `return x` 证得、零诊断；整数字面量返回照旧放行；小数返回照旧是 error（字面量特判不回归）；值域只是裸 number（无整性证据）⇒ 出 unproven-return warning（改前静默 proved）；负控制：整数算术（x + 1，x 为 int）**不得**变成假红（整性不可判定 ⇒ warning	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
static method returns its value；instance method still returns its value；class value itself stays a class signature	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
非 number 字面量不得被认成原字面量（此前 `"abc" - 0` ⇒ `"abc"`）；boolean / null / 数字字符串走 ToNumber；bigint 混型保留原项（原生 TypeError，不得折成字面量）；number 字面量仍可化简（`5 - 0` ⇒ 5）；非字面量项保持 number 路径化简（`x - 0` ⇒ x）；对照：`x * 1` 的既有域守卫不变（`"abc" * 1` ⇒ NaN，不得留 string）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
x = 42 ∧ x ∈ {43,44} → nudo:contract-conflict error + exit≠0；平铺字面量同款矛盾 → error（两种拼写同结论）；有限集有交集（x = 42 ∧ x ∈ {42,43}）→ 不报矛盾	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
union(lit(1), lit(2), lit(3)) ⇒ `1 | 2 | 3`（不是 `number`）；负控制：裸 number 契约仍是 `number`	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
analyzer round 之后 check 闸门仍读到 1（不接续上一轮的活状态）；字节相同的第二个文件不共用实例（各自 1，不是 2/3）；同一文件重复分析也是新一轮（每次 1）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
IIFE with unconditional throw；top-level call to a function that always throws；top-level member access on a nullish const；top-level JSON.parse of an invalid literal；class static block with unconditional throw；typeof missing identifier is saf	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
宿主 IEEE 见证：fl(MIN_VALUE + 1) === 1 但 x ≠ 0；x + 1 === 1 ⊬ x === 0（吸收型加法；反例 x = MIN_VALUE）；x + 1 === 1 ⊬ x >= 0（同一前像区间不得收成单点）；x - 1 === -1 ⊬ x === 0（减法同源；反例 x = -5e-324）；x + 1e6 === 1e6 ⊬ x === 0（量级吸收：解集 |x| ≤ ½ulp(1e6)）；3 * x === 1 ⊬ x === 1	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
2 * x === 4 ⊨ x === 2（2 的幂缩放无舍入）；x === 5 ⊨ x === 5 / x >= 5（纯原子事实仍是点）；x + 1 === 0 仍可取到 x = -1 的下界（前像不含正区间）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
契约 + 冲突默认值 ⇒ 报错（修复前：OK / exit 0）；签名如实反映默认值参与定义域（`number | "abc"`）；合法形态保持绿：默认值落在契约域内（`s = 1` + `number()`）；无契约路径行为不变（默认值不参与，零报错）；.d.ts 可省性的事实来源保留：契约路径下 formals 仍是 default/optional；`_` / rest 之外的默认形参也走同一口径（`a`, `b = 2`）；通用侧车 opts 口径（marker）与	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
没有循环的函数上声明不变式 ⇒ 零 invariant-relied（旧口径无条件报）；循环里真正实施了不变式 ⇒ 仍有 invariant-relied；不变式指向的绑定在循环里不存在 ⇒ 不归因	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
顶层形参：`lit(3)` ⇒ `3`（不是 `lit(3)`）；对象判别槽：`kind: lit("a")` ⇒ `{ kind: "a", n: number }`；负控制：无数值界契约的渲染不变（`number` 仍是 `number`）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
同项事实 `x+1 > nextDown(1)` ⇒ 义务 `x+1 >= 1`（IEEE 下恒真）；同项事实 ⇒ 更弱的义务同样成立（ge / gt nextDown(1)）；反向不成立：`x+1 > nextDown(1)` ⇏ `x+1 > 1`（严格差一格不够）；严格事实才步进一格：非严格事实 `x+1 >= nextDown(1)` ⇏ `x+1 >= 1`；保真控制：吸收型累加仍证不出 `x+y > 1`（fl(MIN + 1) === 1）；保真控制：同项格点步	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(1n) 契约收到 2 ⇒ 判违例（改前 0 违例 = 假绿）；lit(1n) 契约收到 1 ⇒ 判违例（1 ≠ 1n：number 与 bigint 是两个域）；union(lit(1n), lit(2n)) 收到 2 ⇒ 判违例（改前 0 违例 = 假绿）；负控制：lit(1)（number 字面量）收到 2 ⇒ 判违例（既有行为不回退）；负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(1n) 收到 2n ⇒ 判违例（改前 0 违例 = 假绿：实参取不到）；lit(2n) 收到 1n ⇒ 判违例（改前 0 违例 = 假绿）；union(lit(1n), lit(2n)) 收到 3n ⇒ 判违例（改前 0 违例 = 假绿）；负控制：lit(1n) 收到 1n ⇒ 放行（取到实参且满足契约）；负控制：union(lit(1n), lit(2n)) 收到 1n ⇒ 放行；负控制：union(lit(1n), lit(2n)) 收到 2n ⇒ 放行（2n 落	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
"调用方看到 nudo:contract-param-mismatch（旧行为：零诊断）"	"跨模块桥接路径与同文件路径**同口径**：契约形参名对不上形参表 ⇒ 报 nudo:contract-param-mismatch，不再静默丢参数面。 旧行为：跨模块时契约形参名对不上（`fn({ k: … })` vs `function scale(factor)`） ⇒ 该形参的**义务在调用方蒸发**（调用点假绿：负参调用不报违例）。 断言：expect(m).toHaveLength(1);；expect(m[0]!.fn).toBe(\"scale\");"	没测该层	keep	keep	—
无 param-mismatch；调用点的负参违例照旧执法（跨模块 L1 扫描）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
不报 param-mismatch（点路径名在契约面内）；点路径实参义务照旧执法	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
宿主 IEEE 见证：[0.1]*6 ≠ 0.1+0.1+0.1+0.1+0.1+0.1；x >= 0 ⊬ x * 6 <= x+x+x+x+x+x（抛臂可达）；x >= 0 ⊬ x * 6 >= x+x+x+x+x+x（对称方向同样不得证出）；x >= 0 ⊬ x * 6 === x+x+x+x+x+x	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
宿主 IEEE 见证：(1+1)+1/3 > 1+(1+1/3)；a,b,c > 0 ⊬ (a+b)+c <= a+(b+c)；a,b,c > 0 ⊬ (a+b)+c >= a+(b+c)（反向亦然）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
2 * x 与 x + x 都是精确加倍 ⇒ x > 0 ⊨ 2x <= x+x；x > 1 ∧ assumeFinite(x) 下 2 * x 与 x + x 仍同形	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(-0) 渲染成 lit(-0)，不是 lit(0)；字段位（shape）保真：侧车回显与字段契约同源；函数契约整体保真（参数位 + 返回位）；lengthBound 的常数界渲染同款口径（.length(-0)）；负控制：正零仍是 0（不得把 0 渲成 -0）；负控制：其它字面量形态不受牵连（bigint 的 n 后缀 / 字符串 / 布尔）；原生事实：-0 与 0 确实可观察不同（Object.is / 1/x）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
构造器做算术 ⇒ 方法入口不再报 nudo:entry-may-throw（改前：error 级 1 条）；构造器做比较 / 字符串拼接 / 成员调用 ⇒ 同上（都只算构造器的账）；构造器显式 throw ⇒ 也不归因给方法（那是 `new C()` 入口的事）；方法体**自己**会抛 ⇒ 仍要报（闸门不整体关掉）；方法体读构造器写入的字段（any）⇒ 成员调用仍报（构造器仍要跑）；静态方法口径不变（静态桥不跑构造器 ⇒ 它自己的算术照报）；单元层：实例方法的 throws	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
转译产物里 async generator 体内没有裸 yield（修前：`(yield …)` ⇒ 非法 JS）；整模块不再 fail-closed：其它导出的 L2 门禁仍触发（修前：诊断消失 ⇒ 假绿）；其它导出的签名不退化 unknown（修前：risky 退成 `risky() => unknown`）；无假 nudo:opaque-result（修前：整模块 unknown ⇒ 假 opaque 诊断）；async generator 自身的产出仍正确（for-a	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
同步 generator 声明：体里的 yield 仍走 $yield（不是 $await）；async **函数**（非 generator）声明：await 仍发射裸 yield（真挂起点）；async generator **表达式**面（兄弟路径）不受影响：await 走 $await	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
new Uint8ClampedArray([1.5])[0] ⇒ 2（native：2；修前：1）；new Uint8ClampedArray([3.5])[0] ⇒ 4（native：4；修前：3）；就近偶数（tie → 偶数）：2.5 ⇒ 2、4.5 ⇒ 4、0.5 ⇒ 0（native 同款）；非 tie 值照旧四舍五入：1.4 ⇒ 1、1.6 ⇒ 2（native 同款）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
边界：300 ⇒ 255、-1 ⇒ 0（native 同款）；整数 TA 仍是向零截断：new Int8Array([1.5])[0] ⇒ 1（native：1）；浮点 TA 不钳位：new Float64Array([1.5])[0] ⇒ 1.5（native：1.5）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
构造器抛 + 方法体 total ⇒ 方法签名仍是 "acct"（不是 unknown）；构造器抛 ⇒ 不产生误导的 nudo:opaque-result；构造器**不**抛时行为不变（方法签名照常）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
Φ 被消费 ⇒ 记账 + 归因可见（账本是活写，不依赖调用方传快照）；只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）；既未记账、也非 Φ 命中 ⇒ 不归因（不得把没消费过的公理报成 relied）；账本里是**别的**前提（对象身份不同）⇒ 不归因（防按位置误配）；证明不成立（unprovable / disproved）⇒ 不报 relied（归因只对已证义务）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
d1(undefined)（x = 5，契约 x > 0）⇒ 零诊断（默认值 5 满足契约）；默认值本身违约时仍要报（d2(undefined)，x = -5，契约 x > 0）；负控制：没有默认值的形参收 undefined ⇒ 仍按 undefined 执法（报 typeof 违例）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
string().int() 抛错（不再暴露到非数值 builder）；boolean().int() 抛错；lit('a') 根本不带 int 方法（非数值字面量链无法产出分裂约束）；number().int() 仍然可用（负控制）；域面 / Abs 面口径一致：非数值链上不存在 int 约束；数值链的 Abs 面仍带整性编码（Bug 342 语义不回归）；纯数据约束（非 number prim）不再产出整性 pred（两面一致）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
boolean().gt(1) 抛错（恒假契约 ⇒ 假红）；string().gt(1) 抛错（恒假契约 ⇒ 假红）；string().length(-3) 抛错（恒假契约 ⇒ 假红）；负控制：既有的有限界护栏口径不变（length(2.5) 仍合法，Bug 336 钉住）；array(1, 2) 抛错（多余实参不再被静默丢弃）；负控制：合法用法仍然可用（number().gt(0) / string().min(1) / array(number())）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
原生 oracle：早返回形态在 x=NaN 时返回 NaN（违反 nonNeg）；早返回形态不得静默（0 诊断 = 假绿）；早返回形态与三元写法结论一致（同一契约 ⇒ 同一诊断）；同族形态：`positive` 家族（x <= 0 ⇒ 返回 1）不得静默；同族形态：`max100` 家族（x > 100 ⇒ 返回 100）不得静默；同族形态：if/else 写法（else 臂 = 后续路径）不得静默；负控制：事实臂的关系窄化**保留**（x >= 0 ⇒ return x	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
字面量分支（eq/or 路径事实把值钉在违规字面量上）⇒ error；声明域参数的裸返回（x: num vs positive）⇒ error；补集臂 NaN 面（三元写法，else 臂含 NaN ⊭ nonNeg）⇒ error；负控制：派生项（值域未被跟踪）⇒ 证不出（warning），不得当违约；负控制：无 term 的派生项 ⇒ 证不出（warning）；负控制：有界证据（守卫 x >= 0 vs positive）⇒ 仍是 error；负控制：字面量返回按域隶属判违	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
类入口清单含 `export default C`（修前：空清单）；导出形态覆盖齐全（回归护栏：其余三种形态不变）；端到端：构造器必抛必须报在类入口上（修前：零诊断 ⇒ 假绿）；端到端：构造器不抛 ⇒ 零 L2（不凭空造诊断）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
侧车参数位 + 返回位 lit(NaN) ⇒ 不报 nudo:contract-conflict；源码指令位 lit(NaN) ⇒ 不报 nudo:contract-conflict；真矛盾（and(lit(1), lit(2))）⇒ 仍报 nudo:contract-conflict（闸门不得变假绿）；不同字面量（lit(1) ∧ lit(2)）跨约束 ⇒ 仍报 conflict（不得放宽真矛盾）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿；autoBind:false ⇒ 不探测 ambient 侧车（ambient 绑定无资格 ⇒ 不读盘）；真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）；autoBind 开启且 ambient 侧车确实被绑定 ⇒ 仍报 nudo:contract-load（真故障不被吞）；autoBind 开启但 ambient 侧车**没被用到**	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
callee 2 个 await：caller 恢复后读到 callee 的终值（原生 "1,2,3"）；callee 3 个 await：caller 恢复后读到 callee 的终值（原生 "1,2,3,4"）；callee 2 个 await 后写 flag：caller 读到 flag=1（原生 1）；return await <2-await callee>：值域是 callee 终值（原生 7）；嵌套 return await <2-await callee>：值	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
readCache：await 2-await callee 后的 cache 仍是 "warm"；callee 2 个 await 后拒绝：caller 的 promise 面是 never（与 1-await 同口径）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
原生 oracle：可选参数之后的必选参数 ⇒ 少传就炸；(a = 1, b) ⊭ 单参目标（最小实参元数 = 2）；(a = 1, b) ⩽ 双参目标（目标给够两个 ⇒ 可赋值）；既有口径不变：(a, b = 1) ⩽ 单参目标（必选只有 a）；可选参数之后的必选参数算进最小元数：(a, b = 1, c) ⇒ 最小 3；rest 吸收多余实参：(a, ...rest) ⇒ 最小 1；缺省标记时回退名字后缀判据：可选位在**前**也算必选位之后 ⇒ 最小 2；端到端：把 (	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
域隶属口径：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 与 number 不混同）；callee 违约（返回 2n）⇒ 调用方不得被声明面「证得」（假绿回归）；callee 违约（返回 2n）⇒ 调用方的返回面是真实值 2n，不是声明面；callee 守约（返回 1n）⇒ 调用方零诊断（不得新增诊断）；callee 守约（返回 1n）⇒ 调用方的返回面保留推断精度 1n	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
(a) 冷跑：引理被消费 ⇒ nudo:assume-relied = 1，返回契约证得；(b) 清 check memo（L0 仍在）后重跑 ⇒ relied 仍为 1（不得跳过账本回填）；(c) 只改无关兄弟函数（per-fn 指纹不变 ⇒ 仅 L0 可能命中）⇒ relied 仍为 1；(d) 无种子 generalize 先行（L0 里是无引理 PolyFn）⇒ 随后 check 仍 relied=1，且不误报 unproven；(e) check 之后无种子 gen	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
(g1) 无种子 generalize 先行 ⇒ 随后 check 仍 invariant-relied=1 且未证不误报；(g2) check 之后无种子 generalize 与冷跑逐字一致（invariant 折后界不得泄漏）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
helper 里的不支持构造 ⇒ 调用它的入口 f 拿 L2；兄弟入口 safe 仍是 0；两级 helper 链 ⇒ 传递闭包把构造归因到入口 f；互递归 helper：闭包收敛（不挂死）且仍把环后的构造归因到入口 f；类入口 C：构造器里的不支持构造 ⇒ 整个类入口 C 拿 L2；类方法入口 C.m：构造器里的不支持构造也归因（实例桥要跑构造器）；类方法入口 C.m：**其它**方法的构造不归因（不是它的执行路径）；CJS exports.f = function …：入	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
%s 收到 %s ⇒ %i 条违例（%s）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
new Date(0) 撞 number().gt(0) ⇒ 文案是 typeof 义务；箭头字面量撞 string() ⇒ 文案是 typeof x = "string"；new Date(0) 撞 shape({ id }) ⇒ 报 missing field（不是 object shape 假红）；负控制：顶层调用与函数体内调用同口径（同一实参、同一契约同条数）；负控制：没有契约的形参收到非标量字面量 ⇒ 零诊断（噪声来自契约，不是引擎）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
顶层无条件 throw ⇒ 1 条 error（改前：零诊断 + ok=true）；裸块 { throw } 无条件下钻 ⇒ 报（loc 指向 throw 而非块首）；多个入口 / 入口前后的 throw ⇒ **一条**模块级诊断（不按入口重复）；CJS 入口形态同样覆盖（exports.f 后顶层 throw）；负控：条件抛（未知宿主守卫）⇒ 不报，行为逐字不变；负控：try/catch 吸收的 throw ⇒ 模块可正常装载，不报；负控：函数体内的 throw 不是装载	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
原型链上的成员（toString / hasOwnProperty）不得当「确定缺席」；对照：own 键缺席仍判（`({}).m()`）；`__proto__: null` 的字面量是封闭成员集 ⇒ 缺席仍判；行号归因：真实抛点优先于 `({}).hasOwnProperty`（此前误指第 1 行）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
剩余效果 kind 不唯一 ⇒ 建议给门禁要求的族（Error），不是第一条 TypeError；照建议声明 ⇒ 诊断消失（建议可执行）；单 kind 场景仍给具体 kind（不无脑折成 Error）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
纯方法：两个 facet 都在场（此前完全缺席）；有副作用的方法：effectFree 不为 true（与函数字面量同结论）；读外层可变态的方法：closed 不为 true（与函数字面量同结论）；方法体只读 this：effectFree 仍为 true（读不是副作用）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
签名面打印 unknown（不是冻结的末次读值）；formatAbs（无损面）同口径；guard 只判 presence（不写必等式 ⇒ 不再恒假）；guard 放行自己的真实返回值（每次读都不同）；负控制：字面量访问器的读域照旧投影（Bug 191 口径不变）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
宿主 IEEE 见证：x = MIN_VALUE 时 x > 0 真而 x + 1 > 1 假；x > 0 ⊬ x + 1 > 1；x > 0 ⊬ x + 2 > 2；x > 0 ⊬ x + 0.5 > 0.5；x ≥ 0 ⊬ x + 1 > 1（非 strict 下界同样不足）；x > 0 ⊨ x + 1 >= 1（IEEE 恒真，section 明确要求仍成立）；x > 0 ⊬ x + 1 > 2（既非可证也不该被常量抵消造出来）；量级吸收：x > 1e-12 ⊬ x +	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
x > 0 ∧ y >= 1：x + y > 1 与 y + x > 1 都不可证；x > 0 ∧ y >= 1：x + y >= 1 与 y + x >= 1 都成立（对称性双向钉）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
x > 1 ∧ y > 1 ⊨ x + y > 2（拐点处和精确可表示）；x > 0 ∧ y > 0 ⊨ x + y > 0；x ≥ 1 ∧ y ≥ 1 ⊨ x + y ≥ 2（非严格线性判定不变）；x > 2 ⊨ 2 * x > 4（2 的幂缩放精确）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
逗号串 ⇒ 两个 kind 名（改前整串当**一个**名）；竖线 / 空白分隔同样拆分（与指令面同口径）；单个 kind / `*` / union 形态不受影响；与指令面 `@nudo:throws` 的切分口径一致（同一 spec 同一 kind 集）；端到端：侧车 `throws: "TypeError, RangeError"` 放行已申报的 TypeError（改前 L2 假红）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
number().min(1) / .max(1) / .length(1) 构造期抛错；boolean() / 结构型链上同样抛错（与 gt/ge/lt/le 同口径）；负控制：string() / array(...) 的长度链仍然可用	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
string().length(3)：两通道都判违例（'ab'）；string().length(3)：两通道都放行（'abc'）；array(...).min(3)：两通道都判违例（[1,2]）；array(...).min(3)：两通道都放行（[1,2,3]）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
数字字面量 × length(s) ≥ 1 ⇒ 不可判定（不是「满足」）；数字字面量 0 × length(s) ≥ 1 同样是「不可判定」（不是「违例」）；字符串字面量 × length(s) ≥ 1 ⇒ 按长度语义裁决；纯 var 左项的数值比较语义不变	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
数字实参：3 与 0 都不落进数值比较（0 不再假红）；字符串实参：参数位按长度语义裁决（'ab' 放行 / '' 违例）；与返回位同结论（字符串长度链：'ab' 两通道放行 / '' 两通道违例）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
对照（真红必须保留）：`x / 2` 在 x = 5e-324 处为 0 ⇒ 仍判违约；单元面：(x + x) / 2 的界是 > 0（不是被放松的 > -5e-324）；单元面：x * 2 / 2 与 (x + x) * 0.5 同结论（乘法路径同样补 attain）；单元面：x / 2 与 x * 0.5 保持 disproved（真界 ≥ 0，不可放松）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
对照（真红必须保留）：`Math.floor(x)` 在 x = 5e-324 处为 0 ⇒ 仍判违约；单元面：Math.ceil(x>0) 的下界是 1（此前是 0）；单元面：整数界触发（x > 5 ⇒ Math.ceil(x) ≥ 6），不依赖 denormal 推理；单元面：upper 侧同样做见证步进（x < 0 ⇒ Math.floor(x) ≤ -1）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
indexOf past the end returns -1；lastIndexOf past the end searches from the end	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
union(number().gt(0), number().gt(5)) ≤ number().gt(0)；三成员并集同样按成员判定（不因成员数而回退）；单个成员的 sum 与裸成员同判；反例：并集里含类型不符成员仍判红；反例：并集里含谓词不符成员仍判红（x<0 ⊄ x>0）；聚合体确实带顶层 pred 时仍参与判定（信息不丢）；目标侧并集语义不变：单成员 ≤ 并集	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
同一 Abs 引用：非域共享仍折 true，域共享折 undefined；契约类型数组的 xs[0] === xs[1] 不得删掉 false 臂；字面量数组（元素各自铸造、非域共享）仍精确判 diff	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
源码 @nudo:contract 在场 + 陈旧生成段 ⇒ 报 drift（旧口径零告警）；对照组（无源码契约）同样报 ⇒ 两面同结论（不再非单调）；生成段与今日域一致 ⇒ 零 drift（有源码契约时不误报）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
@nudo:mock Math 生效（宿主 Math.floor 不再应答）；@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）；env 全局仍受 skip 表约束（宿主内建名不被 env 遮蔽）；非 skip 名单上的 mock 名行为不变（fetch 对照组）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
try/catch 双侧 require：拿到 module.exports 本身（非命名空间）；普通 require 与可选 require 同口径（cjsMain ⇒ default 本体）；ESM 模块经可选 require 仍是命名空间（口径不变）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
try/catch 包裹的缺失 require：进 catch 臂；未被 catch 吸收的缺失 require：throws 面如实非 never（L2 不再少报）；存在模块的 require：不抛（对照组）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
Object.keys(TypeError + e.code) 折真实键集（改前 []）；Object.values / entries 同键集；JSON.stringify(TypeError + e.code) 折 {"code":42}（改前 "{}"）；Error 家族四面一致：keys / gOPN / gOPD / hasOwn 同键集同标志；Map 实例：keys 与 gOPN 都投影用户新增键（改前两面都折 []）；Date 实例：keys 与 gOPN 同样	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
export const a = 1, b = 2 ⇒ a 与 b 都是导出；多声明符的值正确（b = 2）；三个声明符全收；对照：独立声明 + 独立 export 只有 a 是导出（b 不是）；export function / export class 口径不变	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
互操作表：默认导入绑到命名空间 ⇒ 返回类型可推（不再是 unknown）；互操作表：默认导入与命名空间导入**同结论**（含 throws 面）；互操作表：AST env 绑定面（bindImports）同口径 ⇒ 绑到命名空间；负控制：普通用户模块表缺 default ⇒ 默认导入仍是 unknown；对照：普通用户模块表有 default ⇒ 默认导入绑到 default 槽；对照：互操作表即使带了物化 default 槽，也绑到 default 槽本身；物化 defa	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
length(NaN) / length(±Infinity) 在构造期抛错（不再造恒假契约）；错误文案点名 length() 与实际入参（Nudo 原生，非宿主原文）；合法界仍然通过（3 / 2.5 / 0）；产品面：契约里的 length(NaN) 变成侧车装载失败，不再对合法字符串报假红	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
length("3") / length(null) / length(true) 在构造期抛错；错误文案带引号地展示字符串界（got "3"），并点名 length()；产品面：length("3") 的契约不再静默失效（改前 0 error = 假绿）；对照组：合法数值界仍然产出真正的长度约束（length(3) 仍报违例）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
check 签名面的参数类型保留字面量（改前拓宽成 number）；负控制：裸 number 契约不被改成 lit(...)	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
合成**单条**合取（返回槽仍是单条）；违反**第 2 条**段也被执法（旧口径只执法第一条）；满足全部段时不报错；单条 return 段语义不变（名字不变、约束不变）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
termToString：bigint 保 n 后缀，number 不受影响；诊断文本：lit(10n) 与 lit(10) 可区分	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
产品面：顶层 env 全局重赋值 ⇒ checkSource 不抛；产品面：其它 env 全局（构造器 / Promise）同样不抛；整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断；判定层：prev 是裸宿主值 ⇒ 不抛、不报（fail-closed）；原生语义未变：重赋值后 g 就是 1；控制组：Abs↔Abs 的标量改型仍报 nudo:assign-mismatch（守卫未吃掉通道信号）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
eq(x,y) ⇒ le(x,y) ∧ ge(x,y)；eq(x,y) ⇒ eq(y,x)（对称）；eq(x,x) ⇒ le(x,x) ∧ ge(x,x)（重言式：x === x ⇒ x 非 NaN）；反向不成立：eq(x,y) ⇏ lt(x,y) ∧ gt(x,y)（等值不含严格序）；无关项不成立：eq(x,x) ⇏ le(x,y)；比较折叠：a === b 前提下 `a <= b` 折 true、`a < b` 折 false；产品面：a === b 分支内的 `a <=	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
env 名拼错（没解析出全局）⇒ 发 nudo:unknown-inference 警告；env 名拼错 ⇒ 不再发指错方向的 nudo:opaque-result 信息；对照组：没有 env 指令 ⇒ 仍然是 unknown-inference 警告（口径不变）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(-0) ⊭ lit(0)（Object.is(0, -0) === false）；lit(0) ⊭ lit(-0)（反向同样不满足）；NaN ≡ NaN（SameValue：=== 对 NaN 为 false，赋值同一性不可用 ===）；同值字面量仍可赋值（0 ≡ 0、1 ≡ 1、-1 ≡ -1）；不同字面量仍不可赋值（1 ⊭ 2）；case 期望面：实现给 +0、期望 -0 ⇒ 不是同一个值（service 层对账用的就是这个判定）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
single-quoted full form is parsed；single-quoted named form is parsed；mixed quote kinds are parsed (source and path may differ)；double-quoted form keeps working (control)；file-level extraction keeps the single-quoted record (was silently dro	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
见证只落在首个 declarator 上（不再重放到 b）；每个 declarator 只建一个 scope（不再多出 <anonymous> 影子）；第二个 declarator 的内联注释仍归它自己；单声明符形态不受影响（见证仍可见）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
真 @generated 标记 + 中间夹无关 const ⇒ 手写 export 不是生成段；夹的 const 若**被 export 引用** ⇒ 仍属段内（判据是引用，不是位置）；无标记 ⇒ 不是生成段（对照）；合法：别名段（DESIGN-003，段内夹 const）仍认得出；合法：组合式下行段（§5.3，段内夹 prelude const）仍认得出；合法：多步 prelude（中间量只被后一步引用）仍认得出；合法：头紧贴 export 仍认得出；合法：头 + impo	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(null) 契约收到 null ⇒ 放行（零诊断；改前是假红）；lit(undefined) 契约收到 undefined ⇒ 放行（零诊断；改前是假红）；lit(null) 契约收到 0 ⇒ 判违例，expected 指向 x = null；lit(null) 契约收到 'a' ⇒ 判违例；lit(undefined) 契约收到 0 ⇒ 判违例，expected 指向 x = undefined；null 与 undefined 是**两个域**：lit(null)	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
裸 lit(null)：契约**自身**是一条 eq 原子（无成员）；裸 lit(undefined)：契约**自身**是一条 eq 原子（无成员）；nullable(number())：nullish 是**成员**（members[]），不是契约自身；union(lit(null), number())：nullish 是**成员**（members[]），不是契约自身	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
行注释里**提到** @generated ⇒ 不是生成标记；块注释里**提到** @generated ⇒ 不是生成标记；注释**以** @generated 开头但不是 nudo 的段头 ⇒ 不是生成标记；代码行尾的 @generated ⇒ 不是生成标记（标记必须是独立行）；nudo 段头（完整形）⇒ 是生成标记；nudo 段头（短形 `— do not edit`）⇒ 是生成标记；nudo 段头（最短形 `by nudo`）⇒ 是生成标记；手写契约（无任何标记）⇒ 不	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
export default function calc + 具名侧车 ⇒ 调用点报违例；export { calc as default } + 具名侧车 ⇒ 调用点报违例；侧车写 export default fn(…) ⇒ 仍然执法（不回归）；具名导入（对照）⇒ 仍然执法	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
★ `f(x = -5)` + 契约 x > 0 + 零实参调用 ⇒ 报违例（改前零诊断）；★ 顶层零实参调用同样执法（作用域不再决定裁决）；负控制：默认值满足契约（`x = 5`）⇒ 不报违例；对照：显式传违约实参 ⇒ 照常报违例（既有路径没被弄坏）；负控制：**无默认值**的形参 + 零实参调用 ⇒ 不发明违例（缺参是另一条缺陷）；负控制：解构默认值（`{ port = 3000 } = {}`）⇒ 不发明违例；默认值位对齐：第二个形参有默认值 ⇒ 按形参位补齐（不串位）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
arr 形参（收割的 T[]）× tuple 实参（数组字面量）⇒ α 绑定（不再落 any）；同 kind 臂仍排在前：arr 形参 × arr 实参 仍绑出元素类型（既有 deep-α 用例的护栏）；tuple 形参 × arr 实参 ⇒ 各槽绑 arr 的元素类型；空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）；非数组 kind 仍不绑（prim 形参 × prim 实参：无 α 可绑）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
域隶属单元层：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 值域已放开）；标量位：f(2n) 报违例、f(1n) 放行（S6 已落，不得回退）；字段位：f({ v: 2n }) 报违例、f({ v: 1n }) 放行（915 延伸）；元素位：f([2n]) 报违例、f([1n]) 放行（915 延伸）；三向对照：同一份 lit(1n) 契约在三个位置的裁决条数一致；union 成员位：域外 bigint 报违例、域内 bigint 放行；既有裁决不得回退：nu	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
lit(0) 接受 -0、lit(-0) 接受 0（=== 口径，与标量实参位一致）；lit(0) 不接受 1 / -1（不因统一口径而漏判）；lit(NaN) 接受 NaN（NaN 特例；=== 对 NaN 为 false）；字段位 / 数组元素位的 -0 不再报违例（同一执法路径一种裁决）；字段位 / 数组元素位真正违约仍报（不放宽过头）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
分母恒负 ⇒ 0 / x 折 -0（原生 0 / -5 = -0）；分母恒负 ⇒ 1 / (0 / x) 折 -Infinity（原生 -Infinity）；分母恒正 ⇒ 仍折 +0 / +Infinity（原生口径不变）；分母符号不可证（可能为 0 / 两侧都有界）⇒ 不折字面量（保守）；issue #170 既有口径不回归：x >= 0 ∧ x ≠ 0 ⇒ 折 +0 字面量；numericBounds 的符号侧：x < 0 ⇒ hi 严格 0（分母恒负可判）	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
0 / x（x < 0）⇒ 引擎折 -0（改前折 +0）；1 / (0 / x)（x < 0）⇒ 引擎折 -Infinity（改前折 +Infinity）；分母恒正 ⇒ 端到端仍是 +0 / +Infinity	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
`export { a } from './m.js'`：来源不可达时不产生任何导出槽；`export { default } from './m.js'`：来源不可达时 default 槽必须缺席；`export { default as d } from './m.js'`：来源不可达时不产生任何导出槽；`export * as ns from './m.js'`：来源不可达时不产生任何导出槽；`export * from './m.js'`：来源不可达时不产生任何导出槽	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
%s ⇒ 与原生 Object.is 一致	algebra-numbers 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence

存在 export namespace 时无关函数仍是精确值（改前 unknown）	dup:algebra-numbers 聚合矩阵	commit:25008108
顶层常量导出同样不退化	dup:algebra-numbers 聚合矩阵	commit:25008108
check 面的问题集合与无 namespace 的同一模块一致（不再假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
变量键查找 map[k]（any #path）⇒ 零违例（改前假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
any 形参作实参 ⇒ 零违例（与 any #path 同口径）	dup:algebra-numbers 聚合矩阵	commit:25008108
null 字面量放行（434 不回归）	dup:algebra-numbers 聚合矩阵	commit:25008108
0 字面量仍判违例，expected 指向 x = null	dup:algebra-numbers 聚合矩阵	commit:25008108
返回位：x 的谓词已证明落在 union 内（status）⇒ 零 error	dup:algebra-numbers 聚合矩阵	commit:25008108
返回位：同 prim **字符串**字面量 union 同样不得假红	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：返回值确定不在 union 内 ⇒ 仍报 error（整体蕴含不放宽确定违约）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：值域宽于 union（x 只是裸 number）⇒ 仍是 error	dup:algebra-numbers 聚合矩阵	commit:25008108
非字面量返回值（x + 0.5）不再假绿：出 unproven-return warning、无 error	dup:algebra-numbers 聚合矩阵	commit:25008108
整性可从前提传导：x 声明为 int ⇒ `return x` 证得、零诊断	dup:algebra-numbers 聚合矩阵	commit:25008108
整数字面量返回照旧放行	dup:algebra-numbers 聚合矩阵	commit:25008108
小数返回照旧是 error（字面量特判不回归）	dup:algebra-numbers 聚合矩阵	commit:25008108
值域只是裸 number（无整性证据）⇒ 出 unproven-return warning（改前静默 proved）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：整数算术（x + 1，x 为 int）**不得**变成假红（整性不可判定 ⇒ warning 不上 error）	dup:algebra-numbers 聚合矩阵	commit:25008108
static method returns its value	dup:algebra-numbers 聚合矩阵	commit:25008108
instance method still returns its value	dup:algebra-numbers 聚合矩阵	commit:25008108
class value itself stays a class signature	dup:algebra-numbers 聚合矩阵	commit:25008108
非 number 字面量不得被认成原字面量（此前 `"abc" - 0` ⇒ `"abc"`）	dup:algebra-numbers 聚合矩阵	commit:25008108
boolean / null / 数字字符串走 ToNumber	dup:algebra-numbers 聚合矩阵	commit:25008108
bigint 混型保留原项（原生 TypeError，不得折成字面量）	dup:algebra-numbers 聚合矩阵	commit:25008108
number 字面量仍可化简（`5 - 0` ⇒ 5）	dup:algebra-numbers 聚合矩阵	commit:25008108
非字面量项保持 number 路径化简（`x - 0` ⇒ x）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：`x * 1` 的既有域守卫不变（`"abc" * 1` ⇒ NaN，不得留 string）	dup:algebra-numbers 聚合矩阵	commit:25008108
x = 42 ∧ x ∈ {43,44} → nudo:contract-conflict error + exit≠0	dup:algebra-numbers 聚合矩阵	commit:25008108
平铺字面量同款矛盾 → error（两种拼写同结论）	dup:algebra-numbers 聚合矩阵	commit:25008108
有限集有交集（x = 42 ∧ x ∈ {42,43}）→ 不报矛盾	dup:algebra-numbers 聚合矩阵	commit:25008108
union(lit(1), lit(2), lit(3)) ⇒ `1 | 2 | 3`（不是 `number`）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：裸 number 契约仍是 `number`	dup:algebra-numbers 聚合矩阵	commit:25008108
analyzer round 之后 check 闸门仍读到 1（不接续上一轮的活状态）	dup:algebra-numbers 聚合矩阵	commit:25008108
字节相同的第二个文件不共用实例（各自 1，不是 2/3）	dup:algebra-numbers 聚合矩阵	commit:25008108
同一文件重复分析也是新一轮（每次 1）	dup:algebra-numbers 聚合矩阵	commit:25008108
IIFE with unconditional throw	dup:algebra-numbers 聚合矩阵	commit:25008108
top-level call to a function that always throws	dup:algebra-numbers 聚合矩阵	commit:25008108
top-level member access on a nullish const	dup:algebra-numbers 聚合矩阵	commit:25008108
top-level JSON.parse of an invalid literal	dup:algebra-numbers 聚合矩阵	commit:25008108
class static block with unconditional throw	dup:algebra-numbers 聚合矩阵	commit:25008108
typeof missing identifier is safe (not a ReferenceError)	dup:algebra-numbers 聚合矩阵	commit:25008108
conditional / optional access is not definite	dup:algebra-numbers 聚合矩阵	commit:25008108
宿主 IEEE 见证：fl(MIN_VALUE + 1) === 1 但 x ≠ 0	dup:algebra-numbers 聚合矩阵	commit:25008108
x + 1 === 1 ⊬ x === 0（吸收型加法；反例 x = MIN_VALUE）	dup:algebra-numbers 聚合矩阵	commit:25008108
x + 1 === 1 ⊬ x >= 0（同一前像区间不得收成单点）	dup:algebra-numbers 聚合矩阵	commit:25008108
x - 1 === -1 ⊬ x === 0（减法同源；反例 x = -5e-324）	dup:algebra-numbers 聚合矩阵	commit:25008108
x + 1e6 === 1e6 ⊬ x === 0（量级吸收：解集 |x| ≤ ½ulp(1e6)）	dup:algebra-numbers 聚合矩阵	commit:25008108
3 * x === 1 ⊬ x === 1/3（系数非 2 的幂；反例 0.33333333333333337）	dup:algebra-numbers 聚合矩阵	commit:25008108
不等式同源：x + 1 >= 1 ⊬ x >= 0（反例 x = -5e-324）	dup:algebra-numbers 聚合矩阵	commit:25008108
乘法不等式：3 * x <= 1 ⊬ x <= 1/3（反例 0.33333333333333337）	dup:algebra-numbers 聚合矩阵	commit:25008108
2 * x === 4 ⊨ x === 2（2 的幂缩放无舍入）	dup:algebra-numbers 聚合矩阵	commit:25008108
x === 5 ⊨ x === 5 / x >= 5（纯原子事实仍是点）	dup:algebra-numbers 聚合矩阵	commit:25008108
x + 1 === 0 仍可取到 x = -1 的下界（前像不含正区间）	dup:algebra-numbers 聚合矩阵	commit:25008108
契约 + 冲突默认值 ⇒ 报错（修复前：OK / exit 0）	dup:algebra-numbers 聚合矩阵	commit:25008108
签名如实反映默认值参与定义域（`number | "abc"`）	dup:algebra-numbers 聚合矩阵	commit:25008108
合法形态保持绿：默认值落在契约域内（`s = 1` + `number()`）	dup:algebra-numbers 聚合矩阵	commit:25008108
无契约路径行为不变（默认值不参与，零报错）	dup:algebra-numbers 聚合矩阵	commit:25008108
.d.ts 可省性的事实来源保留：契约路径下 formals 仍是 default/optional	dup:algebra-numbers 聚合矩阵	commit:25008108
`_` / rest 之外的默认形参也走同一口径（`a`, `b = 2`）	dup:algebra-numbers 聚合矩阵	commit:25008108
通用侧车 opts 口径（marker）与 makeFiles 口径一致	dup:algebra-numbers 聚合矩阵	commit:25008108
没有循环的函数上声明不变式 ⇒ 零 invariant-relied（旧口径无条件报）	dup:algebra-numbers 聚合矩阵	commit:25008108
循环里真正实施了不变式 ⇒ 仍有 invariant-relied	dup:algebra-numbers 聚合矩阵	commit:25008108
不变式指向的绑定在循环里不存在 ⇒ 不归因	dup:algebra-numbers 聚合矩阵	commit:25008108
顶层形参：`lit(3)` ⇒ `3`（不是 `lit(3)`）	dup:algebra-numbers 聚合矩阵	commit:25008108
对象判别槽：`kind: lit("a")` ⇒ `{ kind: "a", n: number }`	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：无数值界契约的渲染不变（`number` 仍是 `number`）	dup:algebra-numbers 聚合矩阵	commit:25008108
同项事实 `x+1 > nextDown(1)` ⇒ 义务 `x+1 >= 1`（IEEE 下恒真）	dup:algebra-numbers 聚合矩阵	commit:25008108
同项事实 ⇒ 更弱的义务同样成立（ge / gt nextDown(1)）	dup:algebra-numbers 聚合矩阵	commit:25008108
反向不成立：`x+1 > nextDown(1)` ⇏ `x+1 > 1`（严格差一格不够）	dup:algebra-numbers 聚合矩阵	commit:25008108
严格事实才步进一格：非严格事实 `x+1 >= nextDown(1)` ⇏ `x+1 >= 1`	dup:algebra-numbers 聚合矩阵	commit:25008108
保真控制：吸收型累加仍证不出 `x+y > 1`（fl(MIN + 1) === 1）	dup:algebra-numbers 聚合矩阵	commit:25008108
保真控制：同项格点步进不越界（`x >= 5` ⇏ `x > 5`）	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：侧车契约 `return number().ge(1)` 不再假红（nudo:constraint-violated）	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面控制组：真违约仍报（`x >= 0` ⇒ `x + 1 >= 2` 不成立）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(1n) 契约收到 2 ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(1n) 契约收到 1 ⇒ 判违例（1 ≠ 1n：number 与 bigint 是两个域）	dup:algebra-numbers 聚合矩阵	commit:25008108
union(lit(1n), lit(2n)) 收到 2 ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：lit(1)（number 字面量）收到 2 ⇒ 判违例（既有行为不回退）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(1n) 收到 2n ⇒ 判违例（改前 0 违例 = 假绿：实参取不到）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(2n) 收到 1n ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
union(lit(1n), lit(2n)) 收到 3n ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：lit(1n) 收到 1n ⇒ 放行（取到实参且满足契约）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：union(lit(1n), lit(2n)) 收到 1n ⇒ 放行	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：union(lit(1n), lit(2n)) 收到 2n ⇒ 放行（2n 落在 union 域内）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：lit(-1n) 收到 -1n ⇒ 放行（负 bigint 是 UnaryExpression(-)+BigIntLiteral）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：lit(-1n) 收到 1n ⇒ 判违例（负 bigint 也取到了）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：没有契约的形参收到 1n ⇒ 零违例（违例来自契约，不是引擎噪声）	dup:algebra-numbers 聚合矩阵	commit:25008108
无 param-mismatch	dup:algebra-numbers 聚合矩阵	commit:25008108
调用点的负参违例照旧执法（跨模块 L1 扫描）	dup:algebra-numbers 聚合矩阵	commit:25008108
不报 param-mismatch（点路径名在契约面内）	dup:algebra-numbers 聚合矩阵	commit:25008108
点路径实参义务照旧执法	dup:algebra-numbers 聚合矩阵	commit:25008108
宿主 IEEE 见证：[0.1]*6 ≠ 0.1+0.1+0.1+0.1+0.1+0.1	dup:algebra-numbers 聚合矩阵	commit:25008108
x >= 0 ⊬ x * 6 <= x+x+x+x+x+x（抛臂可达）	dup:algebra-numbers 聚合矩阵	commit:25008108
x >= 0 ⊬ x * 6 >= x+x+x+x+x+x（对称方向同样不得证出）	dup:algebra-numbers 聚合矩阵	commit:25008108
x >= 0 ⊬ x * 6 === x+x+x+x+x+x	dup:algebra-numbers 聚合矩阵	commit:25008108
宿主 IEEE 见证：(1+1)+1/3 > 1+(1+1/3)	dup:algebra-numbers 聚合矩阵	commit:25008108
a,b,c > 0 ⊬ (a+b)+c <= a+(b+c)	dup:algebra-numbers 聚合矩阵	commit:25008108
a,b,c > 0 ⊬ (a+b)+c >= a+(b+c)（反向亦然）	dup:algebra-numbers 聚合矩阵	commit:25008108
2 * x 与 x + x 都是精确加倍 ⇒ x > 0 ⊨ 2x <= x+x	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 1 ∧ assumeFinite(x) 下 2 * x 与 x + x 仍同形	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(-0) 渲染成 lit(-0)，不是 lit(0)	dup:algebra-numbers 聚合矩阵	commit:25008108
字段位（shape）保真：侧车回显与字段契约同源	dup:algebra-numbers 聚合矩阵	commit:25008108
函数契约整体保真（参数位 + 返回位）	dup:algebra-numbers 聚合矩阵	commit:25008108
lengthBound 的常数界渲染同款口径（.length(-0)）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：正零仍是 0（不得把 0 渲成 -0）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：其它字面量形态不受牵连（bigint 的 n 后缀 / 字符串 / 布尔）	dup:algebra-numbers 聚合矩阵	commit:25008108
原生事实：-0 与 0 确实可观察不同（Object.is / 1/x）	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器做算术 ⇒ 方法入口不再报 nudo:entry-may-throw（改前：error 级 1 条）	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器做比较 / 字符串拼接 / 成员调用 ⇒ 同上（都只算构造器的账）	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器显式 throw ⇒ 也不归因给方法（那是 `new C()` 入口的事）	dup:algebra-numbers 聚合矩阵	commit:25008108
方法体**自己**会抛 ⇒ 仍要报（闸门不整体关掉）	dup:algebra-numbers 聚合矩阵	commit:25008108
方法体读构造器写入的字段（any）⇒ 成员调用仍报（构造器仍要跑）	dup:algebra-numbers 聚合矩阵	commit:25008108
静态方法口径不变（静态桥不跑构造器 ⇒ 它自己的算术照报）	dup:algebra-numbers 聚合矩阵	commit:25008108
单元层：实例方法的 throws 域不含构造器的 TypeError	dup:algebra-numbers 聚合矩阵	commit:25008108
单元层：方法体自己的 throw 仍在 throws 域里	dup:algebra-numbers 聚合矩阵	commit:25008108
转译产物里 async generator 体内没有裸 yield（修前：`(yield …)` ⇒ 非法 JS）	dup:algebra-numbers 聚合矩阵	commit:25008108
整模块不再 fail-closed：其它导出的 L2 门禁仍触发（修前：诊断消失 ⇒ 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
其它导出的签名不退化 unknown（修前：risky 退成 `risky() => unknown`）	dup:algebra-numbers 聚合矩阵	commit:25008108
无假 nudo:opaque-result（修前：整模块 unknown ⇒ 假 opaque 诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
async generator 自身的产出仍正确（for-await 累加精确 7）	dup:algebra-numbers 聚合矩阵	commit:25008108
async generator 声明仍是 AsyncGenerator 协议（next() 返 promise）	dup:algebra-numbers 聚合矩阵	commit:25008108
export default async function* 形态：整模块不再 fail-closed	dup:algebra-numbers 聚合矩阵	commit:25008108
嵌套声明形态（函数体内的 async function*）：整模块不再 fail-closed	dup:algebra-numbers 聚合矩阵	commit:25008108
同步 generator 声明：体里的 yield 仍走 $yield（不是 $await）	dup:algebra-numbers 聚合矩阵	commit:25008108
async **函数**（非 generator）声明：await 仍发射裸 yield（真挂起点）	dup:algebra-numbers 聚合矩阵	commit:25008108
async generator **表达式**面（兄弟路径）不受影响：await 走 $await	dup:algebra-numbers 聚合矩阵	commit:25008108
new Uint8ClampedArray([1.5])[0] ⇒ 2（native：2；修前：1）	dup:algebra-numbers 聚合矩阵	commit:25008108
new Uint8ClampedArray([3.5])[0] ⇒ 4（native：4；修前：3）	dup:algebra-numbers 聚合矩阵	commit:25008108
就近偶数（tie → 偶数）：2.5 ⇒ 2、4.5 ⇒ 4、0.5 ⇒ 0（native 同款）	dup:algebra-numbers 聚合矩阵	commit:25008108
非 tie 值照旧四舍五入：1.4 ⇒ 1、1.6 ⇒ 2（native 同款）	dup:algebra-numbers 聚合矩阵	commit:25008108
边界：300 ⇒ 255、-1 ⇒ 0（native 同款）	dup:algebra-numbers 聚合矩阵	commit:25008108
整数 TA 仍是向零截断：new Int8Array([1.5])[0] ⇒ 1（native：1）	dup:algebra-numbers 聚合矩阵	commit:25008108
浮点 TA 不钳位：new Float64Array([1.5])[0] ⇒ 1.5（native：1.5）	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器抛 + 方法体 total ⇒ 方法签名仍是 "acct"（不是 unknown）	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器抛 ⇒ 不产生误导的 nudo:opaque-result	dup:algebra-numbers 聚合矩阵	commit:25008108
构造器**不**抛时行为不变（方法签名照常）	dup:algebra-numbers 聚合矩阵	commit:25008108
Φ 被消费 ⇒ 记账 + 归因可见（账本是活写，不依赖调用方传快照）	dup:algebra-numbers 聚合矩阵	commit:25008108
只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）	dup:algebra-numbers 聚合矩阵	commit:25008108
既未记账、也非 Φ 命中 ⇒ 不归因（不得把没消费过的公理报成 relied）	dup:algebra-numbers 聚合矩阵	commit:25008108
账本里是**别的**前提（对象身份不同）⇒ 不归因（防按位置误配）	dup:algebra-numbers 聚合矩阵	commit:25008108
证明不成立（unprovable / disproved）⇒ 不报 relied（归因只对已证义务）	dup:algebra-numbers 聚合矩阵	commit:25008108
d1(undefined)（x = 5，契约 x > 0）⇒ 零诊断（默认值 5 满足契约）	dup:algebra-numbers 聚合矩阵	commit:25008108
默认值本身违约时仍要报（d2(undefined)，x = -5，契约 x > 0）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：没有默认值的形参收 undefined ⇒ 仍按 undefined 执法（报 typeof 违例）	dup:algebra-numbers 聚合矩阵	commit:25008108
string().int() 抛错（不再暴露到非数值 builder）	dup:algebra-numbers 聚合矩阵	commit:25008108
boolean().int() 抛错	dup:algebra-numbers 聚合矩阵	commit:25008108
lit('a') 根本不带 int 方法（非数值字面量链无法产出分裂约束）	dup:algebra-numbers 聚合矩阵	commit:25008108
number().int() 仍然可用（负控制）	dup:algebra-numbers 聚合矩阵	commit:25008108
域面 / Abs 面口径一致：非数值链上不存在 int 约束	dup:algebra-numbers 聚合矩阵	commit:25008108
数值链的 Abs 面仍带整性编码（Bug 342 语义不回归）	dup:algebra-numbers 聚合矩阵	commit:25008108
纯数据约束（非 number prim）不再产出整性 pred（两面一致）	dup:algebra-numbers 聚合矩阵	commit:25008108
boolean().gt(1) 抛错（恒假契约 ⇒ 假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
string().gt(1) 抛错（恒假契约 ⇒ 假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
string().length(-3) 抛错（恒假契约 ⇒ 假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：既有的有限界护栏口径不变（length(2.5) 仍合法，Bug 336 钉住）	dup:algebra-numbers 聚合矩阵	commit:25008108
array(1, 2) 抛错（多余实参不再被静默丢弃）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：合法用法仍然可用（number().gt(0) / string().min(1) / array(number())）	dup:algebra-numbers 聚合矩阵	commit:25008108
原生 oracle：早返回形态在 x=NaN 时返回 NaN（违反 nonNeg）	dup:algebra-numbers 聚合矩阵	commit:25008108
早返回形态不得静默（0 诊断 = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
早返回形态与三元写法结论一致（同一契约 ⇒ 同一诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
同族形态：`positive` 家族（x <= 0 ⇒ 返回 1）不得静默	dup:algebra-numbers 聚合矩阵	commit:25008108
同族形态：`max100` 家族（x > 100 ⇒ 返回 100）不得静默	dup:algebra-numbers 聚合矩阵	commit:25008108
同族形态：if/else 写法（else 臂 = 后续路径）不得静默	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：事实臂的关系窄化**保留**（x >= 0 ⇒ return x 满足 nonNeg ⇒ 0 诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：三元写法的结论不变（既有的 unproven-return / 违约面不得被削弱）	dup:algebra-numbers 聚合矩阵	commit:25008108
字面量分支（eq/or 路径事实把值钉在违规字面量上）⇒ error	dup:algebra-numbers 聚合矩阵	commit:25008108
声明域参数的裸返回（x: num vs positive）⇒ error	dup:algebra-numbers 聚合矩阵	commit:25008108
补集臂 NaN 面（三元写法，else 臂含 NaN ⊭ nonNeg）⇒ error	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：派生项（值域未被跟踪）⇒ 证不出（warning），不得当违约	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：无 term 的派生项 ⇒ 证不出（warning）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：有界证据（守卫 x >= 0 vs positive）⇒ 仍是 error	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：字面量返回按域隶属判违约（0 ⊭ positive）⇒ error	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：可证合规的函数不得被误判（守卫 x >= 0 + nonNeg ⇒ 0 诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
类入口清单含 `export default C`（修前：空清单）	dup:algebra-numbers 聚合矩阵	commit:25008108
导出形态覆盖齐全（回归护栏：其余三种形态不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
端到端：构造器必抛必须报在类入口上（修前：零诊断 ⇒ 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
端到端：构造器不抛 ⇒ 零 L2（不凭空造诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
侧车参数位 + 返回位 lit(NaN) ⇒ 不报 nudo:contract-conflict	dup:algebra-numbers 聚合矩阵	commit:25008108
源码指令位 lit(NaN) ⇒ 不报 nudo:contract-conflict	dup:algebra-numbers 聚合矩阵	commit:25008108
真矛盾（and(lit(1), lit(2))）⇒ 仍报 nudo:contract-conflict（闸门不得变假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
不同字面量（lit(1) ∧ lit(2)）跨约束 ⇒ 仍报 conflict（不得放宽真矛盾）	dup:algebra-numbers 聚合矩阵	commit:25008108
autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿	dup:algebra-numbers 聚合矩阵	commit:25008108
autoBind:false ⇒ 不探测 ambient 侧车（ambient 绑定无资格 ⇒ 不读盘）	dup:algebra-numbers 聚合矩阵	commit:25008108
真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）	dup:algebra-numbers 聚合矩阵	commit:25008108
autoBind 开启且 ambient 侧车确实被绑定 ⇒ 仍报 nudo:contract-load（真故障不被吞）	dup:algebra-numbers 聚合矩阵	commit:25008108
autoBind 开启但 ambient 侧车**没被用到** ⇒ 探测失败也不该让门禁变红	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 2 个 await：caller 恢复后读到 callee 的终值（原生 "1,2,3"）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 3 个 await：caller 恢复后读到 callee 的终值（原生 "1,2,3,4"）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 2 个 await 后写 flag：caller 读到 flag=1（原生 1）	dup:algebra-numbers 聚合矩阵	commit:25008108
return await <2-await callee>：值域是 callee 终值（原生 7）	dup:algebra-numbers 聚合矩阵	commit:25008108
嵌套 return await <2-await callee>：值域是 callee 终值（原生 3）	dup:algebra-numbers 聚合矩阵	commit:25008108
体 return <2-await callee 的 promise>：兑现值是 callee 终值（原生 7）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 2 个 await 后拒绝：caller 的 catch 臂可达（原生 "caught"）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 2 个 await 后拒绝：caller 的 promise 确定拒绝（原生：reject）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：callee 只有 1 个 await 时行为不变（原生 "1,2"）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：callee 无 await 时行为不变（原生 "1,2"）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：caller 2 个 await、callee 1 个 await（原生 6）	dup:algebra-numbers 聚合矩阵	commit:25008108
同步窗口口径：caller 的 await 之后的副作用不进同步窗口（原生 "1"）	dup:algebra-numbers 聚合矩阵	commit:25008108
求值面（export / test 路径同款）：await 2-await callee 后的 cache 是 "warm"	dup:algebra-numbers 聚合矩阵	commit:25008108
readCache：await 2-await callee 后的 cache 仍是 "warm"	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 2 个 await 后拒绝：caller 的 promise 面是 never（与 1-await 同口径）	dup:algebra-numbers 聚合矩阵	commit:25008108
原生 oracle：可选参数之后的必选参数 ⇒ 少传就炸	dup:algebra-numbers 聚合矩阵	commit:25008108
(a = 1, b) ⊭ 单参目标（最小实参元数 = 2）	dup:algebra-numbers 聚合矩阵	commit:25008108
(a = 1, b) ⩽ 双参目标（目标给够两个 ⇒ 可赋值）	dup:algebra-numbers 聚合矩阵	commit:25008108
既有口径不变：(a, b = 1) ⩽ 单参目标（必选只有 a）	dup:algebra-numbers 聚合矩阵	commit:25008108
可选参数之后的必选参数算进最小元数：(a, b = 1, c) ⇒ 最小 3	dup:algebra-numbers 聚合矩阵	commit:25008108
rest 吸收多余实参：(a, ...rest) ⇒ 最小 1	dup:algebra-numbers 聚合矩阵	commit:25008108
缺省标记时回退名字后缀判据：可选位在**前**也算必选位之后 ⇒ 最小 2	dup:algebra-numbers 聚合矩阵	commit:25008108
端到端：把 (a = 1, b) 赋给「只需 1 个实参」的 fn ⇒ assign-mismatch（修前：静默）	dup:algebra-numbers 聚合矩阵	commit:25008108
域隶属口径：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 与 number 不混同）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 违约（返回 2n）⇒ 调用方不得被声明面「证得」（假绿回归）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 违约（返回 2n）⇒ 调用方的返回面是真实值 2n，不是声明面	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 守约（返回 1n）⇒ 调用方零诊断（不得新增诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
callee 守约（返回 1n）⇒ 调用方的返回面保留推断精度 1n	dup:algebra-numbers 聚合矩阵	commit:25008108
(a) 冷跑：引理被消费 ⇒ nudo:assume-relied = 1，返回契约证得	dup:algebra-numbers 聚合矩阵	commit:25008108
(b) 清 check memo（L0 仍在）后重跑 ⇒ relied 仍为 1（不得跳过账本回填）	dup:algebra-numbers 聚合矩阵	commit:25008108
(c) 只改无关兄弟函数（per-fn 指纹不变 ⇒ 仅 L0 可能命中）⇒ relied 仍为 1	dup:algebra-numbers 聚合矩阵	commit:25008108
(d) 无种子 generalize 先行（L0 里是无引理 PolyFn）⇒ 随后 check 仍 relied=1，且不误报 unproven	dup:algebra-numbers 聚合矩阵	commit:25008108
(e) check 之后无种子 generalize 与冷跑逐字一致（折后界不得经 L0 泄漏）	dup:algebra-numbers 聚合矩阵	commit:25008108
(f) 负控制：去掉引理行 ⇒ 无 relied，返回义务诚实未证（与冷跑同一 issue 面）	dup:algebra-numbers 聚合矩阵	commit:25008108
(g1) 无种子 generalize 先行 ⇒ 随后 check 仍 invariant-relied=1 且未证不误报	dup:algebra-numbers 聚合矩阵	commit:25008108
(g2) check 之后无种子 generalize 与冷跑逐字一致（invariant 折后界不得泄漏）	dup:algebra-numbers 聚合矩阵	commit:25008108
helper 里的不支持构造 ⇒ 调用它的入口 f 拿 L2；兄弟入口 safe 仍是 0	dup:algebra-numbers 聚合矩阵	commit:25008108
两级 helper 链 ⇒ 传递闭包把构造归因到入口 f	dup:algebra-numbers 聚合矩阵	commit:25008108
互递归 helper：闭包收敛（不挂死）且仍把环后的构造归因到入口 f	dup:algebra-numbers 聚合矩阵	commit:25008108
类入口 C：构造器里的不支持构造 ⇒ 整个类入口 C 拿 L2	dup:algebra-numbers 聚合矩阵	commit:25008108
类方法入口 C.m：构造器里的不支持构造也归因（实例桥要跑构造器）	dup:algebra-numbers 聚合矩阵	commit:25008108
类方法入口 C.m：**其它**方法的构造不归因（不是它的执行路径）	dup:algebra-numbers 聚合矩阵	commit:25008108
CJS exports.f = function …：入口形态可识别（改前：零 error）	dup:algebra-numbers 聚合矩阵	commit:25008108
CJS module.exports.f = 箭头 / module.exports = { f: … }：同口径	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：没人引用的 helper 里的构造 ⇒ 入口 f 仍是 0，ok 与干净模块一致	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：只有不可达的类里含构造 ⇒ 入口 f 是 0	dup:algebra-numbers 聚合矩阵	commit:25008108
正控：构造可达的类（f → helper → new K()）⇒ K 构造器里的构造归因到 f	dup:algebra-numbers 聚合矩阵	commit:25008108
干净模块对照：零 L2（不因归因扩面而假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
new Date(0) 撞 number().gt(0) ⇒ 文案是 typeof 义务	dup:algebra-numbers 聚合矩阵	commit:25008108
箭头字面量撞 string() ⇒ 文案是 typeof x = "string"	dup:algebra-numbers 聚合矩阵	commit:25008108
new Date(0) 撞 shape({ id }) ⇒ 报 missing field（不是 object shape 假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：顶层调用与函数体内调用同口径（同一实参、同一契约同条数）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：没有契约的形参收到非标量字面量 ⇒ 零诊断（噪声来自契约，不是引擎）	dup:algebra-numbers 聚合矩阵	commit:25008108
顶层无条件 throw ⇒ 1 条 error（改前：零诊断 + ok=true）	dup:algebra-numbers 聚合矩阵	commit:25008108
裸块 { throw } 无条件下钻 ⇒ 报（loc 指向 throw 而非块首）	dup:algebra-numbers 聚合矩阵	commit:25008108
多个入口 / 入口前后的 throw ⇒ **一条**模块级诊断（不按入口重复）	dup:algebra-numbers 聚合矩阵	commit:25008108
CJS 入口形态同样覆盖（exports.f 后顶层 throw）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：条件抛（未知宿主守卫）⇒ 不报，行为逐字不变	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：try/catch 吸收的 throw ⇒ 模块可正常装载，不报	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：函数体内的 throw 不是装载期抛（L2 entry-may-throw 负责）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控：不抛的模块 ⇒ 零诊断 / ok（不假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
FP 锚点缩形：引擎近似抛（原生可装载）⇒ **不报**	dup:algebra-numbers 聚合矩阵	commit:25008108
确定性句法抛（JSON.parse 坏字面量 / null 成员）⇒ 报 module-throw	dup:algebra-numbers 聚合矩阵	commit:25008108
真实包锚点缩形：React Server 入口 stub（确定要抛）⇒ 报 Error	dup:algebra-numbers 聚合矩阵	commit:25008108
抑制口径：entryThrows off 关闸 / warning 降档 / ignore-throws 按类型放行	dup:algebra-numbers 聚合矩阵	commit:25008108
原型链上的成员（toString / hasOwnProperty）不得当「确定缺席」	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：own 键缺席仍判（`({}).m()`）	dup:algebra-numbers 聚合矩阵	commit:25008108
`__proto__: null` 的字面量是封闭成员集 ⇒ 缺席仍判	dup:algebra-numbers 聚合矩阵	commit:25008108
行号归因：真实抛点优先于 `({}).hasOwnProperty`（此前误指第 1 行）	dup:algebra-numbers 聚合矩阵	commit:25008108
剩余效果 kind 不唯一 ⇒ 建议给门禁要求的族（Error），不是第一条 TypeError	dup:algebra-numbers 聚合矩阵	commit:25008108
照建议声明 ⇒ 诊断消失（建议可执行）	dup:algebra-numbers 聚合矩阵	commit:25008108
单 kind 场景仍给具体 kind（不无脑折成 Error）	dup:algebra-numbers 聚合矩阵	commit:25008108
纯方法：两个 facet 都在场（此前完全缺席）	dup:algebra-numbers 聚合矩阵	commit:25008108
有副作用的方法：effectFree 不为 true（与函数字面量同结论）	dup:algebra-numbers 聚合矩阵	commit:25008108
读外层可变态的方法：closed 不为 true（与函数字面量同结论）	dup:algebra-numbers 聚合矩阵	commit:25008108
方法体只读 this：effectFree 仍为 true（读不是副作用）	dup:algebra-numbers 聚合矩阵	commit:25008108
签名面打印 unknown（不是冻结的末次读值）	dup:algebra-numbers 聚合矩阵	commit:25008108
formatAbs（无损面）同口径	dup:algebra-numbers 聚合矩阵	commit:25008108
guard 只判 presence（不写必等式 ⇒ 不再恒假）	dup:algebra-numbers 聚合矩阵	commit:25008108
guard 放行自己的真实返回值（每次读都不同）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：字面量访问器的读域照旧投影（Bug 191 口径不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
宿主 IEEE 见证：x = MIN_VALUE 时 x > 0 真而 x + 1 > 1 假	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ⊬ x + 1 > 1	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ⊬ x + 2 > 2	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ⊬ x + 0.5 > 0.5	dup:algebra-numbers 聚合矩阵	commit:25008108
x ≥ 0 ⊬ x + 1 > 1（非 strict 下界同样不足）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ⊨ x + 1 >= 1（IEEE 恒真，section 明确要求仍成立）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ⊬ x + 1 > 2（既非可证也不该被常量抵消造出来）	dup:algebra-numbers 聚合矩阵	commit:25008108
量级吸收：x > 1e-12 ⊬ x + 1e6 > 1e6（fl(1e-12 + 1e6) === 1e6）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 1 ⊬ x + 1 > 2（nextUp(1) + 1 ties-to-even 回 2）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ∧ y >= 1：x + y > 1 与 y + x > 1 都不可证	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ∧ y >= 1：x + y >= 1 与 y + x >= 1 都成立（对称性双向钉）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 1 ∧ y > 1 ⊨ x + y > 2（拐点处和精确可表示）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 0 ∧ y > 0 ⊨ x + y > 0	dup:algebra-numbers 聚合矩阵	commit:25008108
x ≥ 1 ∧ y ≥ 1 ⊨ x + y ≥ 2（非严格线性判定不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
x > 2 ⊨ 2 * x > 4（2 的幂缩放精确）	dup:algebra-numbers 聚合矩阵	commit:25008108
逗号串 ⇒ 两个 kind 名（改前整串当**一个**名）	dup:algebra-numbers 聚合矩阵	commit:25008108
竖线 / 空白分隔同样拆分（与指令面同口径）	dup:algebra-numbers 聚合矩阵	commit:25008108
单个 kind / `*` / union 形态不受影响	dup:algebra-numbers 聚合矩阵	commit:25008108
与指令面 `@nudo:throws` 的切分口径一致（同一 spec 同一 kind 集）	dup:algebra-numbers 聚合矩阵	commit:25008108
端到端：侧车 `throws: "TypeError, RangeError"` 放行已申报的 TypeError（改前 L2 假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
number().min(1) / .max(1) / .length(1) 构造期抛错	dup:algebra-numbers 聚合矩阵	commit:25008108
boolean() / 结构型链上同样抛错（与 gt/ge/lt/le 同口径）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：string() / array(...) 的长度链仍然可用	dup:algebra-numbers 聚合矩阵	commit:25008108
string().length(3)：两通道都判违例（'ab'）	dup:algebra-numbers 聚合矩阵	commit:25008108
string().length(3)：两通道都放行（'abc'）	dup:algebra-numbers 聚合矩阵	commit:25008108
array(...).min(3)：两通道都判违例（[1,2]）	dup:algebra-numbers 聚合矩阵	commit:25008108
array(...).min(3)：两通道都放行（[1,2,3]）	dup:algebra-numbers 聚合矩阵	commit:25008108
数字字面量 × length(s) ≥ 1 ⇒ 不可判定（不是「满足」）	dup:algebra-numbers 聚合矩阵	commit:25008108
数字字面量 0 × length(s) ≥ 1 同样是「不可判定」（不是「违例」）	dup:algebra-numbers 聚合矩阵	commit:25008108
字符串字面量 × length(s) ≥ 1 ⇒ 按长度语义裁决	dup:algebra-numbers 聚合矩阵	commit:25008108
纯 var 左项的数值比较语义不变	dup:algebra-numbers 聚合矩阵	commit:25008108
数字实参：3 与 0 都不落进数值比较（0 不再假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
字符串实参：参数位按长度语义裁决（'ab' 放行 / '' 违例）	dup:algebra-numbers 聚合矩阵	commit:25008108
与返回位同结论（字符串长度链：'ab' 两通道放行 / '' 两通道违例）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照（真红必须保留）：`x / 2` 在 x = 5e-324 处为 0 ⇒ 仍判违约	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：(x + x) / 2 的界是 > 0（不是被放松的 > -5e-324）	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：x * 2 / 2 与 (x + x) * 0.5 同结论（乘法路径同样补 attain）	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：x / 2 与 x * 0.5 保持 disproved（真界 ≥ 0，不可放松）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照（真红必须保留）：`Math.floor(x)` 在 x = 5e-324 处为 0 ⇒ 仍判违约	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：Math.ceil(x>0) 的下界是 1（此前是 0）	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：整数界触发（x > 5 ⇒ Math.ceil(x) ≥ 6），不依赖 denormal 推理	dup:algebra-numbers 聚合矩阵	commit:25008108
单元面：upper 侧同样做见证步进（x < 0 ⇒ Math.floor(x) ≤ -1）	dup:algebra-numbers 聚合矩阵	commit:25008108
indexOf past the end returns -1	dup:algebra-numbers 聚合矩阵	commit:25008108
lastIndexOf past the end searches from the end	dup:algebra-numbers 聚合矩阵	commit:25008108
union(number().gt(0), number().gt(5)) ≤ number().gt(0)	dup:algebra-numbers 聚合矩阵	commit:25008108
三成员并集同样按成员判定（不因成员数而回退）	dup:algebra-numbers 聚合矩阵	commit:25008108
单个成员的 sum 与裸成员同判	dup:algebra-numbers 聚合矩阵	commit:25008108
反例：并集里含类型不符成员仍判红	dup:algebra-numbers 聚合矩阵	commit:25008108
反例：并集里含谓词不符成员仍判红（x<0 ⊄ x>0）	dup:algebra-numbers 聚合矩阵	commit:25008108
聚合体确实带顶层 pred 时仍参与判定（信息不丢）	dup:algebra-numbers 聚合矩阵	commit:25008108
目标侧并集语义不变：单成员 ≤ 并集	dup:algebra-numbers 聚合矩阵	commit:25008108
同一 Abs 引用：非域共享仍折 true，域共享折 undefined	dup:algebra-numbers 聚合矩阵	commit:25008108
契约类型数组的 xs[0] === xs[1] 不得删掉 false 臂	dup:algebra-numbers 聚合矩阵	commit:25008108
字面量数组（元素各自铸造、非域共享）仍精确判 diff	dup:algebra-numbers 聚合矩阵	commit:25008108
源码 @nudo:contract 在场 + 陈旧生成段 ⇒ 报 drift（旧口径零告警）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组（无源码契约）同样报 ⇒ 两面同结论（不再非单调）	dup:algebra-numbers 聚合矩阵	commit:25008108
生成段与今日域一致 ⇒ 零 drift（有源码契约时不误报）	dup:algebra-numbers 聚合矩阵	commit:25008108
@nudo:mock Math 生效（宿主 Math.floor 不再应答）	dup:algebra-numbers 聚合矩阵	commit:25008108
@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）	dup:algebra-numbers 聚合矩阵	commit:25008108
env 全局仍受 skip 表约束（宿主内建名不被 env 遮蔽）	dup:algebra-numbers 聚合矩阵	commit:25008108
非 skip 名单上的 mock 名行为不变（fetch 对照组）	dup:algebra-numbers 聚合矩阵	commit:25008108
try/catch 双侧 require：拿到 module.exports 本身（非命名空间）	dup:algebra-numbers 聚合矩阵	commit:25008108
普通 require 与可选 require 同口径（cjsMain ⇒ default 本体）	dup:algebra-numbers 聚合矩阵	commit:25008108
ESM 模块经可选 require 仍是命名空间（口径不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
try/catch 包裹的缺失 require：进 catch 臂	dup:algebra-numbers 聚合矩阵	commit:25008108
未被 catch 吸收的缺失 require：throws 面如实非 never（L2 不再少报）	dup:algebra-numbers 聚合矩阵	commit:25008108
存在模块的 require：不抛（对照组）	dup:algebra-numbers 聚合矩阵	commit:25008108
Object.keys(TypeError + e.code) 折真实键集（改前 []）	dup:algebra-numbers 聚合矩阵	commit:25008108
Object.values / entries 同键集	dup:algebra-numbers 聚合矩阵	commit:25008108
JSON.stringify(TypeError + e.code) 折 {"code":42}（改前 "{}"）	dup:algebra-numbers 聚合矩阵	commit:25008108
Error 家族四面一致：keys / gOPN / gOPD / hasOwn 同键集同标志	dup:algebra-numbers 聚合矩阵	commit:25008108
Map 实例：keys 与 gOPN 都投影用户新增键（改前两面都折 []）	dup:algebra-numbers 聚合矩阵	commit:25008108
Date 实例：keys 与 gOPN 同样投影	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组：未被用户改过的实例仍是零可枚举自有键（不放宽）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组：Error 家族内部槽仍非可枚举（message/stack 不进 keys、不进 JSON）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组：内部数据家族（RegExp）不被误当用户键——keys [] / gOPN [lastIndex]	dup:algebra-numbers 聚合矩阵	commit:25008108
用户类实例路径不受影响（仍走内层槽表投影）	dup:algebra-numbers 聚合矩阵	commit:25008108
export const a = 1, b = 2 ⇒ a 与 b 都是导出	dup:algebra-numbers 聚合矩阵	commit:25008108
多声明符的值正确（b = 2）	dup:algebra-numbers 聚合矩阵	commit:25008108
三个声明符全收	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：独立声明 + 独立 export 只有 a 是导出（b 不是）	dup:algebra-numbers 聚合矩阵	commit:25008108
export function / export class 口径不变	dup:algebra-numbers 聚合矩阵	commit:25008108
互操作表：默认导入绑到命名空间 ⇒ 返回类型可推（不再是 unknown）	dup:algebra-numbers 聚合矩阵	commit:25008108
互操作表：默认导入与命名空间导入**同结论**（含 throws 面）	dup:algebra-numbers 聚合矩阵	commit:25008108
互操作表：AST env 绑定面（bindImports）同口径 ⇒ 绑到命名空间	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：普通用户模块表缺 default ⇒ 默认导入仍是 unknown	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：普通用户模块表有 default ⇒ 默认导入绑到 default 槽	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：互操作表即使带了物化 default 槽，也绑到 default 槽本身	dup:algebra-numbers 聚合矩阵	commit:25008108
物化 default 槽（env 表形态）与互操作回退给出同一个绑定值	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：互操作表无具名导出时不回退（仍是 unknown）	dup:algebra-numbers 聚合矩阵	commit:25008108
length(NaN) / length(±Infinity) 在构造期抛错（不再造恒假契约）	dup:algebra-numbers 聚合矩阵	commit:25008108
错误文案点名 length() 与实际入参（Nudo 原生，非宿主原文）	dup:algebra-numbers 聚合矩阵	commit:25008108
合法界仍然通过（3 / 2.5 / 0）	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：契约里的 length(NaN) 变成侧车装载失败，不再对合法字符串报假红	dup:algebra-numbers 聚合矩阵	commit:25008108
length("3") / length(null) / length(true) 在构造期抛错	dup:algebra-numbers 聚合矩阵	commit:25008108
错误文案带引号地展示字符串界（got "3"），并点名 length()	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：length("3") 的契约不再静默失效（改前 0 error = 假绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组：合法数值界仍然产出真正的长度约束（length(3) 仍报违例）	dup:algebra-numbers 聚合矩阵	commit:25008108
check 签名面的参数类型保留字面量（改前拓宽成 number）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：裸 number 契约不被改成 lit(...)	dup:algebra-numbers 聚合矩阵	commit:25008108
合成**单条**合取（返回槽仍是单条）	dup:algebra-numbers 聚合矩阵	commit:25008108
违反**第 2 条**段也被执法（旧口径只执法第一条）	dup:algebra-numbers 聚合矩阵	commit:25008108
满足全部段时不报错	dup:algebra-numbers 聚合矩阵	commit:25008108
单条 return 段语义不变（名字不变、约束不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
termToString：bigint 保 n 后缀，number 不受影响	dup:algebra-numbers 聚合矩阵	commit:25008108
诊断文本：lit(10n) 与 lit(10) 可区分	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：顶层 env 全局重赋值 ⇒ checkSource 不抛	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：其它 env 全局（构造器 / Promise）同样不抛	dup:algebra-numbers 聚合矩阵	commit:25008108
整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断	dup:algebra-numbers 聚合矩阵	commit:25008108
判定层：prev 是裸宿主值 ⇒ 不抛、不报（fail-closed）	dup:algebra-numbers 聚合矩阵	commit:25008108
原生语义未变：重赋值后 g 就是 1	dup:algebra-numbers 聚合矩阵	commit:25008108
控制组：Abs↔Abs 的标量改型仍报 nudo:assign-mismatch（守卫未吃掉通道信号）	dup:algebra-numbers 聚合矩阵	commit:25008108
eq(x,y) ⇒ le(x,y) ∧ ge(x,y)	dup:algebra-numbers 聚合矩阵	commit:25008108
eq(x,y) ⇒ eq(y,x)（对称）	dup:algebra-numbers 聚合矩阵	commit:25008108
eq(x,x) ⇒ le(x,x) ∧ ge(x,x)（重言式：x === x ⇒ x 非 NaN）	dup:algebra-numbers 聚合矩阵	commit:25008108
反向不成立：eq(x,y) ⇏ lt(x,y) ∧ gt(x,y)（等值不含严格序）	dup:algebra-numbers 聚合矩阵	commit:25008108
无关项不成立：eq(x,x) ⇏ le(x,y)	dup:algebra-numbers 聚合矩阵	commit:25008108
比较折叠：a === b 前提下 `a <= b` 折 true、`a < b` 折 false	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面：a === b 分支内的 `a <= b` 恒真 ⇒ 死分支被剪（签名 1 | 3，不是 1 | 2 | 3）	dup:algebra-numbers 聚合矩阵	commit:25008108
产品面控制组：`a === b` 两次 ⇒ 同样 1 | 3（改前已绿）	dup:algebra-numbers 聚合矩阵	commit:25008108
env 名拼错（没解析出全局）⇒ 发 nudo:unknown-inference 警告	dup:algebra-numbers 聚合矩阵	commit:25008108
env 名拼错 ⇒ 不再发指错方向的 nudo:opaque-result 信息	dup:algebra-numbers 聚合矩阵	commit:25008108
对照组：没有 env 指令 ⇒ 仍然是 unknown-inference 警告（口径不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(-0) ⊭ lit(0)（Object.is(0, -0) === false）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(0) ⊭ lit(-0)（反向同样不满足）	dup:algebra-numbers 聚合矩阵	commit:25008108
NaN ≡ NaN（SameValue：=== 对 NaN 为 false，赋值同一性不可用 ===）	dup:algebra-numbers 聚合矩阵	commit:25008108
同值字面量仍可赋值（0 ≡ 0、1 ≡ 1、-1 ≡ -1）	dup:algebra-numbers 聚合矩阵	commit:25008108
不同字面量仍不可赋值（1 ⊭ 2）	dup:algebra-numbers 聚合矩阵	commit:25008108
case 期望面：实现给 +0、期望 -0 ⇒ 不是同一个值（service 层对账用的就是这个判定）	dup:algebra-numbers 聚合矩阵	commit:25008108
single-quoted full form is parsed	dup:algebra-numbers 聚合矩阵	commit:25008108
single-quoted named form is parsed	dup:algebra-numbers 聚合矩阵	commit:25008108
mixed quote kinds are parsed (source and path may differ)	dup:algebra-numbers 聚合矩阵	commit:25008108
double-quoted form keeps working (control)	dup:algebra-numbers 聚合矩阵	commit:25008108
file-level extraction keeps the single-quoted record (was silently dropped)	dup:algebra-numbers 聚合矩阵	commit:25008108
several single-quoted records all survive (no silent drop of any)	dup:algebra-numbers 聚合矩阵	commit:25008108
malformed payloads are still rejected (zero false positives)	dup:algebra-numbers 聚合矩阵	commit:25008108
见证只落在首个 declarator 上（不再重放到 b）	dup:algebra-numbers 聚合矩阵	commit:25008108
每个 declarator 只建一个 scope（不再多出 <anonymous> 影子）	dup:algebra-numbers 聚合矩阵	commit:25008108
第二个 declarator 的内联注释仍归它自己	dup:algebra-numbers 聚合矩阵	commit:25008108
单声明符形态不受影响（见证仍可见）	dup:algebra-numbers 聚合矩阵	commit:25008108
真 @generated 标记 + 中间夹无关 const ⇒ 手写 export 不是生成段	dup:algebra-numbers 聚合矩阵	commit:25008108
夹的 const 若**被 export 引用** ⇒ 仍属段内（判据是引用，不是位置）	dup:algebra-numbers 聚合矩阵	commit:25008108
无标记 ⇒ 不是生成段（对照）	dup:algebra-numbers 聚合矩阵	commit:25008108
合法：别名段（DESIGN-003，段内夹 const）仍认得出	dup:algebra-numbers 聚合矩阵	commit:25008108
合法：组合式下行段（§5.3，段内夹 prelude const）仍认得出	dup:algebra-numbers 聚合矩阵	commit:25008108
合法：多步 prelude（中间量只被后一步引用）仍认得出	dup:algebra-numbers 聚合矩阵	commit:25008108
合法：头紧贴 export 仍认得出	dup:algebra-numbers 聚合矩阵	commit:25008108
合法：头 + import 链（跨 import 回溯）仍认得出	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(null) 契约收到 null ⇒ 放行（零诊断；改前是假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(undefined) 契约收到 undefined ⇒ 放行（零诊断；改前是假红）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(null) 契约收到 0 ⇒ 判违例，expected 指向 x = null	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(null) 契约收到 'a' ⇒ 判违例	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(undefined) 契约收到 0 ⇒ 判违例，expected 指向 x = undefined	dup:algebra-numbers 聚合矩阵	commit:25008108
null 与 undefined 是**两个域**：lit(null) 契约收到 undefined ⇒ 判违例	dup:algebra-numbers 聚合矩阵	commit:25008108
null 与 undefined 是**两个域**：lit(undefined) 契约收到 null ⇒ 判违例	dup:algebra-numbers 聚合矩阵	commit:25008108
裸 lit(null)：契约**自身**是一条 eq 原子（无成员）	dup:algebra-numbers 聚合矩阵	commit:25008108
裸 lit(undefined)：契约**自身**是一条 eq 原子（无成员）	dup:algebra-numbers 聚合矩阵	commit:25008108
nullable(number())：nullish 是**成员**（members[]），不是契约自身	dup:algebra-numbers 聚合矩阵	commit:25008108
union(lit(null), number())：nullish 是**成员**（members[]），不是契约自身	dup:algebra-numbers 聚合矩阵	commit:25008108
行注释里**提到** @generated ⇒ 不是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
块注释里**提到** @generated ⇒ 不是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
注释**以** @generated 开头但不是 nudo 的段头 ⇒ 不是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
代码行尾的 @generated ⇒ 不是生成标记（标记必须是独立行）	dup:algebra-numbers 聚合矩阵	commit:25008108
nudo 段头（完整形）⇒ 是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
nudo 段头（短形 `— do not edit`）⇒ 是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
nudo 段头（最短形 `by nudo`）⇒ 是生成标记	dup:algebra-numbers 聚合矩阵	commit:25008108
手写契约（无任何标记）⇒ 不是生成段（对照）	dup:algebra-numbers 聚合矩阵	commit:25008108
export default function calc + 具名侧车 ⇒ 调用点报违例	dup:algebra-numbers 聚合矩阵	commit:25008108
export { calc as default } + 具名侧车 ⇒ 调用点报违例	dup:algebra-numbers 聚合矩阵	commit:25008108
侧车写 export default fn(…) ⇒ 仍然执法（不回归）	dup:algebra-numbers 聚合矩阵	commit:25008108
具名导入（对照）⇒ 仍然执法	dup:algebra-numbers 聚合矩阵	commit:25008108
★ `f(x = -5)` + 契约 x > 0 + 零实参调用 ⇒ 报违例（改前零诊断）	dup:algebra-numbers 聚合矩阵	commit:25008108
★ 顶层零实参调用同样执法（作用域不再决定裁决）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：默认值满足契约（`x = 5`）⇒ 不报违例	dup:algebra-numbers 聚合矩阵	commit:25008108
对照：显式传违约实参 ⇒ 照常报违例（既有路径没被弄坏）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：**无默认值**的形参 + 零实参调用 ⇒ 不发明违例（缺参是另一条缺陷）	dup:algebra-numbers 聚合矩阵	commit:25008108
负控制：解构默认值（`{ port = 3000 } = {}`）⇒ 不发明违例	dup:algebra-numbers 聚合矩阵	commit:25008108
默认值位对齐：第二个形参有默认值 ⇒ 按形参位补齐（不串位）	dup:algebra-numbers 聚合矩阵	commit:25008108
引擎自己确实算出了 -5（默认值 Abs 与运行时一致）	dup:algebra-numbers 聚合矩阵	commit:25008108
arr 形参（收割的 T[]）× tuple 实参（数组字面量）⇒ α 绑定（不再落 any）	dup:algebra-numbers 聚合矩阵	commit:25008108
同 kind 臂仍排在前：arr 形参 × arr 实参 仍绑出元素类型（既有 deep-α 用例的护栏）	dup:algebra-numbers 聚合矩阵	commit:25008108
tuple 形参 × arr 实参 ⇒ 各槽绑 arr 的元素类型	dup:algebra-numbers 聚合矩阵	commit:25008108
空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）	dup:algebra-numbers 聚合矩阵	commit:25008108
非数组 kind 仍不绑（prim 形参 × prim 实参：无 α 可绑）	dup:algebra-numbers 聚合矩阵	commit:25008108
域隶属单元层：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 值域已放开）	dup:algebra-numbers 聚合矩阵	commit:25008108
标量位：f(2n) 报违例、f(1n) 放行（S6 已落，不得回退）	dup:algebra-numbers 聚合矩阵	commit:25008108
字段位：f({ v: 2n }) 报违例、f({ v: 1n }) 放行（915 延伸）	dup:algebra-numbers 聚合矩阵	commit:25008108
元素位：f([2n]) 报违例、f([1n]) 放行（915 延伸）	dup:algebra-numbers 聚合矩阵	commit:25008108
三向对照：同一份 lit(1n) 契约在三个位置的裁决条数一致	dup:algebra-numbers 聚合矩阵	commit:25008108
union 成员位：域外 bigint 报违例、域内 bigint 放行	dup:algebra-numbers 聚合矩阵	commit:25008108
既有裁决不得回退：number / string 撞 lit(1n) 仍报违例	dup:algebra-numbers 聚合矩阵	commit:25008108
既有裁决不得回退：-0 与 0 的字面量同一性（S3 的 915 修法）仍然放行	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(0) 接受 -0、lit(-0) 接受 0（=== 口径，与标量实参位一致）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(0) 不接受 1 / -1（不因统一口径而漏判）	dup:algebra-numbers 聚合矩阵	commit:25008108
lit(NaN) 接受 NaN（NaN 特例；=== 对 NaN 为 false）	dup:algebra-numbers 聚合矩阵	commit:25008108
字段位 / 数组元素位的 -0 不再报违例（同一执法路径一种裁决）	dup:algebra-numbers 聚合矩阵	commit:25008108
字段位 / 数组元素位真正违约仍报（不放宽过头）	dup:algebra-numbers 聚合矩阵	commit:25008108
分母恒负 ⇒ 0 / x 折 -0（原生 0 / -5 = -0）	dup:algebra-numbers 聚合矩阵	commit:25008108
分母恒负 ⇒ 1 / (0 / x) 折 -Infinity（原生 -Infinity）	dup:algebra-numbers 聚合矩阵	commit:25008108
分母恒正 ⇒ 仍折 +0 / +Infinity（原生口径不变）	dup:algebra-numbers 聚合矩阵	commit:25008108
分母符号不可证（可能为 0 / 两侧都有界）⇒ 不折字面量（保守）	dup:algebra-numbers 聚合矩阵	commit:25008108
issue #170 既有口径不回归：x >= 0 ∧ x ≠ 0 ⇒ 折 +0 字面量	dup:algebra-numbers 聚合矩阵	commit:25008108
numericBounds 的符号侧：x < 0 ⇒ hi 严格 0（分母恒负可判）	dup:algebra-numbers 聚合矩阵	commit:25008108
0 / x（x < 0）⇒ 引擎折 -0（改前折 +0）	dup:algebra-numbers 聚合矩阵	commit:25008108
1 / (0 / x)（x < 0）⇒ 引擎折 -Infinity（改前折 +Infinity）	dup:algebra-numbers 聚合矩阵	commit:25008108
分母恒正 ⇒ 端到端仍是 +0 / +Infinity	dup:algebra-numbers 聚合矩阵	commit:25008108
`export { a } from './m.js'`：来源不可达时不产生任何导出槽	dup:algebra-numbers 聚合矩阵	commit:25008108
`export { default } from './m.js'`：来源不可达时 default 槽必须缺席	dup:algebra-numbers 聚合矩阵	commit:25008108
`export { default as d } from './m.js'`：来源不可达时不产生任何导出槽	dup:algebra-numbers 聚合矩阵	commit:25008108
`export * as ns from './m.js'`：来源不可达时不产生任何导出槽	dup:algebra-numbers 聚合矩阵	commit:25008108
`export * from './m.js'`：来源不可达时不产生任何导出槽	dup:algebra-numbers 聚合矩阵	commit:25008108
本地导出（无 source）不受影响：仍是本地导出表	dup:algebra-numbers 聚合矩阵	commit:25008108
bindImports：`import { default as d }` 与 `import d from` 绑定同一个值	dup:algebra-numbers 聚合矩阵	commit:25008108
```
