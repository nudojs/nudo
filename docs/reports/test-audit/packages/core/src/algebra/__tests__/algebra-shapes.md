# packages/core/src/algebra/__tests__/algebra-shapes.test.ts

模块套件：shape/union/品牌/槽位面。

审计：112 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
数组 a.push = 1 读回 1（改前折函数）；Map 实例 m.get = 1 读回 number；Date / Set / RegExp 实例同形态；非表内键保持既有 unknown 口径（不假精确）；未写时表内键仍折函数	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
"返回 %s（%s）⊭ nullable(number()) ⇒ error"	表驱动用例：返回 %s（%s）⊭ nullable(number()) ⇒ error；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
union(number(), lit(null)) 同口径：数组返回值 ⇒ error；不制造假红：null / undefined / number 返回值仍放行；单元面：结构臂 ⊭ union ⇒ disproved（不是 unprovable）；护栏：同域值相等义务（lit(5) 对无 pred 的 number 返回值）不得升级成 error	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
ref("a") 解析到另一槽位的 bind ⇒ 无 error，y 位是 number；对照：y 位写 any() 时逐字不变（无回归）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
null 实参报违例（object shape at o）；undefined 实参报违例；同口径：顶层标量位对 null 也报违例（两套口径已统一）；合规实参零诊断（nullish 执法没有误伤合法调用）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
union(number().gt(0), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）；union(lit(1), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）；负控制：字面量不在 union 内 ⇒ 仍报违例；负控制：类型完全不符（boolean 实参 vs union(number(), string())）⇒ 仍报违例；负控制：满足其中一支（字面量 'a'）⇒ 不报	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
"对象/数组实参 %s ⇒ 恰好 1 条 nudo:constraint-violated"	表驱动用例：对象/数组实参 %s ⇒ 恰好 1 条 nudo:constraint-violated；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"合法成员 %s ⇒ 不报"	表驱动用例：合法成员 %s ⇒ 不报；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
fn() 缺参 ⇒ 点名构造器报错，不泄露宿主原文；fn(42) 非对象 ⇒ 报错（不再静默变成 fn({})）；fn(null) ⇒ 报错；fn({ id: number() }) 正常构造（负控制）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
unknown | null 的返回 ⇒ nudo:unknown-inference；裸 unknown ⇒ 仍报（对照组，行为不变）；有值证据（unknown 形状 + lit(undefined) term）不是引擎债 ⇒ 不报；具体类型不受影响 ⇒ 不报	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
mock 名与 import 绑定同名：mock 覆盖 import，文件正常求值；mock 名与用户顶层声明同名：模块级绑定胜出，文件照常求值（不抛）；env 全局名与模块级绑定同名：同样不撞名（env 注入被跳过）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
Abs 层：同一变量重绑定为不同值 ⇒ 缓存失效（重算）；Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按值承诺）；Abs 层：不可比较的实参（函数值）⇒ 不缓存（不算命中）；宿主函数路径：同一变量重绑定 ⇒ use() 得 "2,4"（native 口径）；宿主函数路径：不同变量同值 ⇒ 命中（函数体只跑一次）；宿主函数路径：不同变量不同值 ⇒ 不得命中（"2,4,calls=2"）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
number().gt(0) 实例化 = typeof 义务 ∧ 数值界；string().max(3) 实例化 = typeof 义务 ∧ 长度界；裸 prim 契约口径不变（仍是单条 typeof）；产品面：类型错配的实参被抓住（此前零诊断静默放行）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
shape 约束（源码指令 × 同名侧车）⇒ 无 conflict 假红；conflict 位不再吃掉该形参的义务 ⇒ 调用点仍报违例（假绿修复）；语义真矛盾（number() ∧ string()）仍然报 conflict	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
形参类型是 (number) => number（无 x0 / ret）；签名面不含占位名	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
占位 term（x0 / ret）不回显；关系 fn 的 α 名（A1 / B1）照旧回显	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
shape() 抛 Nudo 原生诊断，点名构造器并说明缺参；诊断不含宿主 TypeError 原文；shape(undefined) 与 shape() 同口径；产品面：侧车诊断是 Nudo 原生文案，不是宿主原文	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
arr(fn)：函数元素加括号（改前 `(1) => 1[]`）；arr(arr(fn))：嵌套数组同样带括号；控制：union 元素的既有分组判定保留；控制：prim 元素不加冗余括号；控制：tuple 元素里的 fn 不在本片范围（不加括号）；控制：对象槽里的 fn 不在本片范围（不加括号）；端到端：真实源码返回「函数数组」时不得渲染成「返回数组的函数」	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
sum(fn, number)：函数成员加括号（改前 `(1) => 1 | 2`）；sum(fn, fn)：两个函数成员都加括号；sum(arr(fn), number)：数组成员靠 arr 臂自己加括号（成员本身不是 fn）；控制：非函数成员的 union 不加括号；去重：文本相同的两个 fn 成员只留一条（去重 key 用未包裹文本）；端到端：真实源码返回「函数或 number」时 `|` 不得被返回类型吃掉	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
union(number().gt(0), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；nullable(number().gt(0)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；nullable(number().gt(0)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）；union(number(), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；union(number(), l	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
union(number().gt(0), lit(null)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）；nullable(number().gt(0)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit(null)) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit(null)) 收到 1 ⇒ 放行（成员义务不误伤合法实参）；union(number().gt(0), lit(nu	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
顶层 `f(true)` ⇒ 报违例（改前也报，走的是执行态回退）；★ 函数体内 `f(true)` ⇒ 报违例（改前**零诊断**——假绿）；★ 函数体内 `f(false)` ⇒ 报违例（改前零诊断）；作用域不再决定裁决：顶层与函数体内的诊断**逐字相同**；负控制：契约是 boolean() 时 `f(true)` ⇒ 不报违例；负控制：契约是 boolean() 时 `f(false)` ⇒ 不报违例；回归：`f(null)` 仍照常执法（族 06 的 NullLit	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
缺字段只产出 1 条诊断（不是 2 条）；诊断文本与去重前一致（missing field b）；两条**不同**的违例各报一次（缺字段 + 类型违例）；合规实参零诊断（去重没有把合法调用打成红）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
同名 ⇒ 普查名只出现一次（静态方法不另起名）；不同名 ⇒ 两个都在（静态方法仍是入口可见的）；同名 ⇒ check 签名面只有一条 C.m（不再两条互相顶替）；同名 ⇒ 实例方法的返回值不被静态方法顶替（native "inst"）；不同名 ⇒ 两条签名都在（对照）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
lazy(() => shape(...))：非对象实参报违例；lazy(() => array(...))：元素类型不符报违例；嵌套 lazy 包装（两层）也能解包；合规实参零诊断（deref 没有把合法调用打成红）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
顶层标量位：null 报违例（基线口径不变）；字段位：{ v: null } 报违例；数组元素位：[null] 报违例；字段位 undefined 同样报违例；带界的字段位：null 不满足数值界；合规实参零诊断（nullish 执法没有误伤合法调用）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
成员赋值 + 具名函数表达式 ⇒ 普查名是导出槽名；成员赋值 + 匿名函数表达式 ⇒ 普查名是导出槽名（对照）；对象字面量成员 + 具名函数表达式 ⇒ 普查名是导出槽名（键名）；侧车契约按导出槽名绑定 ⇒ 契约义务真的执法（不假绿）	algebra-shapes 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
数组 a.push = 1 读回 1（改前折函数）	dup:algebra-shapes 聚合矩阵	commit:13806366
Map 实例 m.get = 1 读回 number	dup:algebra-shapes 聚合矩阵	commit:13806366
Date / Set / RegExp 实例同形态	dup:algebra-shapes 聚合矩阵	commit:13806366
非表内键保持既有 unknown 口径（不假精确）；未写时表内键仍折函数	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number(), lit(null)) 同口径：数组返回值 ⇒ error	dup:algebra-shapes 聚合矩阵	commit:13806366
不制造假红：null / undefined / number 返回值仍放行	dup:algebra-shapes 聚合矩阵	commit:13806366
单元面：结构臂 ⊭ union ⇒ disproved（不是 unprovable）	dup:algebra-shapes 聚合矩阵	commit:13806366
护栏：同域值相等义务（lit(5) 对无 pred 的 number 返回值）不得升级成 error	dup:algebra-shapes 聚合矩阵	commit:13806366
ref("a") 解析到另一槽位的 bind ⇒ 无 error，y 位是 number	dup:algebra-shapes 聚合矩阵	commit:13806366
对照：y 位写 any() 时逐字不变（无回归）	dup:algebra-shapes 聚合矩阵	commit:13806366
null 实参报违例（object shape at o）	dup:algebra-shapes 聚合矩阵	commit:13806366
undefined 实参报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
同口径：顶层标量位对 null 也报违例（两套口径已统一）	dup:algebra-shapes 聚合矩阵	commit:13806366
合规实参零诊断（nullish 执法没有误伤合法调用）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number().gt(0), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(lit(1), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：字面量不在 union 内 ⇒ 仍报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：类型完全不符（boolean 实参 vs union(number(), string())）⇒ 仍报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：满足其中一支（字面量 'a'）⇒ 不报	dup:algebra-shapes 聚合矩阵	commit:13806366
fn() 缺参 ⇒ 点名构造器报错，不泄露宿主原文	dup:algebra-shapes 聚合矩阵	commit:13806366
fn(42) 非对象 ⇒ 报错（不再静默变成 fn({})）	dup:algebra-shapes 聚合矩阵	commit:13806366
fn(null) ⇒ 报错	dup:algebra-shapes 聚合矩阵	commit:13806366
fn({ id: number() }) 正常构造（负控制）	dup:algebra-shapes 聚合矩阵	commit:13806366
unknown | null 的返回 ⇒ nudo:unknown-inference	dup:algebra-shapes 聚合矩阵	commit:13806366
裸 unknown ⇒ 仍报（对照组，行为不变）	dup:algebra-shapes 聚合矩阵	commit:13806366
有值证据（unknown 形状 + lit(undefined) term）不是引擎债 ⇒ 不报	dup:algebra-shapes 聚合矩阵	commit:13806366
具体类型不受影响 ⇒ 不报	dup:algebra-shapes 聚合矩阵	commit:13806366
mock 名与 import 绑定同名：mock 覆盖 import，文件正常求值	dup:algebra-shapes 聚合矩阵	commit:13806366
mock 名与用户顶层声明同名：模块级绑定胜出，文件照常求值（不抛）	dup:algebra-shapes 聚合矩阵	commit:13806366
env 全局名与模块级绑定同名：同样不撞名（env 注入被跳过）	dup:algebra-shapes 聚合矩阵	commit:13806366
Abs 层：同一变量重绑定为不同值 ⇒ 缓存失效（重算）	dup:algebra-shapes 聚合矩阵	commit:13806366
Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按值承诺）	dup:algebra-shapes 聚合矩阵	commit:13806366
Abs 层：不可比较的实参（函数值）⇒ 不缓存（不算命中）	dup:algebra-shapes 聚合矩阵	commit:13806366
宿主函数路径：同一变量重绑定 ⇒ use() 得 "2,4"（native 口径）	dup:algebra-shapes 聚合矩阵	commit:13806366
宿主函数路径：不同变量同值 ⇒ 命中（函数体只跑一次）	dup:algebra-shapes 聚合矩阵	commit:13806366
宿主函数路径：不同变量不同值 ⇒ 不得命中（"2,4,calls=2"）	dup:algebra-shapes 聚合矩阵	commit:13806366
number().gt(0) 实例化 = typeof 义务 ∧ 数值界	dup:algebra-shapes 聚合矩阵	commit:13806366
string().max(3) 实例化 = typeof 义务 ∧ 长度界	dup:algebra-shapes 聚合矩阵	commit:13806366
裸 prim 契约口径不变（仍是单条 typeof）	dup:algebra-shapes 聚合矩阵	commit:13806366
产品面：类型错配的实参被抓住（此前零诊断静默放行）	dup:algebra-shapes 聚合矩阵	commit:13806366
shape 约束（源码指令 × 同名侧车）⇒ 无 conflict 假红	dup:algebra-shapes 聚合矩阵	commit:13806366
conflict 位不再吃掉该形参的义务 ⇒ 调用点仍报违例（假绿修复）	dup:algebra-shapes 聚合矩阵	commit:13806366
语义真矛盾（number() ∧ string()）仍然报 conflict	dup:algebra-shapes 聚合矩阵	commit:13806366
形参类型是 (number) => number（无 x0 / ret）	dup:algebra-shapes 聚合矩阵	commit:13806366
签名面不含占位名	dup:algebra-shapes 聚合矩阵	commit:13806366
占位 term（x0 / ret）不回显	dup:algebra-shapes 聚合矩阵	commit:13806366
关系 fn 的 α 名（A1 / B1）照旧回显	dup:algebra-shapes 聚合矩阵	commit:13806366
shape() 抛 Nudo 原生诊断，点名构造器并说明缺参	dup:algebra-shapes 聚合矩阵	commit:13806366
诊断不含宿主 TypeError 原文	dup:algebra-shapes 聚合矩阵	commit:13806366
shape(undefined) 与 shape() 同口径	dup:algebra-shapes 聚合矩阵	commit:13806366
产品面：侧车诊断是 Nudo 原生文案，不是宿主原文	dup:algebra-shapes 聚合矩阵	commit:13806366
arr(fn)：函数元素加括号（改前 `(1) => 1[]`）	dup:algebra-shapes 聚合矩阵	commit:13806366
arr(arr(fn))：嵌套数组同样带括号	dup:algebra-shapes 聚合矩阵	commit:13806366
控制：union 元素的既有分组判定保留	dup:algebra-shapes 聚合矩阵	commit:13806366
控制：prim 元素不加冗余括号	dup:algebra-shapes 聚合矩阵	commit:13806366
控制：tuple 元素里的 fn 不在本片范围（不加括号）	dup:algebra-shapes 聚合矩阵	commit:13806366
控制：对象槽里的 fn 不在本片范围（不加括号）	dup:algebra-shapes 聚合矩阵	commit:13806366
端到端：真实源码返回「函数数组」时不得渲染成「返回数组的函数」	dup:algebra-shapes 聚合矩阵	commit:13806366
sum(fn, number)：函数成员加括号（改前 `(1) => 1 | 2`）	dup:algebra-shapes 聚合矩阵	commit:13806366
sum(fn, fn)：两个函数成员都加括号	dup:algebra-shapes 聚合矩阵	commit:13806366
sum(arr(fn), number)：数组成员靠 arr 臂自己加括号（成员本身不是 fn）	dup:algebra-shapes 聚合矩阵	commit:13806366
控制：非函数成员的 union 不加括号	dup:algebra-shapes 聚合矩阵	commit:13806366
去重：文本相同的两个 fn 成员只留一条（去重 key 用未包裹文本）	dup:algebra-shapes 聚合矩阵	commit:13806366
端到端：真实源码返回「函数或 number」时 `|` 不得被返回类型吃掉	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number().gt(0), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
nullable(number().gt(0)) 收到 null ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
nullable(number().gt(0)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number(), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number(), lit(undefined)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number().gt(0), lit(undefined)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：null 与 undefined 是两个域 —— posOrNull 收到 undefined 仍报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：posOrUndef 收到 null 仍报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：numOrNull 收到 undefined 仍报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：越界实参仍报违例（逐支求值不是「一律放行」）	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：没有契约的形参收到 null ⇒ 零违例（违例来自契约，不是引擎噪声）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number().gt(0), lit(null)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-shapes 聚合矩阵	commit:13806366
nullable(number().gt(0)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number(), lit(null)) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number(), lit(null)) 收到 1 ⇒ 放行（成员义务不误伤合法实参）	dup:algebra-shapes 聚合矩阵	commit:13806366
union(number().gt(0), lit(null)) 收到 3 ⇒ 放行（成员义务不误伤合法实参）	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）	dup:algebra-shapes 聚合矩阵	commit:13806366
顶层 `f(true)` ⇒ 报违例（改前也报，走的是执行态回退）	dup:algebra-shapes 聚合矩阵	commit:13806366
★ 函数体内 `f(true)` ⇒ 报违例（改前**零诊断**——假绿）	dup:algebra-shapes 聚合矩阵	commit:13806366
★ 函数体内 `f(false)` ⇒ 报违例（改前零诊断）	dup:algebra-shapes 聚合矩阵	commit:13806366
作用域不再决定裁决：顶层与函数体内的诊断**逐字相同**	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：契约是 boolean() 时 `f(true)` ⇒ 不报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
负控制：契约是 boolean() 时 `f(false)` ⇒ 不报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
回归：`f(null)` 仍照常执法（族 06 的 NullLiteral 分支没被弄坏）	dup:algebra-shapes 聚合矩阵	commit:13806366
回归：数值实参仍照常执法（两种作用域都报）	dup:algebra-shapes 聚合矩阵	commit:13806366
缺字段只产出 1 条诊断（不是 2 条）	dup:algebra-shapes 聚合矩阵	commit:13806366
诊断文本与去重前一致（missing field b）	dup:algebra-shapes 聚合矩阵	commit:13806366
两条**不同**的违例各报一次（缺字段 + 类型违例）	dup:algebra-shapes 聚合矩阵	commit:13806366
合规实参零诊断（去重没有把合法调用打成红）	dup:algebra-shapes 聚合矩阵	commit:13806366
同名 ⇒ 普查名只出现一次（静态方法不另起名）	dup:algebra-shapes 聚合矩阵	commit:13806366
不同名 ⇒ 两个都在（静态方法仍是入口可见的）	dup:algebra-shapes 聚合矩阵	commit:13806366
同名 ⇒ check 签名面只有一条 C.m（不再两条互相顶替）	dup:algebra-shapes 聚合矩阵	commit:13806366
同名 ⇒ 实例方法的返回值不被静态方法顶替（native "inst"）	dup:algebra-shapes 聚合矩阵	commit:13806366
不同名 ⇒ 两条签名都在（对照）	dup:algebra-shapes 聚合矩阵	commit:13806366
lazy(() => shape(...))：非对象实参报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
lazy(() => array(...))：元素类型不符报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
嵌套 lazy 包装（两层）也能解包	dup:algebra-shapes 聚合矩阵	commit:13806366
合规实参零诊断（deref 没有把合法调用打成红）	dup:algebra-shapes 聚合矩阵	commit:13806366
顶层标量位：null 报违例（基线口径不变）	dup:algebra-shapes 聚合矩阵	commit:13806366
字段位：{ v: null } 报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
数组元素位：[null] 报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
字段位 undefined 同样报违例	dup:algebra-shapes 聚合矩阵	commit:13806366
带界的字段位：null 不满足数值界	dup:algebra-shapes 聚合矩阵	commit:13806366
成员赋值 + 具名函数表达式 ⇒ 普查名是导出槽名	dup:algebra-shapes 聚合矩阵	commit:13806366
成员赋值 + 匿名函数表达式 ⇒ 普查名是导出槽名（对照）	dup:algebra-shapes 聚合矩阵	commit:13806366
对象字面量成员 + 具名函数表达式 ⇒ 普查名是导出槽名（键名）	dup:algebra-shapes 聚合矩阵	commit:13806366
侧车契约按导出槽名绑定 ⇒ 契约义务真的执法（不假绿）	dup:algebra-shapes 聚合矩阵	commit:13806366
```
