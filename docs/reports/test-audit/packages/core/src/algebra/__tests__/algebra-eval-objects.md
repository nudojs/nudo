# packages/core/src/algebra/__tests__/algebra-eval-objects.test.ts

模块套件：656 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"brand 接收者 · 闭合 obj · 表外成员（then）⇒ 记 may-throw（never throws TypeError）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"brand 接收者 · 闭合 obj · 表内成员（json / text）⇒ 不记抛"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"负控：宿主确实存在的成员（status / ok —— 数据成员）⇒ 不误报成「确定抛」"	"status / ok 是数据成员（原生不是函数）⇒ 原生调用确实抛 TypeError； 但 env 声明的是**抽象 prim**（值域非确定）⇒ 不得按「字面量」定论。 内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	夹具漏形态	keep	keep	—
"soundness 护栏：内层 **unknown** 的 brand ⇒ 不记抛（域不封闭 ⇒ 缺席不可证）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"soundness 护栏：内层 **open** obj 的 brand ⇒ 不记抛"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"平 obj 接收者的既有行为逐字不变（表外成员仍定抛 / 表内成员不抛）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"负控：引擎已为原型面建模的内建 brand ⇒ 不判（表外名不可证缺席）"	"Map / ArrayBuffer 的原型可调用面在 members.ts 的 BUILTIN_BRAND_METHODS， 不在内层 obj 槽表里 ⇒ 「get」/「slice」不可按「表外 ⇒ 确定不存在」判。 内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"L2 门禁面：brand 表外成员的调用 ⇒ 记 nudo:entry-may-throw（假绿收口）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"L2 门禁面：brand 表内成员的调用 ⇒ 不记 entry-may-throw"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"同步守卫：内建 brand 原型表键集 ⊆ 排除名单（含 .prototype / Intl. 模式）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"负控：原型对象 brand / Intl.* 子构造器 ⇒ 不判（模式排除生效）"	"内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭"	没测该层	keep	keep	—
"fn⊕fn：两臂都有的静态成员 ⇒ 值域是两臂返回域之并（不是 unknown）"	"sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"fn⊕fn：只有一臂有的静态成员 ⇒ 该臂派发 + 另一臂按原生记 may-throw"	"该臂派发 ⇒ 值域是它的返回域（不是 unknown） 另一臂按原生记 may-throw（且**只**记缺该成员的那一臂） sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"fn⊕fn：反向（只有 B 有）⇒ 同样只派发有的一臂"	"sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"负控：fn 静态面模型为**空**（确实没有该静态成员）⇒ 仍判「确定没有」"	"缺该成员的那一臂被跳过（不贡献值）+ 记 may-throw sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"负控：fn **没有**静态面模型（判据不足）⇒ 保守放行（不记 may-throw）"	"判不准 ≠ 确定没有 ⇒ 不得凭空造 may-throw sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"负控：Function.prototype 名（toString）沿函数对象恒可得 ⇒ 不判缺席"	"sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"负控：prim / brand / obj / arr / tuple / eff 的既有 sum 派发行为逐字不变"	"成员必须**可区分**（同形 join 会并成单个 prim / obj ⇒ 走不到 sum 臂） prim：表内方法照常派发（两臂都贡献值） prim：表外方法 ⇒ 每个成员确定没有 ⇒ 各记一条 may-throw + 跳过（值域塌 unknown） number 的 toFixed 在表内 ⇒ 派发（两臂各贡献一个字符串） obj：缺槽成员 ⇒ 原生 TypeError（硬抛，catch 可吸收） tuple：join 在 Array.prototype 面 ⇒ 派发 eff（promise）：then 派发"	夹具漏形态	keep	keep	—
"端到端：env 全局是 fn⊕fn sum ⇒ Response.json(x) 的签名不是 unknown"	"合并 fn 全局的静态成员调用不再触发 unknown-inference sum 成员的字面量值（字符串化后排序——与成员顺序无关）"	夹具漏形态	keep	keep	—
"键表达式在类定义期求值 1 次（此前 0 次）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"多次构造不再重复求值键（此前每构造 1 次）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"键不再随实例漂移（两次构造同键）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"键表达式的抛错在定义期表面（构造期不再抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"同名类在两处定义：每次定义各求值 1 次"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：静态字段/方法的计算键仍各求值 1 次"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：公有实例字段的键与值不变"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：抽象计算键不假精确挂名（不抛）"	"键是未知的入参（抽象键）——不可静态命名 → 字段不挂名（不假精确） 抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"static 块在前的静态字段读到块内写入（原生 2）"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"字段-块-字段三段交错（原生 3）"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"副作用轨迹按源码序（原生 1b2）"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"负控制：字段在前的 static 块读前序字段（原生 2）"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"负控制：static 块写外层变量仍在定义期落地"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"负控制：static 块内 this 是类值（写入落槽）"	"修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进 statics 表由 $class 求值，static 块另走独立尾段）——类体源码 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2， 引擎折 NaN（q 未定义）。"	没测该层	keep	keep	—
"{ get x(){}, x: 2 } → 读得数据属性 2"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"{ get x(){}, x: 2 } 后的写不再定抛（数据属性写语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"{ get x(){}, x: 2 } 的自有描述符是数据属性（value = 2）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"{ x: 1, get x(){}, x: 3 } → 最后一个定义（数据属性 3）胜出"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"{ get x(){}, x: 2 } 展开后仍是数据属性 2"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"{ get x(){}, x: 2 } 经 Object.assign 拷贝后仍是数据属性 2"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"被覆盖的 getter 不再被调用（副作用归零）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"重复键的数据属性仍可枚举（键存在性不丢）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"方法简写是数据属性：{ get x(){}, x(){} } → 方法胜出"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"symbol 键同键仲裁：{ get [Symbol.iterator](), [Symbol.iterator]: 2 } → 数据属性胜出"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"动态计算键同键仲裁：{ get [k](), [k]: 2 } → 数据属性胜出（定义语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"动态计算键同键仲裁后写语义不塌成定抛（数据属性写）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"动态计算键：键表达式仍只求值一次"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"单访问器：{ get x(){ return 7 } } → 7"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数据在前、访问器在后 → 访问器胜出（读走 getter）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数据在前、访问器在后 → 写仍是 getter-only 的 TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"访问器对：{ get x(){}, set x(v){} } → 读得 getter 值 1"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"setter 仍被调用（写回 receiver 字段）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"访问器-访问器：{ get x(){1}, get x(){2} } → 后者 2"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数据-数据：{ x: 1, x: 2 } → 2"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"访问器-数据-访问器：最终是访问器 → 读最后一个 getter"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"symbol 键：{ [Symbol.iterator]: 2, get [Symbol.iterator](){} } → 访问器胜出"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"动态计算键：{ [k]: 2, get [k](){} } → 访问器胜出（后写）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"动态计算键：不同键互不牵连（getter 键 + 数据键）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"方法简写在后：{ x(){}, get x(){} } → 访问器胜出（读 undefined）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"其它键不受重复键仲裁牵连"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"无重复键的字面量不受影响（普通数据属性）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"对象字面量访问器：getter 在实参之前跑（原生 mbc / 改前 bmc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"对象字面量访问器 + 两个实参：getter → 实参 → 调用（原生 mabc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"类访问器：getter 先于实参（原生 gmbc / 改前 bgmc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"静态类访问器：getter 先于实参（原生 smbc / 改前 bsmc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"嵌套访问器：外层 getter → 内层 getter → 实参（原生 pmbc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"计算键调用：键 → 成员读 → 实参（原生 kmbc / 改前 kbmc）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"getter 抛：实参**不**求值（原生 mT / 改前 bmT）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"getter 返回非函数：getter → 实参 → TypeError（原生 mbT / 改前 bmT）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"getter 只跑一次（不得因预读 + 派发各读一次而跑两遍）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"数据槽方法：成员读无副作用，调用仍在实参之后（原生 bm）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"普通函数调用：实参从左到右（原生 abf）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"计算键 + 数据槽方法：键先求值（原生 kbm）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"super 调用：父类方法仍被派发（this 绑实例）"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"私有名方法调用：this.#m() 仍走类注册表派发"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"数组方法：map 回调仍逐元素跑"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"this 绑定：对象方法体内的 this 仍是接收者"	"修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入， 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了 （`o.m(b())` 原生 \"mbc\" / 引擎 \"bmc\"）。 派发复用预读值 （不再二次读 ⇒ getter 只跑一次）。"	夹具漏形态	keep	keep	—
"static { this.x = super.m } → 父类静态成员值（原生 1）"	"修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。"	没测该层	keep	keep	—
"static 块内 super.m 参与运算（原生 3）"	"修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。"	没测该层	keep	keep	—
"负控制：静态字段里的 super 仍读父类静态成员"	"修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。"	没测该层	keep	keep	—
"负控制：静态方法里的 super 仍读父类静态成员"	"修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。"	没测该层	keep	keep	—
"负控制：实例方法里的 super 仍读父类原型链（不被静态口径污染）"	"修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。"	没测该层	keep	keep	—
"读外类私有 → TypeError（此前返回外类的值）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"调外类私有方法 → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"写外类私有 → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"派生类同名私有不覆盖基类私有（基类 1 / 派生 2）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"#x in o 只看本类私有 brand（外类实例 → false）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态私有跨类读 → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：同类私有读写正常"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：自有私有槽对属性 introspection 不可见（仍是内部槽）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：公有字符串键 '#x' 不受私有名作用域化影响"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"属性为 undefined → 取默认值并写回成员"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"属性有值 → 写回该值（默认值不生效）"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"嵌套成员目标（o.x.y = 7）同样写回"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"数组模式的成员目标带默认值（[o.x = 1] = src）同样写回"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"负控制：标识符目标带默认值（{ a = 1 }）行为不变"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"负控制：成员目标**不带**默认值仍写回（既有行为不回归）"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"负控制：嵌套模式 + 默认（{ a: { b } = {} }）行为不变"	"回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`）， 赋值**写回不能丢**。 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回 **静默丢弃** ⇒ 目标成员保持旧值（错值）。"	旧断言钉错	keep	keep	—
"函数表达式 + .call(receiver)：默认值读到接收者"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"函数声明 + .call(receiver)：默认值读到接收者"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"方法体内的函数表达式：默认值 this = undefined ⇒ TypeError（原生同）"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"方法体内的函数声明：默认值 this = undefined ⇒ TypeError（原生同）"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"普通调用（严格模式）this = undefined（不是全局对象）"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"箭头表达式的 this 仍词法继承外层（箭头无自己的 this）"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"方法自身的默认值（m(x = this.v)）仍是 3"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"箭头默认值的 this 词法继承外层方法（`() => this.v` 同）"	"原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this` 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层 作用域的 this。 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒ 默认表达式沿用外层 `thisParam`： - `const o = { v: 3, m(){ return (function (x = this.v) { return x;"	没测该层	keep	keep	—
"for (o.x of [1,2,3]) 后 o.x === 3"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"for (o.x in {a:1,b:2}) 后 o.x === 'b'"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"头写回后体内可读到当轮值"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"计算键成员头：o[key] 写回生效"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"多层成员头：o.a.x 写回生效"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"标识符头：for (x of …) 写回既有绑定"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"标识符头（for-in）：for (k in …) 写回既有绑定"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"标识符头写 const 绑定 = 原生 TypeError（写回通道的 const 守卫）"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"for (o.x of [1,2,3]) 后 o.x 折出 3（不再是旧值 0）"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"const 头不写回外层绑定（仍是块级每轮新绑定）"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"let 头不写回外层绑定"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"未被头赋值的成员保持旧值"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"成员头不影响其它成员"	"修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头 **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值 `3` / `\"b\"`）⇒ L2 假绿 + `nudo test` 假红。 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层 绑定）；"	夹具漏形态	keep	keep	—
"if 测试位：比较用旧值，写回在求值点"	"原生：[1]（o.n++ 读旧值 0 参与比较 → then； 回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"if 测试位：前缀与字符串分支同样走对"	"回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"switch 判别位：判别式取旧值（匹配 case 0）"	"回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"for 步进位：计数器前进（不撞迭代上限）"	"回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"while 测试位：写回在求值点（多一次自增）"	"回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"负控制：标识符目标 / 复合赋值 / 语句位不受影响"	"回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch 判别位 / for·while 步进位都走对分支。 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位 只发射纯读，写回被外包给语句级 rebind pass；"	没测该层	keep	keep	—
"{ __proto__: P, b: B } → 副作用序 P → B"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"{ b: B, __proto__: P } → 副作用序 B → P"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"{ a: A, __proto__: P, b: B } → 副作用序 A → P → B"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"只有 __proto__ 的字面量 → 值表达式仍求值一次"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"__proto__ 的值表达式只求值一次"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"原型设定仍生效（getPrototypeOf 命中该原型）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"__proto__ 仍不是自有键（Object.keys 不含它）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"primitive 原型值被忽略（原型仍是 Object.prototype）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"普通字面量的属性求值序不变（无 __proto__ 时不插 IIFE）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"带 __proto__ 的字面量才引入盒子 IIFE（求值序载体）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"无 __proto__ 的字面量：属性值求值序不变"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"方法名 __proto__ 仍是自有键（不是原型设定）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"字面量里的 this 仍指向外层（IIFE 不得改 this 绑定）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"带 __proto__ 的字面量里 this 绑定同样不变（IIFE 路径）"	"回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其 属性位置求值（原生按源码序），不得被推迟到字面量末尾。 `__proto__` 是**原型设定**（不是自有键），值表达式 与普通属性值一样按源码序求值。"	夹具漏形态	keep	keep	—
"D1 o.a.b = 2：写在 getter 返回的对象上（原生 1——getter 每次新对象）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D2 h.inner.c += 1：写在 getter 返回的对象上（原生 2——同一对象）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D3 o.a.b = 2 不得触发中间层 a 的 setter（原生 0）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D4 冻结根的内层仍可写（原生 2——原生不对中间层做 [[Set]]）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D5 o.a.b += 2（a 是 getter）→ 原生 1，且不抛"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D6 o.a.b = 2（a 是只读 getter）不抛 TypeError（原生 ok）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D7 delete o.a.b（a 是 getter）不抛（原生 ok）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"D8 o.a.b++（a 是 getter）不抛（原生 ok）"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E1 负控制：单层写 o.a = {b:5}（数据属性）→ 5"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E2 负控制：单层写 o.a = 5 仍触发 setter → 5"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E3 负控制：单层写 o.a = 5（只读访问器）仍定抛 TypeError"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E4 负控制：数据属性链 o.a.b = 2 → 2"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E5 负控制：数据属性链 o.a.b += 2 → 3"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E6 负控制：数据属性链 o.a.b++ → 2"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"E7 负控制：delete o.a.b（数据属性链）→ gone"	"抛错面（brand 名 = 错误构造器名）"	夹具漏形态	keep	keep	—
"getter 槽投影成读域值（原生读 1），不是 exact undefined"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"formatAbs（无损面）的 shape 段同口径"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"getter 槽投影成字符串读域（原生读 \"s\"）"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"getter 以 this 为接收者读域（原生 this.n = 41）"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"嵌套对象的 getter 槽同样按读域投影"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"getter + 数据属性同对象：各按各自读域投影"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"守卫面按 getter 读域判定（原生读 data.ab 得 1）"	"口径更新（族 09 / + 410）：guard 面现在还带 ① 数组排除（`!Array.isArray(data)`）② 必填槽的**独立存在性子句** （`Object.hasOwn(data, \"ab\") || (\"ab\" in data && …)`）—— 访问器键的**读域判定**（`data.ab === 1`）不变。 取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"契约投影（zod / standard 面的同源）取 getter 读域"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"契约门禁：getter 返回值满足 shape 契约（改前假红）"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"普通数据属性仍渲染成它的值类型"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"显式 undefined 数据属性仍渲染成 undefined"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"无访问器的对象不受影响（空对象）"	"取对象的守卫串（`nudo export --format guard` 的同源渲染）"	夹具漏形态	keep	keep	—
"typeof A.prototype.m → \"function\"（owner 自有方法）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"\"m\" in A.prototype → true"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"派生类自有方法：B.prototype.own → \"function\" / in → true"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"祖先类方法（原型链继承）：B.prototype.base → \"function\""	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"方法恒等：A.prototype.m === new A().m（同一函数对象）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"负控制：缺席方法仍是 undefined / in → false"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"负控制：A.prototype instanceof A → false（owner 不在自己的原型链上）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"负控制：B.prototype instanceof A → true（原型链继承）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"A.prototype.hasOwnProperty(\"m\") → true（owner 自有方法）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"负控制：祖先类方法不在 B.prototype 自有面 → false"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"负控制：缺席键 → false"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"A.prototype.propertyIsEnumerable(\"m\") → false（类方法非枚举）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"Object.getOwnPropertyDescriptor(A.prototype,\"m\") → 精确描述符（此前折并 ⇒ 读 .value 定抛）"	"回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。 修复前：`evalClassChain(\"A.prototype\")` 的链**不含 owner**（owner 只 push 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）—— 同一方法在 `new A().m` 上却是对的（两条面不一致）。"	没测该层	keep	keep	—
"钩子把方法条目从注册表摘掉（findMethod 沿链不再命中）"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"钩子不误伤静态方法（原生：delete A.prototype.m 不动 A.m）"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"钩子对不存在的方法返回 false（幂等）"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"负控制：删除钩子不动别的类"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"端到端：delete A.prototype.m 后 A.prototype.m / B.prototype.m → undefined、\"m\" in B.prototype → false"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"负控制：delete A.prototype.m 不动别的类的方法"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"负控制：delete A.prototype.<不存在的键> → 原有方法仍在"	"回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用 / 继承面不更新）。 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；"	夹具漏形态	keep	keep	—
"repro：delete A.prototype.m 后 a.m() → throws TypeError（原生同抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"自有类实例同折：delete A.prototype.m 后 new A().m() → TypeError"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"方法从未定义同折：a.neverDefined() → TypeError（原生同抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"方法在但值不是函数：ctor `this.m = undefined` → a.m() → TypeError（原生同抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"user try/catch 可吸收（原生同：抛错被 catch 捕获）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：**读面**不抛——a.m 读回 undefined（调用面才抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：方法仍在 → 调用不变（a.m() → 1，不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：删除不误伤别的类（new C().m() → 2，不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：Object.prototype 名恒可得（a.toString() 不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：静态面不受影响（A.s() → 2，不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：内建 brand 实例不受影响（new Date().getTime() 不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：ctor 自有 fn 槽调用不变（this.m = fn → 42，不抛）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"负控制：内建父类链保守不判（class MyMap extends Map {} → 链有内建父，原型面不完备）"	"S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`—— 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到 **可调用**目标时记 TypeError——两种情形原生同抛： - 方法确实不存在（d"	没测该层	keep	keep	—
"Object.isFrozen(s) → true（原生冻结）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"Object.isFrozen(s.raw) → true（raw 数组同样冻结）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"Object.keys(s) 只有下标（length/raw/@@iterator 非枚举）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"JSON.stringify(s) 走数组序列化面"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"s.propertyIsEnumerable(\"length\") → false"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"Object.getOwnPropertyDescriptor(s, \"length\").enumerable → false"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"for..in 遍历模板对象只枚举下标"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"负控制：元素面不变（下标 / length / raw / 展开）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"数组原型方法在模板对象上可派发（原生模板对象是数组 exotic）"	"修复前：引擎的数组方法面只认 tuple/arr 形状 ⇒ 方法读折 exact undefined ⇒ 调用**假抛 TypeError**（原生不抛）。 回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"负控制：普通对象不是数组视图（数组方法面不外溢）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"负控制：普通对象仍不是冻结的（extState 标注不外溢）"	"回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）： - `Object.keys(s)` → `\"0,1,length,raw,@@iterator\"`（错值）；"	旧断言钉错	keep	keep	—
"Array.isArray(s) → true（模板对象是数组 exotic）"	"`Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject = `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象 是**数组 exotic**（不是普通对象）。 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折 **false**（wrong-exact）。"	夹具漏形态	keep	keep	—
"Array.isArray(s) → true（多段模板同样成立）"	"`Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject = `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象 是**数组 exotic**（不是普通对象）。 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折 **false**（wrong-exact）。"	夹具漏形态	keep	keep	—
"负控制：普通对象 / 非数组值 → false"	"`Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject = `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象 是**数组 exotic**（不是普通对象）。 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折 **false**（wrong-exact）。"	夹具漏形态	keep	keep	—
"负控制：迭代器对象仍不是数组"	"`Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject = `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象 是**数组 exotic**（不是普通对象）。 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折 **false**（wrong-exact）。"	夹具漏形态	keep	keep	—
".call(外来对象) → 方法体以该对象为 this 执行"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
".apply(外来对象) → 同口径"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
".bind(外来对象)() → 同口径"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
".call(undefined) → this=undefined，方法体不碰 this 时不抛"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态方法借用（.call）→ 静态方法体 + 该接收者"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态方法摘下后借用 → 静态方法体"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"HOF 传递（数组 map 回调）→ 方法体正常执行（this=undefined 不抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"派生类实例的方法借用 → 沿派生类方法体执行"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"借用给本类实例 → this = 该实例（this.x 为 undefined）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"借用不记 may-throw（throws 域干净）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：对象字面量方法的借用不受影响（原本就正确）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：方法体真读 undefined 接收者的 this 时定抛 TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"原型上 writable:false → Reflect.set 返 false（此前返 true）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型上 getter-only → Reflect.set 返 false（此前返 true）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"派生类实例同样过门（原型链经类注册表上溯）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：原型上 writable:true → Reflect.set 返 true"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：原型上没有该键 → Reflect.set 返 true（建自有属性）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：实例自有可写字段 → Reflect.set 返 true 且值生效"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型上 writable:false → a.x = 2 抛 TypeError（此前静默写穿）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型上 getter-only → a.y = 2 抛 TypeError（此前静默写穿）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：原型上 writable:true → a.x = 2 不抛"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：实例字段赋值不抛"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链 getter-only → Reflect.set 返 false（此前抛 TypeError）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链 writable:false 数据属性 → Reflect.set 返 false"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链带 setter → Reflect.set 返 true 且 setter 被派发"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：自有可写属性 → true 且值生效"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：自有不可写（frozen）→ false"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：新键 → true（建自有属性）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：strict 赋值仍抛 TypeError（core 侧写门不变）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"X.prototype.hasOwnProperty(k) → true（此前折 false：装到无人持有的新 brand）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"X.prototype.k → 1（原型面读得到）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"实例读继承该原型数据属性 → 1（原型链可见）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"实例面 Reflect.set(new A(), 'x', 2) → false（proto-set.ts 经 protoOfRecv 解析类实例原型链）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"实例面 strict 赋值 a.x = 2 → TypeError（同一写门，strict 语义）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：原型上 writable:true → Reflect.set 返 true"	"类名/键名与上文用例**不重名**——`protoBrandAbs(name)` 按名驻留（进程级 单例），同名类会共用同一原型对象（描述符的 [[Writable]] 残留会串味）。 定抛探针：结果 never + throws 面是指定错误类型"	夹具漏形态	keep	keep	—
"负控制：原型上没有该键 → Reflect.set 返 true（建自有属性）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链 getter-only（Object.create）→ strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链 writable:false 数据属性 → strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链 frozen → strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"两级原型链 getter → strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"原型链带 setter 的访问器 → 派发 setter（不是静默建自有属性）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"fn 上 defineProperty writable:false → strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"数组下标 defineProperty writable:false → strict TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：自有可写属性写 → 成功（值生效）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：原型链普通可写属性 → receiver 建自有属性（值生效）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：类字面量访问器（继承面）→ TypeError（既有正确）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：Object.assign 到继承 non-writable → TypeError（既有正确）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：函数 expando 写（未 defineProperty）→ 仍成功"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"Object.assign(A.prototype, {b:1}) → for-in 看得到 b（此前静默丢弃）"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"Object.defineProperty(A.prototype,'c',{value:2,enumerable:true}) → for-in 看得到 c"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"assign 写的键：实例读得到（原型链继承）"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"assign 写的键：原型面 hasOwnProperty → true"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"assign 写的键：原型面直接读得到"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"非 obj 源（数组字面量）→ 下标键写进原型"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"负控制：类方法非可枚举 → for-in 仍只看到 assign 的键"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"负控制：普通对象的 assign / for-in 不变"	"根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧 containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而 写侧此前： - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand 目标**无分支** ⇒ 静默丢弃； - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的 app"	夹具漏形态	keep	keep	—
"class 实例：原型上的可枚举属性被枚举"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"class 实例：for..in 的枚举个数包含原型键"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"function 原型：原型上的可枚举属性被枚举"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"派生类：整条原型链的可枚举键都被枚举"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"派生类：原型上的方法（class 方法非可枚举）不出现"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"原型键被覆写后仍只枚举一次"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"负控制：class 方法非可枚举 ⇒ 不出现在 for..in"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"负控制：普通对象的 for..in 不变"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"负控制：Object.keys 仍只给自有可枚举键（原型键不混入）"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"负控制：原型上的属性读取仍正常"	"回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。 ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举 属性，再沿**原型链**向上继续（同名键不重复）。"	夹具漏形态	keep	keep	—
"字符串键静态方法 → 1 instanceof A 折 false（不当钩子）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键静态字段 → 1 instanceof A 折 false（不当钩子）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键静态 getter → 1 instanceof A 折 false（不当钩子）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键静态方法仍是可读可调的普通静态成员"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键形态不破坏普通 instanceof 链（new A() instanceof A 仍为 true）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"类表达式形态同样成立（const K = class {…}）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键静态方法的实参与 arguments 口径不变"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"符号键静态方法仍是钩子（左操作数进钩子）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"符号键静态字段仍是钩子"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"符号键静态成员的可读面（Symbol 键）仍是一等函数"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"符号键静态成员的类值槽带 symbolKey 标记（读面据此区分符号键槽）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"字符串键静态成员的类值槽不带 symbolKey 标记（不是符号键槽）"	"回归（**类体静态成员**形态）：普通字符串键 `static \"@@hasInstance\"` 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**； 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01 的 「符号键投影 → \"@@X\" 槽 + symbolKey 标记」同机制）。"	夹具漏形态	keep	keep	—
"obj 的字符串键钩子 → TypeError（RHS 非 callable）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"obj 的字符串键钩子（返回 true 也一样）→ TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"obj 的字符串键槽值不可调用 → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类值的字符串键钩子 → false（不当钩子、不抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类值的字符串键槽值不可调用 → 不抛（原生走 OrdinaryHasInstance → false）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"obj 的符号键钩子 → 调 fn 并 ToBoolean"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类体 static [Symbol.hasInstance] → 钩子生效"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类体 static [Symbol.hasInstance] 的继承（D extends C）→ 钩子生效"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类体 static [Symbol.hasInstance] = fn（静态字段形态）→ 钩子生效"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"普通对象 RHS（无钩子）→ TypeError（原生 RHS 非 callable）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol.toStringTag：Map / Set / Promise 原型上是字符串标签"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"Symbol.iterator：Map / Set / Array / String 原型上是函数"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"Symbol.toPrimitive：Date 原型上是函数"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"RegExp 原型上的 match / replace / search / split 是函数"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"Symbol.unscopables：Array 原型上是 16 键对象"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"实例面经原型链继承同一成员（new Map()[Symbol.toStringTag]）"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"Map 原型的 @@iterator 借调落到集合迭代派发（不再假抛）"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"负控制：字符串键成员不受影响（Map.prototype.get 仍是函数）"	"回归：内建**原型对象**上的 well-known Symbol 成员必须可读 （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]` / `Date.prototype[Symbol.toPrimitive]` …）。 修复前：原型对象的符号成员读**整体缺席** → 折 exact `\"undefined\"` （wrong-exact：原生是字符串 / 函数 / 对象）。"	夹具漏形态	keep	keep	—
"函数 / 类实例 instanceof 自身 → true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"派生类实例 instanceof 父类 → true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"原型被替换后旧实例 instanceof 构造器 → false"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"原型被替换后新造的实例 instanceof 构造器 → true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"实例原型置 null 后 instanceof 构造器 / Object → false（链 null 终止）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"普通函数 / 类的实例 instanceof Function → false（原生 false，非 true）"	"原生：`new F() instanceof Function` ⇒ false（Function.prototype 不在 `f → F.prototype → Object.prototype` 链里） 结果展示串（抽象面用）"	没测该层	keep	keep	—
"以 Function 为基类的类实例 instanceof Function → true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"函数值本身 instanceof Function / Object → true（本片修：此前直读 left.shape 崩 ⇒ unknown）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"函数值 instanceof 内建构造器（Array） → false"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"对象字面量 instanceof 用户函数 / 用户类 → false（此前折抽象 boolean）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"F.prototype = Object.prototype 之后对象字面量 instanceof F → true（原型身份命中）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"对象字面量 instanceof Object → true；instanceof Array → false（既有口径不变）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"箭头函数 RHS（原生定抛 TypeError）不得折 exact false"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"生成器函数 RHS（原生 false）不得折 exact true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"bind 产物 RHS（原生 false）不得折 exact false / true"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"生成器对象替身（内部槽 obj）不得折 exact（既有钉 exec-review-fixes 复钉）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"setPrototypeOf(f, {}) 之后 instanceof F → 抽象 boolean（不得 exact true）"	"替换进来的原型的**自身**原型链未建模 ⇒ 诚实降 boolean （既有钉 instanceof-prototype-chain 同时钉住 「不得 exact false」——本片不改该钉） 结果展示串（抽象面用）"	没测该层	keep	keep	—
"F.prototype={} 之后新实例 instanceof Object → 抽象 boolean（原生 true）"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"F.prototype = 5 之后 f instanceof F → TypeError"	"结果展示串（抽象面用）"	没测该层	keep	keep	—
"函数构造器实例：Object.setPrototypeOf(f, null) → false"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"类实例：Object.setPrototypeOf(a, null) → false"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"负控制：未改写原型的实例仍折 exact true"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"负控制：派生类实例 instanceof 父类 → true"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"负控制：原型对象 instanceof 自身 → false；instanceof 父类 → true"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"F.prototype = {} 之后 f instanceof F → false（实例记录真实 [[Prototype]]）"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"F.prototype = 5 之后 f instanceof F → TypeError（RHS prototype 非对象）"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"换原型前造的旧实例与换后造的新实例可区分（原生 \"false|true\"）"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"原型替换后新造的实例仍 instanceof 构造器 → true"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"原型替换写成 null → TypeError（RHS prototype 非对象）"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"setPrototypeOf 到普通对象后不再折 exact true（原型链不可判 → 降 boolean）"	"引擎不得折 exact true（链不可判 → boolean），也不得折 exact false（那需要「替换进来的原型」的 [[Prototype]] 链可判） 回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsoun"	夹具漏形态	keep	keep	—
"负控制：原型替换后 fn 仍可调用、prototype 读回是新原型"	"回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器 **名字**匹配折 exact true。 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用 `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true （unsound 的肯定判断——类型守卫会走错分支）。"	夹具漏形态	keep	keep	—
"A.prototype = {} → TypeError（catch 吸收）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"A.prototype = {} 无 catch → 函数抛 TypeError（throws 面）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"写穿后类的实例方法仍在（写没生效）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"子类（extends）同样不可写原型"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"有体类表达式的原型同样不可写"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"原型对象上的普通写不受影响（A.prototype.m = 1 → 读回 1）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"类的静态成员写照常（A.x = 1）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态方法写不受影响"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Object.defineProperty(C.prototype, ...) 的就地改原型写回不受本门影响"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"读 A.prototype 仍是原型对象（读面不受写门影响）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"实例字段写不受影响"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Set / Map / WeakMap 子类实例读得到内建方法"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"Date / RegExp 子类实例读得到内建方法"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"prim 包装父类（Number / String）子类实例读得到原型方法"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"@@iterator：子类实例经原型链继承（typeof → function）"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"读面与 in 面一致（不再「in 说有、读说 undefined」）"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"size 不再折 exact undefined（集合状态丢失时诚实降级为 number）"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"派生类自己定义的同名成员优先（原生覆盖内建）"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"负控制：内建父类本身的实例面不变"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"负控制：用户类父的子类实例面不变"	"回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须 读得到内建原型面（方法值读 / `@@iterator` / `size`）。 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名** 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS[\"M\"]` 不存在）→ 折 exact `\"undefined\"`；"	没测该层	keep	keep	—
"Array.prototype.push 改写后 → 数组实例调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Array.prototype.join 改写后 → 数组实例调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Map.prototype.get 改写后 → 实例调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"String.prototype.toUpperCase 改写后 → 字符串实例调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Number.prototype.toFixed 改写后 → 数字实例调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Object.prototype.toString 改写后 → 闭对象调用走用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"改写为非函数 → 调用定抛 TypeError（原生 is not a function）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：未改写时内建实现照旧（不误伤）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：原型对象上的普通数据槽（expand）照旧可读"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"读面：Array.prototype.push 改写后 typeof → number（原生读回用户写的值）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"借用面：Array.prototype.join.call([1,2]) → 用户写的实现"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol.prototype.description → TypeError（brand check）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"throws 域记 TypeError（L2 门禁不再假绿）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：Symbol(\"x\").description → \"x\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：typeof Symbol.prototype.valueOf → \"function\"（缺席面不误伤）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：Symbol.prototype 上其它键不抛（description 之外）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).foo → undefined"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(true).foo → undefined"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(1n).foo → undefined"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"对象属性读出的 number 读缺失成员 → undefined"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).foo.bar → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(true).foo.bar → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(1n).foo.bar → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"o.a.b.c（o.a 是 number）→ TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"string prim 同款（既有语义，不回归）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).toFixed(2) → \"5.00\"（prim 自有原型方法）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"typeof (5).toString → \"function\"（Object.prototype 继承名）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).valueOf() → 5（继承名仍走调用面）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).constructor.name → \"Number\"（constructor 不是「确定缺失」）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"对象面缺失成员读 → undefined（既有语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"对象面缺失成员的后续读仍记 TypeError（既有语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数组面不受影响（arr[0] 命中）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol('x').toString() → \"Symbol(x)\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol('x').toLocaleString() → \"Symbol(x)\"（不是 \"[object Symbol]\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol().toString.call(1) → TypeError（brand check 不再丢）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol.prototype.toString.call(1) → TypeError（负控制：原生同款）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"typeof Symbol().toString → \"function\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol('x').valueOf() 仍是符号自身（既有语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"(5).toString() → \"5\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"\"ab\".toString() → \"ab\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"true.toString() → \"true\""	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Object.prototype.toString.call({}) → \"[object Object]\"（泛型面不受影响）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Object.prototype.toString.call([]) → \"[object Array]\"（泛型面不受影响）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Symbol('x').description → \"x\"（既有语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"sealed 数组 length 截断写 → TypeError"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：sealed 数组 length 增长 → 合法（length = 5）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：sealed 数组 length 同长写 → 合法（不删任何属性）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：未 seal 数组 length 截断 → 合法（length = 1）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：preventExtensions 数组 length 截断 → 合法（元素仍可配置）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：frozen 数组 length 截断 → TypeError（既有正确）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：未 seal 数组 pop() → 正常（length = 2）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：sealed 数组 push() → TypeError（既有正确）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"sealed 数组 pop() → TypeError"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"sealed 数组 shift() → TypeError"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：sealed 空数组 pop() → 不抛（原生不删任何属性）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：sealed 空数组 shift() → 不抛（原生不删任何属性）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"负控制：preventExtensions 数组 pop()/shift() → 不抛（元素仍可配置）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"稀疏：sealed [1,,] 的 pop() → 不抛（末位是洞，非自有属性）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"稀疏：sealed [,,3] 的 shift() → TypeError（前移要在不可扩展数组上新增自有属性）"	"`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()` 不抛 TypeError（原生硬抛）。 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）： sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可 配置自有属性）→ 原生 TypeError；"	夹具漏形态	keep	keep	—
"A.g = 5（static getter-only）→ TypeError（catch 吸收）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"A.g = 5 无 catch → 函数抛 TypeError（throws 面）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"写抛后 getter 值不变（仍 1）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"实例面 getter-only 仍定抛（既有语义）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"static getter 配 setter → 写走 setter（不抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"static getter 读仍得 getter 值"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态数据属性写照常（A.x = 1）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"静态方法写照常"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"continue 之前的写生效：只跑 1 轮"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"continue 之前的写生效（条件 continue 形态）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"continue 之前的写生效（累加形态）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"continue 之前的写生效（if 臂内 continue）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"负控制：for (var i) 路径不变（循环变量是真绑定）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"负控制：无写时 continue 行为不变（跑满 3 轮）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"负控制：不带 continue 的写仍生效（步进基于最新值）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"负控制：break 路径不变（退出循环，计数停在 break 点）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"负控制：同块多个 for 循环不互相污染（捕获槽唯一）"	"回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对 循环变量的写不得被丢弃。 修复前：循环变量是**状态线程形参**（`(i) => { … return i;"	没测该层	keep	keep	—
"delete a.length → TypeError（表达式位：不可配置自有属性）"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"delete a.length → TypeError（语句位写回通道 $del）"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"delete a[\"length\"]（计算键）→ TypeError"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：preventExtensions 数组 delete a.length → 仍 TypeError（length 恒不可配置）"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：delete a[0]（元素可配置）→ true"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：delete 普通对象自有属性 → true"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：delete 不存在的属性 → true"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：delete 普通对象的 length 属性（可配置）→ true（数组专属规则）"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"负控制：frozen 对象删自有属性 → TypeError（既有正确）"	"`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性 → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。 根因：`delete` 的两个通道都在 `exec/runtime/members.ts` （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是 **不可配置**自有属性」；"	夹具漏形态	keep	keep	—
"Reflect.deleteProperty(靶含不可配置键, 陷阱返 true) → TypeError"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：靶上该键可配置 → 返 true（不抛）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：靶上无该键 → 返 true（不抛）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：陷阱返 false → 返 false（不抛；原生不变量不适用）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"delete p.x（运算符路径）→ TypeError（exec/runtime/members.ts 的 $delRes 陷阱臂过 enforceProxyDeleteInvariant）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制（运算符路径）：靶上该键可配置 → 返 true（不抛）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制（运算符路径）：靶上无该键 → 返 true（不抛）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制（运算符路径）：陷阱返 false → strict 定抛 TypeError（原生同）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"delete 字符串字面量的 length → TypeError（此前折 unknown）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：delete 数组的 length → TypeError（既有正确）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"负控制：delete 字符串的其它键 → 不抛（length 之外的键不受管）"	"定抛探针：结果 never + throws 面是指定错误类型"	没测该层	keep	keep	—
"Widget.constructor === Function → true"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"Widget.constructor.name → \"Function\""	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"子类的 constructor 同样是 Function"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"有体类表达式的 constructor 同样是 Function"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"typeof Widget.constructor → \"function\""	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"new Widget().constructor === Widget → true（实例面解析到类值）"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"Widget.prototype.constructor === Widget → true"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"Widget.constructor === Widget → false（不是同一个东西）"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"内建 brand（Date）的 constructor 仍解析到 Date"	"回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成 **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是 \"Function\"），不是「以类名命名的内建构造器」。 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折 **确定 false**（"	夹具漏形态	keep	keep	—
"p === t → false（代理与靶不同引用，无需读 Proxy 面）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"p === t（别名传播后，仍不经 Proxy 面读）→ false"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"p1 === p2（两个代理）→ false（每次 new Proxy 都是新对象）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"p === p → true（同一代理自反）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"靶自反仍为 true（代理构造不污染靶的新鲜身份）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"无陷阱代理的读面仍走靶（S2b 读面口径不回归）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"无 get 陷阱时回退读靶、this 绑 receiver（proxy ≠ target）"	"回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)` 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。 ⇒ 引擎在**构造点** （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的 `p === t` / `p1 === p2` 也**可判**（折 false）。"	夹具漏形态	keep	keep	—
"p.self（this === t）→ false（receiver = proxy）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"p.self === p → true（this 就是 proxy 自己）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"直接读靶：t.self（this === t）→ true（this 是靶）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"有 get 陷阱：陷阱优先（实参 target/key/receiver 不变）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"无 getter 的普通属性读穿透不变（p.x === 1）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"无 getter 的普通属性写穿透不变（p.x = 2 → 靶变）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"get 陷阱里的 receiver 仍是 proxy（this 语义不变）"	"回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须 绑到 **receiver（= proxy）**，不是 target。 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。"	没测该层	keep	keep	—
"RegExp 原型：source === \"(?:)\"、flags === \"\""	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"RegExp 原型：global 等布尔 getter 在原型上读 undefined（原生同）"	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"Error 家族原型：name / message 是原生值"	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"Intl 原型上的自有方法是函数（resolvedOptions / formatToParts）"	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"负控制：实例面不受影响（/x/gim.flags === \"gim\"）"	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"负控制：其它原型方法读仍是函数（缺席面不误伤）"	"回归：内建**原型对象**上的字符串键成员值读必须取到原生值 （`RegExp.prototype.flags` / `Error.prototype.name` / …）。 ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === \"(?:)\"、 flags === \"\"、Error.prototype.name === \"Error\"、message === \"\"）与**实例面** 取值不同（`/x/gim.flags === \"gim\"`），须分别建模。"	夹具漏形态	keep	keep	—
"Map.prototype.size → TypeError"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"Set.prototype.size → TypeError"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"throws 域记 TypeError（L2 门禁不再假绿）"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"负控制：new Map().size → 0（实例面不受影响）"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"负控制：new Set().size → 0（实例面不受影响）"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"\"size\" in Map.prototype → true（原型上的自有访问器在 presence 面可见）"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"负控制：Map.prototype 上的方法面不受影响（typeof → \"function\"）"	"回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛 TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。 读原型对象上的它 → this 不是实例 → TypeError。"	夹具漏形态	keep	keep	—
"Intl.NumberFormat.prototype.format → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Intl.DateTimeFormat.prototype.format → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Intl.Collator.prototype.compare → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Intl.Locale.prototype.baseName → TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"throws 域记 TypeError（L2 门禁不再假绿）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：同原型上的普通方法读到函数（不抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：Intl.ListFormat.prototype.format 是普通方法（不抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"负控制：实例上的 format 是函数（brand check 只在原型对象上定抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"freeze：自有键的 writable / configurable 折 false（改前仍折 true）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"seal：只折 configurable false，writable 保持 true（原生同款）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"gOPDs 同步反映冻结后的键级标志（改前仍折 true/true）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"isFrozen：空对象密封即冻结（改前折 false）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"isSealed：空对象 preventExtensions 即密封（改前折 false）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"isFrozen：preventExtensions + 收紧的键标志 ⇒ true（改前折 false）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"isFrozen：seal 后仍有可写键 ⇒ false（原生同款，负控制）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"isSealed：preventExtensions 后仍有可配置键 ⇒ false（负控制）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"gOPDs：访问器属性折 {get, set} 描述符（改前 .get 折 undefined）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"fn 接收者：冻结后可写键仍折 false + 新键写抛 TypeError（原生同款）"	"- `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结—— 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）； 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结 （gOPD(o,\"a\").writable 仍折 true / configurable 仍折 true）；"	夹具漏形态	keep	keep	—
"不可写属性被改值 → TypeError（改前静默改写成功）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"不可写属性**同值**重定义 → 允许（原生同款）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"不可配置属性改 writable / configurable / enumerable → TypeError"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"不可配置属性改访问机制（data → accessor）→ TypeError"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"seal / freeze / preventExtensions 之后建新键 → TypeError（改前静默建键）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"冻结对象上**同值**重定义 → 允许（原生同款）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"{get: undefined, value: 1} → TypeError（字段存在性语义；改前静默折 1）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"已有可配置属性：未指定字段保持原值、显式字段双向覆盖（enumerable 可恢复）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"新建属性未指定字段缺省 false（原生描述符面）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"Array.from：访问器 length 决定元素数（原生 \"a,b\"，改前 \"\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"Array.from：getter 副作用落地且**只发生一次**（原生 \"2:1\"，改前 \"0:0\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"Array.from：索引访问器的值被取到（原生 \"g\"，改前 \"\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"借用调用 slice.call：访问器 length 生效（原生 \"a,b\"，改前 \"\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"借用调用 map.call：访问器 length 生效（原生 \"A,B\"，改前 \"\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"借用调用 indexOf.call：访问器 length 生效（原生 1，改前 -1）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"索引访问器 + 数据 length：两个来源各按其读域（原生 \"a,z,\"）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"data-length 的 array-like 仍按槽读"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"迭代物（数组 / 字符串 / Set）不受 array-like 臂影响"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"无 length 槽的闭对象仍折 0 长（原生 0）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"访问器 length 返回 undefined ⇒ ToLength 0（原生 0）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"访问器 length 返回字符串 \"2\" ⇒ ToLength 2（原生 2）"	"回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。"	夹具漏形态	keep	keep	—
"L2 门禁：访问器 array-like 是**纯值错**——门禁恒绿，差异在签名"	"改前改后门禁都是 0 诊断（不抛）——差异只体现在签名值上。 回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留 `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当 undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且 getter 的副作用（计数 / 写状态"	夹具漏形态	keep	keep	—
"回调 this 是 thisArg（原生 20，改前假抛 TypeError）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"回调 this 参与返回值计算（原生 \"v1|v2\"，改前假抛）"	"元素域是 this.p + x 的 join（抽象 string）——不抛且非 unknown 即可 抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"thisArg 为 null ⇒ 回调 this 是 null（原生 \"null\"，改前 \"undefined\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"thisArg 为 undefined ⇒ 回调 this 是 undefined（原生 \"undefined\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Set 迭代物同样透传 thisArg（原生 10，改前假抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"字符串迭代物同样透传 thisArg（原生 6）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"array-like 迭代物同样透传 thisArg（原生 8）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数组 HOF 的 thisArg 仍正确（原生 14）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"未给 thisArg ⇒ 回调 this 仍是 undefined（原生 \"undefined\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"无 mapper 的 Array.from 不受影响（原生 2,4）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"箭头回调不受 thisArg 影响（原生 2）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"L2 门禁不再假红：带 thisArg 的 Array.from 不再被判 may-throw"	"改前：回调 this 恒 undefined ⇒ \"property 'k' on undefined\" ⇒ 假抛 ⇒ L2 门禁把合法的 thisArg 用法判红（原生不抛）。 抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"Reflect 面：陷阱派发并返回补全后的描述符（改前定抛 TypeError）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"Reflect 面：陷阱返回非对象 → TypeError（原生同款）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"Reflect 面：无该陷阱 → 落回靶的 [[GetOwnProperty]]（原生同款）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"非 Proxy 目标不受影响（负控制）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"陷阱派发：value 42（修前读 .value 定抛 TypeError）"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"陷阱派发：描述符被**补全**（value/writable/enumerable/configurable 原生同款）"	"原生返回的是补全后的描述符对象（不是 handler 的原对象）。 非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	夹具漏形态	keep	keep	—
"陷阱对任意键派发：实参 (target, key) 里的 key 透传（原生同款）"	"原生：陷阱以 (target, key) 被调用 ⇒ 键 \"zz\" 也走陷阱（不是靶的键集）。 非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"非 Proxy 路径不受影响：{a:1} 的自有键 value 1、缺失键 undefined"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"Reflect 面一致：同一陷阱经 Reflect 面拿到同一个 42"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"陷阱返回 undefined：不抛，且不假精确（精度缺口 TODO(族05)）"	"引擎当前折 **unknown**（更保守，不是错值）——精度缺口， 不在本次接线的范围内。 TODO(族05): 引擎与原生不一致（unknown vs undefined）——只钉「不抛」+ 「不假精确」，**不钉**「等于 undefined」。 非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的"	旧断言钉错	keep	keep	—
"陷阱返回非对象 → TypeError（ToPropertyDescriptor 前置，原生同款）"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"原型链上的键不是自有属性：gOPD({}, \"toString\") === undefined"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"普通对象的描述符三标志不变（writable/enumerable/configurable 全 true）"	"非 Proxy 接收者折 absent ⇒ **既有 分支不变**。 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒ 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。"	没测该层	keep	keep	—
"freeze：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"seal：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"freeze：defineProperty 陷阱返回 false ⇒ TypeError（改前不抛）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"freeze：preventExtensions + 逐键 defineProperty 陷阱都派发（改前一个都不派发）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"seal：同样派发两个陷阱（改前一个都不派发）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"负控制：无陷阱的 Proxy 冻结不抛（原生同款）"	"修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。"	没测该层	keep	keep	—
"Proxy defineProperty 陷阱返 false → 返 false（改前定抛 TypeError）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"Proxy defineProperty 陷阱返 true → 返 true"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"普通对象：成功 → true 且值落地"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"普通对象：重定义失败（不可配置属性改值）→ 返 false（不抛）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"描述符非法（非对象）→ 仍定抛 TypeError（原生同款）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"Object 面保持定抛口径（负控制：Object.defineProperty 仍抛）"	"入口 throws 面（brand 名）——未抛则 undefined"	没测该层	keep	keep	—
"getter 值被取到（原生 42，改前 undefined）"	"回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位） 此前被折成 exact undefined，getter **从不执行**。 缺省 ≡ target）；"	夹具漏形态	keep	keep	—
"getter 副作用真实发生（原生 1，改前 0）"	"回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位） 此前被折成 exact undefined，getter **从不执行**。 缺省 ≡ target）；"	夹具漏形态	keep	keep	—
"receiver（第 3 实参）作为 getter 的 this（原生 7）"	"回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位） 此前被折成 exact undefined，getter **从不执行**。 缺省 ≡ target）；"	夹具漏形态	keep	keep	—
"只有 setter 的键读值恒 undefined（原生同款，负控制）"	"回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位） 此前被折成 exact undefined，getter **从不执行**。 缺省 ≡ target）；"	夹具漏形态	keep	keep	—
"数据属性读值不受影响（负控制）"	"回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位） 此前被折成 exact undefined，getter **从不执行**。 缺省 ≡ target）；"	夹具漏形态	keep	keep	—
"Object.getPrototypeOf(Function.prototype) === Object.prototype → true（修前恒 false）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(Object.prototype) === null → true（链顶恒 null）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf([]) === Array.prototype → true（实例原型面不回归）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(Array.prototype) === Object.prototype → true（内建原型上一层）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(userFn) === Function.prototype → true（用户函数的原型面）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"typeof Function.prototype → \"function\"（原生同款；报告称 \"object\" 是**报告的错误**）"	"报告里的 \"object\" 无原生依据，**不得**据此写断言。 回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object"	没测该层	keep	keep	—
"typeof Object.getPrototypeOf(Function.prototype) → \"object\"（原型对象本身是对象）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(Function) === Function.prototype → true（内建构造器自身的原型面）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(Object) === Function.prototype → true（内建构造器自身的原型面）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(function(){}) === Function.prototype → true（函数表达式）"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype → true"	"回归：`Object.getPrototypeOf(Function.prototype)` 必须是 `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型 就是 Object.prototype）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Function.prototype) === Object.prototype → true Object.getProto"	没测该层	keep	keep	—
"Set 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）"	"回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true [1,2][Symbol.iterator]()[Symbol.iterator]()"	夹具漏形态	keep	keep	—
"Map 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）"	"回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true [1,2][Symbol.iterator]()[Symbol.iterator]()"	夹具漏形态	keep	keep	—
"数组迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）"	"回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true [1,2][Symbol.iterator]()[Symbol.iterator]()"	夹具漏形态	keep	keep	—
"字符串迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）"	"回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true [1,2][Symbol.iterator]()[Symbol.iterator]()"	夹具漏形态	keep	keep	—
"两个不同集合迭代器互比 → false（原生同款）"	"回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true [1,2][Symbol.iterator]()[Symbol.iterator]()"	夹具漏形态	keep	keep	—
"迭代器本身与源集合互比 → 不是精确 true（原生 false；引擎给保守 boolean 域）"	"原生：`it === s` → false（迭代器与集合是不同对象）。 引擎当前给**保守 boolean 域**（说不死）⇒ 只钉「不得说死 true」。 回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true new Map([[1,2]])[Symbol.iterator]"	夹具漏形态	keep	keep	—
"Error.prototype 自有 name / message（hasOwnProperty true）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"取值不变（name = 家族名、message = \"\"）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"\"name\" / \"message\" in Error.prototype → true"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"自有但不可枚举（propertyIsEnumerable false、for-in 不发布）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"Error 家族八个原型同款（各自 name = 家族名、message = \"\"）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"对照组：其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"constructor 自有槽不受影响（仍是原型自有、非枚举）"	"Error.prototype 的自有数据属性 name / message 缺席。 node v26.10.0 原生实测（oracle）： hasOwnProperty.call(Error.prototype,\"name\") → true hasOwnProperty.call(Error.prototype,\"message\") → true Error.prototype.name → \"Error\" Error.prototype.message → \"\" \"name\" in Error.prototyp"	没测该层	keep	keep	—
"显式 undefined 第二实参 ⇒ 返回对象、不抛（改前定抛 TypeError）"	"原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o, undefined)` 都返回对象； 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判 **确定抛 TypeError** ⇒ L2 门禁假红 +"	夹具漏形态	keep	keep	—
"负控制：1 参形态同样返回对象（与显式 undefined 同口径）"	"原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o, undefined)` 都返回对象； 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判 **确定抛 TypeError** ⇒ L2 门禁假红 +"	夹具漏形态	keep	keep	—
"负控制：null 第二实参 ⇒ TypeError（ToObject(null)，原生同款）"	"原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o, undefined)` 都返回对象； 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判 **确定抛 TypeError** ⇒ L2 门禁假红 +"	夹具漏形态	keep	keep	—
"负控制：数字第二实参 ⇒ 零自有属性的包装器、不抛（原生同款）"	"原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o, undefined)` 都返回对象； 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判 **确定抛 TypeError** ⇒ L2 门禁假红 +"	夹具漏形态	keep	keep	—
"负控制：第二实参带描述符 ⇒ 仍安装自有属性"	"原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o, undefined)` 都返回对象； 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判 **确定抛 TypeError** ⇒ L2 门禁假红 +"	夹具漏形态	keep	keep	—
"数字第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"布尔第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"空串第二实参 ⇒ 零键 ⇒ 不抛（改前定抛 TypeError）"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"负控制：null / undefined 第二实参 ⇒ TypeError（原生同款）"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"负控制：非空字符串第二实参 ⇒ TypeError（描述符是字符，非对象）"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"负控制：对象第二实参仍照常安装描述符"	"- number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的 包装器 ⇒ **不定义任何属性、不抛**； - 非空字符串 ⇒ 装箱后有下标键（\"0\"/\"1\"…）⇒ 每个「描述符」是字符（非 对象）⇒ ToPropertyDescriptor 定抛 TypeError；"	夹具漏形态	keep	keep	—
"getProto(getProto(Uint8Array.prototype)) === Object.prototype → true（链条错一级已修）"	"回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype， 它才是 Object.prototype 的子原型——原生是**两层**） Object.getPrototypeOf"	没测该层	keep	keep	—
"getProto(Array.prototype) === Object.prototype → true（对照组：一层链的原生同款）"	"回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype， 它才是 Object.prototype 的子原型——原生是**两层**） Object.getPrototypeOf"	没测该层	keep	keep	—
"getProto(Uint8Array.prototype) === Object.prototype → **不是精确 true**（原生 false）"	"修前引擎恒 true （自信的错值）； 当前引擎给**保守 boolean 域**（不 ok 的 litValue）—— 断言只钉「不得说死 true」，精度债（未说死 false）另行记账。 回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.p"	旧断言钉错	keep	keep	—
"getProto(Object.prototype) === null → true（链顶恒 null）"	"回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype， 它才是 Object.prototype 的子原型——原生是**两层**） Object.getPrototypeOf"	没测该层	keep	keep	—
"getProto(getProto(Array.prototype)) === null → true（Array.prototype 上一层即顶）"	"回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype， 它才是 Object.prototype 的子原型——原生是**两层**） Object.getPrototypeOf"	没测该层	keep	keep	—
"typeof Array.prototype === \"object\"（内建原型对象的 typeof 面不回归）"	"回归：内建原型的 [[Prototype]] 链**不再被压扁**。 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）： Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype， 它才是 Object.prototype 的子原型——原生是**两层**） Object.getPrototypeOf"	没测该层	keep	keep	—
"join.call(null) / join.call(undefined) ⇒ TypeError（改前不记抛）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"toString.call(null) / toString.call(undefined) ⇒ TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"toLocaleString.call(null) / toLocaleString.call(undefined) ⇒ TypeError"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"摘下方法值后以 null 调用 ⇒ TypeError（原生同）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"数组接收者仍折出值（原生 \"1,2\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"array-like / 字符串 / 数字 / 对象接收者不抛"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"实例方法调用不受影响（原生 \"1,2\"）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"ToString 通道不受影响（原生 \"1,2\"）"	"String([1,2]) 的读面是抽象 string（既有精度债）——只钉「不抛」 抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"同对象上其它方法的既有报红不变（原生 TypeError）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"L2 门禁不再假绿：nullish 接收者的导出函数被判 may-throw"	"改前：引擎不记抛 ⇒ 导出函数被判 total ⇒ 0 诊断（假绿） 抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"L2 门禁负控制：非 nullish 接收者仍是 total（0 诊断）"	"抛错名（无抛错 → \"\"）"	没测该层	keep	keep	—
"原生不报错：新 prototype 读得出（node v26.10.0：typeof F.prototype.x === 'number'）"	"throws 面 = never（无抛）——原生不报错 F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"转译侧不得重绑 const 根（原生：成员写不动绑定）"	"写照旧发出（$set 落 fn Abs 的槽面——就地写） 但**不得**重绑根绑定 F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：let 绑定维持既有根重绑通道（B1：现经 $rebindable 守卫）"	"B1：宿主全局不重绑（自赋值 no-op），Abs 绑定与局部宿主函数照旧重绑 F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：非函数表达式的 const 绑定维持既有根重绑通道（收窄口径）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：函数声明（宿主函数）维持既有根重绑通道"	"局部宿主函数（globalThis.F 不存在）⇒ $rebindable 为真 ⇒ 门面写回绑定 F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"用户标识符撞引擎临时名：求值不得 fail-closed（node：12）"	"`__nudoTm_0` 是引擎的 try 临时名——用户同名 ⇒ 此前产物重复词法声明 （SyntaxError）⇒ body 编译失败 ⇒ 回落 unknown / 抛错。 F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"catch 临时名撞名同样不丢（node：12）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：不撞名的 body 求值逐字不变（node：12）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"避让集来自 AST 词形（body 内 Identifier + 形参）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"删方法后 super 调用定抛 TypeError（原生：TypeError）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"用户的 try/catch 吸收该 TypeError（原生：'TypeError'）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：方法未删时 super 调用照常（原生：1）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：Object.prototype 成员不判缺席（super.toString 原生存在）"	"引擎不建 Object.prototype 方法的调用面 ⇒ 折 unknown（**不假抛**） F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：动态原型写（注册表外）不判缺席（原生有该方法 ⇒ 不抛）"	"原生该方法存在（动态写）⇒ 不该抛； 引擎保守折 unknown（不假抛） F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"mk().x += 2 折 3（原生 3）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"计算键同款：mk()[k] += 2 折 3（原生 3）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：可重绑根的复合赋值逐字不变（原生 3）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：接收者只求值一次（原生 [3, 1]）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"派生 Map 实例读得回条目（原生：1 / true / 1）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"派生 Set 实例读得回元素面（原生：2 / true）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：缺席键仍折 undefined（原生：undefined）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：用户同名方法优先（原生：'own'）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"负控：普通 Map 逐字不变（原生：1）"	"F.prototype = {}` ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根 绑定。 原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定）， `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。"	夹具漏形态	keep	keep	—
"成员在签名面可按名查到，返回类型是实值（string）"	"`module.exports = { f: fn }`（CJS 对象字面量导出）的函数在 **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。 本文件钉住： - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值， 且不再产生 nudo:opaque-result；"	夹具漏形态	keep	keep	—
"不再产生指向错误的 nudo:opaque-result"	"`module.exports = { f: fn }`（CJS 对象字面量导出）的函数在 **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。 本文件钉住： - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值， 且不再产生 nudo:opaque-result；"	夹具漏形态	keep	keep	—
"负控制：普通 CJS 具名导出行为不变（exports.f = fn）"	"`module.exports = { f: fn }`（CJS 对象字面量导出）的函数在 **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。 本文件钉住： - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值， 且不再产生 nudo:opaque-result；"	夹具漏形态	keep	keep	—
"负控制：成员桥不得劫持无关的本地函数"	"`module.exports = { f: fn }`（CJS 对象字面量导出）的函数在 **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。 本文件钉住： - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值， 且不再产生 nudo:opaque-result；"	夹具漏形态	keep	keep	—
"原生 oracle：CJS 成员挂在 exports 对象上（node 另起进程对拍）"	"`module.exports = { f: fn }`（CJS 对象字面量导出）的函数在 **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。 本文件钉住： - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值， 且不再产生 nudo:opaque-result；"	夹具漏形态	keep	keep	—
```
