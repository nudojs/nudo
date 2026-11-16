# packages/core/src/algebra/__tests__/algebra-eval-objects.test.ts

模块套件：求值面：对象/类/成员/访问器。

审计：656 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
表外记抛/表内不抛/数据成员不误报/非封闭不判/平 obj 不变/内建原型不判/L2 同口径/同步守卫/模式排除	brand/fn-sum 表	没测该层	keep	keep	—
fn 两臂/单臂/空静态面/无面/原型名；prim/brand/obj/tuple/eff 既有派发；端到端响应	brand/fn-sum 表	没测该层	keep	keep	—
定义期一次/构造不重复/键不漂移/抛错在定义期/两处定义各一次；静态键与公有字段不变；抽象键不挂名	计算键/static 表	没测该层	keep	keep	—
块在前/三段交错/副作用序；字段在前/外层变量/块内 this 负控	计算键/static 表	没测该层	keep	keep	—
数据属性胜出/最后一个定义/展开与拷贝/副作用与枚举/symbol 与动态键；负控单访问器/对/数据-数据/其它键	重复键仲裁表	没测该层	keep	keep	—
getter 先于实参：对象/类/静态/嵌套/计算键/抛错/非函数/只读一次	访问器求值序表	没测该层	keep	keep	—
负控：数据槽/super/私有名/数组方法/this 绑定不变	访问器求值序表	没测该层	keep	keep	—
static { this.x = super.m } → 父类静态成员值（原生 1）	计算键/static 表	没测该层	keep	keep	—
static 块内 super.m 参与运算（原生 3）	计算键/static 表	没测该层	keep	keep	—
负控制：静态字段里的 super 仍读父类静态成员	计算键/static 表	没测该层	keep	keep	—
负控制：静态方法里的 super 仍读父类静态成员	计算键/static 表	没测该层	keep	keep	—
负控制：实例方法里的 super 仍读父类原型链（不被静态口径污染）	计算键/static 表	没测该层	keep	keep	—
跨类读写/调用/静态私有抛 TypeError；派生同名不覆盖；in 只看本类；同类与 introspection 负控	私有名/模板表	没测该层	keep	keep	—
属性为 undefined → 取默认值并写回成员	计算键/static 表	没测该层	keep	keep	—
属性有值 → 写回该值（默认值不生效）	计算键/static 表	没测该层	keep	keep	—
嵌套成员目标（o.x.y = 7）同样写回	计算键/static 表	没测该层	keep	keep	—
数组模式的成员目标带默认值（[o.x = 1] = src）同样写回	计算键/static 表	没测该层	keep	keep	—
负控制：标识符目标带默认值（{ a = 1 }）行为不变	计算键/static 表	没测该层	keep	keep	—
负控制：成员目标**不带**默认值仍写回（既有行为不回归）	计算键/static 表	没测该层	keep	keep	—
负控制：嵌套模式 + 默认（{ a: { b } = {} }）行为不变	计算键/static 表	没测该层	keep	keep	—
函数表达式 + .call(receiver)：默认值读到接收者	计算键/static 表	没测该层	keep	keep	—
函数声明 + .call(receiver)：默认值读到接收者	计算键/static 表	没测该层	keep	keep	—
方法体内的函数表达式：默认值 this = undefined ⇒ TypeError（原生同）	计算键/static 表	没测该层	keep	keep	—
方法体内的函数声明：默认值 this = undefined ⇒ TypeError（原生同）	计算键/static 表	没测该层	keep	keep	—
普通调用（严格模式）this = undefined（不是全局对象）	计算键/static 表	没测该层	keep	keep	—
箭头表达式的 this 仍词法继承外层（箭头无自己的 this）	计算键/static 表	没测该层	keep	keep	—
方法自身的默认值（m(x = this.v)）仍是 3	计算键/static 表	没测该层	keep	keep	—
箭头默认值的 this 词法继承外层方法（`() => this.v` 同）	计算键/static 表	没测该层	keep	keep	—
for (o.x of [1,2,3]) 后 o.x === 3	计算键/static 表	没测该层	keep	keep	—
for (o.x in {a:1,b:2}) 后 o.x === 'b'	计算键/static 表	没测该层	keep	keep	—
头写回后体内可读到当轮值	计算键/static 表	没测该层	keep	keep	—
计算键成员头：o[key] 写回生效	计算键/static 表	没测该层	keep	keep	—
多层成员头：o.a.x 写回生效	计算键/static 表	没测该层	keep	keep	—
标识符头：for (x of …) 写回既有绑定	计算键/static 表	没测该层	keep	keep	—
标识符头（for-in）：for (k in …) 写回既有绑定	计算键/static 表	没测该层	keep	keep	—
标识符头写 const 绑定 = 原生 TypeError（写回通道的 const 守卫）	计算键/static 表	没测该层	keep	keep	—
for (o.x of [1,2,3]) 后 o.x 折出 3（不再是旧值 0）	计算键/static 表	没测该层	keep	keep	—
const 头不写回外层绑定（仍是块级每轮新绑定）	计算键/static 表	没测该层	keep	keep	—
let 头不写回外层绑定	计算键/static 表	没测该层	keep	keep	—
未被头赋值的成员保持旧值	计算键/static 表	没测该层	keep	keep	—
成员头不影响其它成员	计算键/static 表	没测该层	keep	keep	—
if 测试位：比较用旧值，写回在求值点	计算键/static 表	没测该层	keep	keep	—
if 测试位：前缀与字符串分支同样走对	计算键/static 表	没测该层	keep	keep	—
switch 判别位：判别式取旧值（匹配 case 0）	计算键/static 表	没测该层	keep	keep	—
for 步进位：计数器前进（不撞迭代上限）	计算键/static 表	没测该层	keep	keep	—
while 测试位：写回在求值点（多一次自增）	计算键/static 表	没测该层	keep	keep	—
负控制：标识符目标 / 复合赋值 / 语句位不受影响	计算键/static 表	没测该层	keep	keep	—
{ __proto__: P, b: B } → 副作用序 P → B	计算键/static 表	没测该层	keep	keep	—
{ b: B, __proto__: P } → 副作用序 B → P	计算键/static 表	没测该层	keep	keep	—
{ a: A, __proto__: P, b: B } → 副作用序 A → P → B	计算键/static 表	没测该层	keep	keep	—
只有 __proto__ 的字面量 → 值表达式仍求值一次	计算键/static 表	没测该层	keep	keep	—
__proto__ 的值表达式只求值一次	计算键/static 表	没测该层	keep	keep	—
原型设定仍生效（getPrototypeOf 命中该原型）	计算键/static 表	没测该层	keep	keep	—
__proto__ 仍不是自有键（Object.keys 不含它）	计算键/static 表	没测该层	keep	keep	—
primitive 原型值被忽略（原型仍是 Object.prototype）	计算键/static 表	没测该层	keep	keep	—
普通字面量的属性求值序不变（无 __proto__ 时不插 IIFE）	计算键/static 表	没测该层	keep	keep	—
带 __proto__ 的字面量才引入盒子 IIFE（求值序载体）	计算键/static 表	没测该层	keep	keep	—
无 __proto__ 的字面量：属性值求值序不变	计算键/static 表	没测该层	keep	keep	—
方法名 __proto__ 仍是自有键（不是原型设定）	计算键/static 表	没测该层	keep	keep	—
字面量里的 this 仍指向外层（IIFE 不得改 this 绑定）	计算键/static 表	没测该层	keep	keep	—
带 __proto__ 的字面量里 this 绑定同样不变（IIFE 路径）	计算键/static 表	没测该层	keep	keep	—
D1 o.a.b = 2：写在 getter 返回的对象上（原生 1——getter 每次新对象）	计算键/static 表	没测该层	keep	keep	—
D2 h.inner.c += 1：写在 getter 返回的对象上（原生 2——同一对象）	计算键/static 表	没测该层	keep	keep	—
D3 o.a.b = 2 不得触发中间层 a 的 setter（原生 0）	计算键/static 表	没测该层	keep	keep	—
D4 冻结根的内层仍可写（原生 2——原生不对中间层做 [[Set]]）	计算键/static 表	没测该层	keep	keep	—
D5 o.a.b += 2（a 是 getter）→ 原生 1，且不抛	计算键/static 表	没测该层	keep	keep	—
D6 o.a.b = 2（a 是只读 getter）不抛 TypeError（原生 ok）	计算键/static 表	没测该层	keep	keep	—
D7 delete o.a.b（a 是 getter）不抛（原生 ok）	计算键/static 表	没测该层	keep	keep	—
D8 o.a.b++（a 是 getter）不抛（原生 ok）	计算键/static 表	没测该层	keep	keep	—
E1 负控制：单层写 o.a = {b:5}（数据属性）→ 5	计算键/static 表	没测该层	keep	keep	—
E2 负控制：单层写 o.a = 5 仍触发 setter → 5	计算键/static 表	没测该层	keep	keep	—
E3 负控制：单层写 o.a = 5（只读访问器）仍定抛 TypeError	计算键/static 表	没测该层	keep	keep	—
E4 负控制：数据属性链 o.a.b = 2 → 2	计算键/static 表	没测该层	keep	keep	—
E5 负控制：数据属性链 o.a.b += 2 → 3	计算键/static 表	没测该层	keep	keep	—
E6 负控制：数据属性链 o.a.b++ → 2	计算键/static 表	没测该层	keep	keep	—
E7 负控制：delete o.a.b（数据属性链）→ gone	计算键/static 表	没测该层	keep	keep	—
getter 槽投影成读域值（原生读 1），不是 exact undefined	计算键/static 表	没测该层	keep	keep	—
formatAbs（无损面）的 shape 段同口径	计算键/static 表	没测该层	keep	keep	—
getter 槽投影成字符串读域（原生读 "s"）	计算键/static 表	没测该层	keep	keep	—
getter 以 this 为接收者读域（原生 this.n = 41）	计算键/static 表	没测该层	keep	keep	—
嵌套对象的 getter 槽同样按读域投影	计算键/static 表	没测该层	keep	keep	—
getter + 数据属性同对象：各按各自读域投影	计算键/static 表	没测该层	keep	keep	—
守卫面按 getter 读域判定（原生读 data.ab 得 1）	计算键/static 表	没测该层	keep	keep	—
契约投影（zod / standard 面的同源）取 getter 读域	计算键/static 表	没测该层	keep	keep	—
契约门禁：getter 返回值满足 shape 契约（改前假红）	计算键/static 表	没测该层	keep	keep	—
普通数据属性仍渲染成它的值类型	计算键/static 表	没测该层	keep	keep	—
显式 undefined 数据属性仍渲染成 undefined	计算键/static 表	没测该层	keep	keep	—
仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确	计算键/static 表	没测该层	keep	keep	—
getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined	计算键/static 表	没测该层	keep	keep	—
无访问器的对象不受影响（空对象）	计算键/static 表	没测该层	keep	keep	—
typeof A.prototype.m → "function"（owner 自有方法）	计算键/static 表	没测该层	keep	keep	—
"m" in A.prototype → true	计算键/static 表	没测该层	keep	keep	—
派生类自有方法：B.prototype.own → "function" / in → true	计算键/static 表	没测该层	keep	keep	—
祖先类方法（原型链继承）：B.prototype.base → "function"	计算键/static 表	没测该层	keep	keep	—
方法恒等：A.prototype.m === new A().m（同一函数对象）	计算键/static 表	没测该层	keep	keep	—
负控制：缺席方法仍是 undefined / in → false	计算键/static 表	没测该层	keep	keep	—
负控制：A.prototype instanceof A → false（owner 不在自己的原型链上）	计算键/static 表	没测该层	keep	keep	—
负控制：B.prototype instanceof A → true（原型链继承）	计算键/static 表	没测该层	keep	keep	—
A.prototype.hasOwnProperty("m") → true（owner 自有方法）	计算键/static 表	没测该层	keep	keep	—
负控制：祖先类方法不在 B.prototype 自有面 → false	计算键/static 表	没测该层	keep	keep	—
负控制：缺席键 → false	计算键/static 表	没测该层	keep	keep	—
A.prototype.propertyIsEnumerable("m") → false（类方法非枚举）	计算键/static 表	没测该层	keep	keep	—
Object.getOwnPropertyDescriptor(A.prototype,"m") → 精确描述符（此前折并 ⇒ 读 .value 定抛）	计算键/static 表	没测该层	keep	keep	—
钩子摘条目/继承面同步/不误伤静态与别的类/幂等；端到端读面与 in 面	原型删除钩子表	没测该层	keep	keep	—
调用面：删除/从未定义/非函数值均抛；try/catch 可吸收；读面与静态/内建负控	原型删除钩子表	没测该层	keep	keep	—
冻结/枚举/序列化/for-in/数组方法；普通对象不外溢	私有名/模板表	没测该层	keep	keep	—
模板对象与多段均 true；普通对象/字符串/迭代器 false	私有名/模板表	没测该层	keep	keep	—
.call(外来对象) → 方法体以该对象为 this 执行	计算键/static 表	没测该层	keep	keep	—
.apply(外来对象) → 同口径	计算键/static 表	没测该层	keep	keep	—
.bind(外来对象)() → 同口径	计算键/static 表	没测该层	keep	keep	—
.call(undefined) → this=undefined，方法体不碰 this 时不抛	计算键/static 表	没测该层	keep	keep	—
静态方法借用（.call）→ 静态方法体 + 该接收者	计算键/static 表	没测该层	keep	keep	—
静态方法摘下后借用 → 静态方法体	计算键/static 表	没测该层	keep	keep	—
HOF 传递（数组 map 回调）→ 方法体正常执行（this=undefined 不抛）	计算键/static 表	没测该层	keep	keep	—
派生类实例的方法借用 → 沿派生类方法体执行	计算键/static 表	没测该层	keep	keep	—
借用给本类实例 → this = 该实例（this.x 为 undefined）	计算键/static 表	没测该层	keep	keep	—
借用不记 may-throw（throws 域干净）	计算键/static 表	没测该层	keep	keep	—
负控制：对象字面量方法的借用不受影响（原本就正确）	计算键/static 表	没测该层	keep	keep	—
负控制：方法体真读 undefined 接收者的 this 时定抛 TypeError	计算键/static 表	没测该层	keep	keep	—
类实例 Reflect.set：原型 writable:false/getter-only/派生类返 false；可写与新键负控	类实例 [[Set]] 写门表	没测该层	keep	keep	—
类实例 strict：原型 writable:false/getter-only 抛；可写与自有字段不抛	类实例 [[Set]] 写门表	没测该层	keep	keep	—
Reflect.set 镜像返 false 不抛；原型槽落地可见；strict 赋值仍抛	类实例 [[Set]] 写门表	没测该层	keep	keep	—
[[Set]] 原型链写门：getter/writable:false/frozen/两级链/fn/数组下标抛；负控成功	类实例 [[Set]] 写门表	没测该层	keep	keep	—
assign/defineProperty 写进原型对象：for-in/实例读/原型读/hasOwn 可见；非 obj 源与负控	brand 原型写表	没测该层	keep	keep	—
for..in 沿 brand 原型链枚举：实例/个数/function/派生链/覆写；方法与自有键负控	brand 原型写表	没测该层	keep	keep	—
类体字符串键不当钩子；可读可调/继承/实参口径不变；符号键仍是钩子；槽标记区分	hasInstance 表	没测该层	keep	keep	—
obj 字符串键 TypeError；类值字符串键 false；真 Symbol 钩子生效；普通对象 RHS TypeError	hasInstance 表	没测该层	keep	keep	—
Symbol.toStringTag：Map / Set / Promise 原型上是字符串标签	计算键/static 表	没测该层	keep	keep	—
Symbol.iterator：Map / Set / Array / String 原型上是函数	计算键/static 表	没测该层	keep	keep	—
Symbol.toPrimitive：Date 原型上是函数	计算键/static 表	没测该层	keep	keep	—
RegExp 原型上的 match / replace / search / split 是函数	计算键/static 表	没测该层	keep	keep	—
Symbol.unscopables：Array 原型上是 16 键对象	计算键/static 表	没测该层	keep	keep	—
实例面经原型链继承同一成员（new Map()[Symbol.toStringTag]）	计算键/static 表	没测该层	keep	keep	—
Map 原型的 @@iterator 借调落到集合迭代派发（不再假抛）	计算键/static 表	没测该层	keep	keep	—
负控制：字符串键成员不受影响（Map.prototype.get 仍是函数）	计算键/static 表	没测该层	keep	keep	—
函数构造器实例：Object.setPrototypeOf(f, null) → false	计算键/static 表	没测该层	keep	keep	—
类实例：Object.setPrototypeOf(a, null) → false	计算键/static 表	没测该层	keep	keep	—
负控制：未改写原型的实例仍折 exact true	计算键/static 表	没测该层	keep	keep	—
负控制：派生类实例 instanceof 父类 → true	计算键/static 表	没测该层	keep	keep	—
负控制：原型对象 instanceof 自身 → false；instanceof 父类 → true	计算键/static 表	没测该层	keep	keep	—
F.prototype = {} 之后 f instanceof F → false（实例记录真实 [[Prototype]]）	计算键/static 表	没测该层	keep	keep	—
F.prototype = 5 之后 f instanceof F → TypeError（RHS prototype 非对象）	计算键/static 表	没测该层	keep	keep	—
换原型前造的旧实例与换后造的新实例可区分（原生 "false|true"）	计算键/static 表	没测该层	keep	keep	—
原型替换后新造的实例仍 instanceof 构造器 → true	计算键/static 表	没测该层	keep	keep	—
原型替换写成 null → TypeError（RHS prototype 非对象）	计算键/static 表	没测该层	keep	keep	—
setPrototypeOf 到普通对象后不再折 exact true（原型链不可判 → 降 boolean）	计算键/static 表	没测该层	keep	keep	—
负控制：原型替换后 fn 仍可调用、prototype 读回是新原型	计算键/static 表	没测该层	keep	keep	—
A.prototype = {} → TypeError（catch 吸收）	计算键/static 表	没测该层	keep	keep	—
A.prototype = {} 无 catch → 函数抛 TypeError（throws 面）	计算键/static 表	没测该层	keep	keep	—
写穿后类的实例方法仍在（写没生效）	计算键/static 表	没测该层	keep	keep	—
子类（extends）同样不可写原型	计算键/static 表	没测该层	keep	keep	—
有体类表达式的原型同样不可写	计算键/static 表	没测该层	keep	keep	—
原型对象上的普通写不受影响（A.prototype.m = 1 → 读回 1）	计算键/static 表	没测该层	keep	keep	—
类的静态成员写照常（A.x = 1）	计算键/static 表	没测该层	keep	keep	—
静态方法写不受影响	计算键/static 表	没测该层	keep	keep	—
Object.defineProperty(C.prototype, ...) 的就地改原型写回不受本门影响	计算键/static 表	没测该层	keep	keep	—
读 A.prototype 仍是原型对象（读面不受写门影响）	计算键/static 表	没测该层	keep	keep	—
实例字段写不受影响	计算键/static 表	没测该层	keep	keep	—
Set / Map / WeakMap 子类实例读得到内建方法	计算键/static 表	没测该层	keep	keep	—
Date / RegExp 子类实例读得到内建方法	计算键/static 表	没测该层	keep	keep	—
prim 包装父类（Number / String）子类实例读得到原型方法	计算键/static 表	没测该层	keep	keep	—
@@iterator：子类实例经原型链继承（typeof → function）	计算键/static 表	没测该层	keep	keep	—
读面与 in 面一致（不再「in 说有、读说 undefined」）	计算键/static 表	没测该层	keep	keep	—
size 不再折 exact undefined（集合状态丢失时诚实降级为 number）	计算键/static 表	没测该层	keep	keep	—
派生类自己定义的同名成员优先（原生覆盖内建）	计算键/static 表	没测该层	keep	keep	—
负控制：内建父类本身的实例面不变	计算键/static 表	没测该层	keep	keep	—
负控制：用户类父的子类实例面不变	计算键/static 表	没测该层	keep	keep	—
Array.prototype.push 改写后 → 数组实例调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
Array.prototype.join 改写后 → 数组实例调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
Map.prototype.get 改写后 → 实例调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
String.prototype.toUpperCase 改写后 → 字符串实例调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
Number.prototype.toFixed 改写后 → 数字实例调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
Object.prototype.toString 改写后 → 闭对象调用走用户写的实现	计算键/static 表	没测该层	keep	keep	—
改写为非函数 → 调用定抛 TypeError（原生 is not a function）	计算键/static 表	没测该层	keep	keep	—
负控制：未改写时内建实现照旧（不误伤）	计算键/static 表	没测该层	keep	keep	—
负控制：原型对象上的普通数据槽（expand）照旧可读	计算键/static 表	没测该层	keep	keep	—
读面：Array.prototype.push 改写后 typeof → number（原生读回用户写的值）	计算键/static 表	没测该层	keep	keep	—
借用面：Array.prototype.join.call([1,2]) → 用户写的实现	计算键/static 表	没测该层	keep	keep	—
Symbol.prototype.description → TypeError（brand check）	计算键/static 表	没测该层	keep	keep	—
throws 域记 TypeError（L2 门禁不再假绿）	计算键/static 表	没测该层	keep	keep	—
throws 域记 TypeError（L2 门禁不再假绿）	计算键/static 表	没测该层	keep	keep	—
throws 域记 TypeError（L2 门禁不再假绿）	计算键/static 表	没测该层	keep	keep	—
负控制：Symbol("x").description → "x"	计算键/static 表	没测该层	keep	keep	—
负控制：typeof Symbol.prototype.valueOf → "function"（缺席面不误伤）	计算键/static 表	没测该层	keep	keep	—
负控制：Symbol.prototype 上其它键不抛（description 之外）	计算键/static 表	没测该层	keep	keep	—
(5).foo → undefined	计算键/static 表	没测该层	keep	keep	—
(true).foo → undefined	计算键/static 表	没测该层	keep	keep	—
(1n).foo → undefined	计算键/static 表	没测该层	keep	keep	—
对象属性读出的 number 读缺失成员 → undefined	计算键/static 表	没测该层	keep	keep	—
(5).foo.bar → TypeError	计算键/static 表	没测该层	keep	keep	—
(true).foo.bar → TypeError	计算键/static 表	没测该层	keep	keep	—
(1n).foo.bar → TypeError	计算键/static 表	没测该层	keep	keep	—
o.a.b.c（o.a 是 number）→ TypeError	计算键/static 表	没测该层	keep	keep	—
string prim 同款（既有语义，不回归）	计算键/static 表	没测该层	keep	keep	—
(5).toFixed(2) → "5.00"（prim 自有原型方法）	计算键/static 表	没测该层	keep	keep	—
typeof (5).toString → "function"（Object.prototype 继承名）	计算键/static 表	没测该层	keep	keep	—
(5).valueOf() → 5（继承名仍走调用面）	计算键/static 表	没测该层	keep	keep	—
(5).constructor.name → "Number"（constructor 不是「确定缺失」）	计算键/static 表	没测该层	keep	keep	—
对象面缺失成员读 → undefined（既有语义）	计算键/static 表	没测该层	keep	keep	—
对象面缺失成员的后续读仍记 TypeError（既有语义）	计算键/static 表	没测该层	keep	keep	—
数组面不受影响（arr[0] 命中）	计算键/static 表	没测该层	keep	keep	—
Symbol('x').toString() → "Symbol(x)"	计算键/static 表	没测该层	keep	keep	—
Symbol('x').toLocaleString() → "Symbol(x)"（不是 "[object Symbol]"）	计算键/static 表	没测该层	keep	keep	—
Symbol().toString.call(1) → TypeError（brand check 不再丢）	计算键/static 表	没测该层	keep	keep	—
Symbol.prototype.toString.call(1) → TypeError（负控制：原生同款）	计算键/static 表	没测该层	keep	keep	—
typeof Symbol().toString → "function"	计算键/static 表	没测该层	keep	keep	—
Symbol('x').valueOf() 仍是符号自身（既有语义）	计算键/static 表	没测该层	keep	keep	—
(5).toString() → "5"	计算键/static 表	没测该层	keep	keep	—
"ab".toString() → "ab"	计算键/static 表	没测该层	keep	keep	—
true.toString() → "true"	计算键/static 表	没测该层	keep	keep	—
Object.prototype.toString.call({}) → "[object Object]"（泛型面不受影响）	计算键/static 表	没测该层	keep	keep	—
Object.prototype.toString.call([]) → "[object Array]"（泛型面不受影响）	计算键/static 表	没测该层	keep	keep	—
Symbol('x').description → "x"（既有语义）	计算键/static 表	没测该层	keep	keep	—
sealed 数组 length 截断写 → TypeError	计算键/static 表	没测该层	keep	keep	—
负控制：sealed 数组 length 增长 → 合法（length = 5）	计算键/static 表	没测该层	keep	keep	—
负控制：sealed 数组 length 同长写 → 合法（不删任何属性）	计算键/static 表	没测该层	keep	keep	—
负控制：未 seal 数组 length 截断 → 合法（length = 1）	计算键/static 表	没测该层	keep	keep	—
负控制：preventExtensions 数组 length 截断 → 合法（元素仍可配置）	计算键/static 表	没测该层	keep	keep	—
负控制：frozen 数组 length 截断 → TypeError（既有正确）	计算键/static 表	没测该层	keep	keep	—
负控制：未 seal 数组 pop() → 正常（length = 2）	计算键/static 表	没测该层	keep	keep	—
负控制：sealed 数组 push() → TypeError（既有正确）	计算键/static 表	没测该层	keep	keep	—
sealed 数组 pop() → TypeError	计算键/static 表	没测该层	keep	keep	—
sealed 数组 shift() → TypeError	计算键/static 表	没测该层	keep	keep	—
负控制：sealed 空数组 pop() → 不抛（原生不删任何属性）	计算键/static 表	没测该层	keep	keep	—
负控制：sealed 空数组 shift() → 不抛（原生不删任何属性）	计算键/static 表	没测该层	keep	keep	—
负控制：preventExtensions 数组 pop()/shift() → 不抛（元素仍可配置）	计算键/static 表	没测该层	keep	keep	—
稀疏：sealed [1,,] 的 pop() → 不抛（末位是洞，非自有属性）	计算键/static 表	没测该层	keep	keep	—
稀疏：sealed [,,3] 的 shift() → TypeError（前移要在不可扩展数组上新增自有属性）	计算键/static 表	没测该层	keep	keep	—
A.g = 5（static getter-only）→ TypeError（catch 吸收）	计算键/static 表	没测该层	keep	keep	—
A.g = 5 无 catch → 函数抛 TypeError（throws 面）	计算键/static 表	没测该层	keep	keep	—
写抛后 getter 值不变（仍 1）	计算键/static 表	没测该层	keep	keep	—
实例面 getter-only 仍定抛（既有语义）	计算键/static 表	没测该层	keep	keep	—
static getter 配 setter → 写走 setter（不抛）	计算键/static 表	没测该层	keep	keep	—
static getter 读仍得 getter 值	计算键/static 表	没测该层	keep	keep	—
静态数据属性写照常（A.x = 1）	计算键/static 表	没测该层	keep	keep	—
静态方法写照常	计算键/static 表	没测该层	keep	keep	—
continue 之前的写生效：只跑 1 轮	计算键/static 表	没测该层	keep	keep	—
continue 之前的写生效（条件 continue 形态）	计算键/static 表	没测该层	keep	keep	—
continue 之前的写生效（累加形态）	计算键/static 表	没测该层	keep	keep	—
continue 之前的写生效（if 臂内 continue）	计算键/static 表	没测该层	keep	keep	—
负控制：for (var i) 路径不变（循环变量是真绑定）	计算键/static 表	没测该层	keep	keep	—
负控制：无写时 continue 行为不变（跑满 3 轮）	计算键/static 表	没测该层	keep	keep	—
负控制：不带 continue 的写仍生效（步进基于最新值）	计算键/static 表	没测该层	keep	keep	—
负控制：break 路径不变（退出循环，计数停在 break 点）	计算键/static 表	没测该层	keep	keep	—
负控制：同块多个 for 循环不互相污染（捕获槽唯一）	计算键/static 表	没测该层	keep	keep	—
delete a.length 各通道抛；元素/普通属性/不存在/普通 length/frozen 负控	delete 写门表	没测该层	keep	keep	—
Proxy [[Delete]] 不变量与字符串 length 门；负控	delete 写门表	没测该层	keep	keep	—
Widget.constructor === Function → true	计算键/static 表	没测该层	keep	keep	—
Widget.constructor.name → "Function"	计算键/static 表	没测该层	keep	keep	—
子类的 constructor 同样是 Function	计算键/static 表	没测该层	keep	keep	—
有体类表达式的 constructor 同样是 Function	计算键/static 表	没测该层	keep	keep	—
typeof Widget.constructor → "function"	计算键/static 表	没测该层	keep	keep	—
new Widget().constructor === Widget → true（实例面解析到类值）	计算键/static 表	没测该层	keep	keep	—
Widget.prototype.constructor === Widget → true	计算键/static 表	没测该层	keep	keep	—
Widget.constructor === Widget → false（不是同一个东西）	计算键/static 表	没测该层	keep	keep	—
内建 brand（Date）的 constructor 仍解析到 Date	计算键/static 表	没测该层	keep	keep	—
p === t → false（代理与靶不同引用，无需读 Proxy 面）	计算键/static 表	没测该层	keep	keep	—
p === t（别名传播后，仍不经 Proxy 面读）→ false	计算键/static 表	没测该层	keep	keep	—
p1 === p2（两个代理）→ false（每次 new Proxy 都是新对象）	计算键/static 表	没测该层	keep	keep	—
p === p → true（同一代理自反）	计算键/static 表	没测该层	keep	keep	—
靶自反仍为 true（代理构造不污染靶的新鲜身份）	计算键/static 表	没测该层	keep	keep	—
无陷阱代理的读面仍走靶（S2b 读面口径不回归）	计算键/static 表	没测该层	keep	keep	—
无 get 陷阱时回退读靶、this 绑 receiver（proxy ≠ target）	计算键/static 表	没测该层	keep	keep	—
p.self（this === t）→ false（receiver = proxy）	计算键/static 表	没测该层	keep	keep	—
p.self === p → true（this 就是 proxy 自己）	计算键/static 表	没测该层	keep	keep	—
直接读靶：t.self（this === t）→ true（this 是靶）	计算键/static 表	没测该层	keep	keep	—
有 get 陷阱：陷阱优先（实参 target/key/receiver 不变）	计算键/static 表	没测该层	keep	keep	—
无 getter 的普通属性读穿透不变（p.x === 1）	计算键/static 表	没测该层	keep	keep	—
无 getter 的普通属性写穿透不变（p.x = 2 → 靶变）	计算键/static 表	没测该层	keep	keep	—
get 陷阱里的 receiver 仍是 proxy（this 语义不变）	计算键/static 表	没测该层	keep	keep	—
RegExp 原型：source === "(?:)"、flags === ""	计算键/static 表	没测该层	keep	keep	—
RegExp 原型：global 等布尔 getter 在原型上读 undefined（原生同）	计算键/static 表	没测该层	keep	keep	—
Error 家族原型：name / message 是原生值	计算键/static 表	没测该层	keep	keep	—
Intl 原型上的自有方法是函数（resolvedOptions / formatToParts）	计算键/static 表	没测该层	keep	keep	—
负控制：实例面不受影响（/x/gim.flags === "gim"）	计算键/static 表	没测该层	keep	keep	—
负控制：其它原型方法读仍是函数（缺席面不误伤）	计算键/static 表	没测该层	keep	keep	—
Map.prototype.size → TypeError	计算键/static 表	没测该层	keep	keep	—
Set.prototype.size → TypeError	计算键/static 表	没测该层	keep	keep	—
负控制：new Map().size → 0（实例面不受影响）	计算键/static 表	没测该层	keep	keep	—
负控制：new Set().size → 0（实例面不受影响）	计算键/static 表	没测该层	keep	keep	—
"size" in Map.prototype → true（原型上的自有访问器在 presence 面可见）	计算键/static 表	没测该层	keep	keep	—
负控制：Map.prototype 上的方法面不受影响（typeof → "function"）	计算键/static 表	没测该层	keep	keep	—
Intl.NumberFormat.prototype.format → TypeError	计算键/static 表	没测该层	keep	keep	—
Intl.DateTimeFormat.prototype.format → TypeError	计算键/static 表	没测该层	keep	keep	—
Intl.Collator.prototype.compare → TypeError	计算键/static 表	没测该层	keep	keep	—
Intl.Locale.prototype.baseName → TypeError	计算键/static 表	没测该层	keep	keep	—
负控制：同原型上的普通方法读到函数（不抛）	计算键/static 表	没测该层	keep	keep	—
负控制：Intl.ListFormat.prototype.format 是普通方法（不抛）	计算键/static 表	没测该层	keep	keep	—
负控制：实例上的 format 是函数（brand check 只在原型对象上定抛）	计算键/static 表	没测该层	keep	keep	—
freeze：自有键的 writable / configurable 折 false（改前仍折 true）	计算键/static 表	没测该层	keep	keep	—
seal：只折 configurable false，writable 保持 true（原生同款）	计算键/static 表	没测该层	keep	keep	—
gOPDs 同步反映冻结后的键级标志（改前仍折 true/true）	计算键/static 表	没测该层	keep	keep	—
isFrozen：空对象密封即冻结（改前折 false）	计算键/static 表	没测该层	keep	keep	—
isSealed：空对象 preventExtensions 即密封（改前折 false）	计算键/static 表	没测该层	keep	keep	—
isFrozen：preventExtensions + 收紧的键标志 ⇒ true（改前折 false）	计算键/static 表	没测该层	keep	keep	—
isFrozen：seal 后仍有可写键 ⇒ false（原生同款，负控制）	计算键/static 表	没测该层	keep	keep	—
isSealed：preventExtensions 后仍有可配置键 ⇒ false（负控制）	计算键/static 表	没测该层	keep	keep	—
gOPDs：访问器属性折 {get, set} 描述符（改前 .get 折 undefined）	计算键/static 表	没测该层	keep	keep	—
fn 接收者：冻结后可写键仍折 false + 新键写抛 TypeError（原生同款）	计算键/static 表	没测该层	keep	keep	—
不可写属性被改值 → TypeError（改前静默改写成功）	计算键/static 表	没测该层	keep	keep	—
不可写属性**同值**重定义 → 允许（原生同款）	计算键/static 表	没测该层	keep	keep	—
不可配置属性改 writable / configurable / enumerable → TypeError	计算键/static 表	没测该层	keep	keep	—
不可配置属性改访问机制（data → accessor）→ TypeError	计算键/static 表	没测该层	keep	keep	—
seal / freeze / preventExtensions 之后建新键 → TypeError（改前静默建键）	计算键/static 表	没测该层	keep	keep	—
冻结对象上**同值**重定义 → 允许（原生同款）	计算键/static 表	没测该层	keep	keep	—
{get: undefined, value: 1} → TypeError（字段存在性语义；改前静默折 1）	计算键/static 表	没测该层	keep	keep	—
已有可配置属性：未指定字段保持原值、显式字段双向覆盖（enumerable 可恢复）	计算键/static 表	没测该层	keep	keep	—
新建属性未指定字段缺省 false（原生描述符面）	计算键/static 表	没测该层	keep	keep	—
Array.from：访问器 length 决定元素数（原生 "a,b"，改前 ""）	计算键/static 表	没测该层	keep	keep	—
Array.from：getter 副作用落地且**只发生一次**（原生 "2:1"，改前 "0:0"）	计算键/static 表	没测该层	keep	keep	—
Array.from：索引访问器的值被取到（原生 "g"，改前 ""）	计算键/static 表	没测该层	keep	keep	—
借用调用 slice.call：访问器 length 生效（原生 "a,b"，改前 ""）	计算键/static 表	没测该层	keep	keep	—
借用调用 map.call：访问器 length 生效（原生 "A,B"，改前 ""）	计算键/static 表	没测该层	keep	keep	—
借用调用 indexOf.call：访问器 length 生效（原生 1，改前 -1）	计算键/static 表	没测该层	keep	keep	—
索引访问器 + 数据 length：两个来源各按其读域（原生 "a,z,"）	计算键/static 表	没测该层	keep	keep	—
data-length 的 array-like 仍按槽读	计算键/static 表	没测该层	keep	keep	—
迭代物（数组 / 字符串 / Set）不受 array-like 臂影响	计算键/static 表	没测该层	keep	keep	—
无 length 槽的闭对象仍折 0 长（原生 0）	计算键/static 表	没测该层	keep	keep	—
访问器 length 返回 undefined ⇒ ToLength 0（原生 0）	计算键/static 表	没测该层	keep	keep	—
访问器 length 返回字符串 "2" ⇒ ToLength 2（原生 2）	计算键/static 表	没测该层	keep	keep	—
L2 门禁：访问器 array-like 是**纯值错**——门禁恒绿，差异在签名	计算键/static 表	没测该层	keep	keep	—
回调 this 是 thisArg（原生 20，改前假抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
回调 this 参与返回值计算（原生 "v1|v2"，改前假抛）	计算键/static 表	没测该层	keep	keep	—
thisArg 为 null ⇒ 回调 this 是 null（原生 "null"，改前 "undefined"）	计算键/static 表	没测该层	keep	keep	—
thisArg 为 undefined ⇒ 回调 this 是 undefined（原生 "undefined"）	计算键/static 表	没测该层	keep	keep	—
Set 迭代物同样透传 thisArg（原生 10，改前假抛）	计算键/static 表	没测该层	keep	keep	—
字符串迭代物同样透传 thisArg（原生 6）	计算键/static 表	没测该层	keep	keep	—
array-like 迭代物同样透传 thisArg（原生 8）	计算键/static 表	没测该层	keep	keep	—
数组 HOF 的 thisArg 仍正确（原生 14）	计算键/static 表	没测该层	keep	keep	—
未给 thisArg ⇒ 回调 this 仍是 undefined（原生 "undefined"）	计算键/static 表	没测该层	keep	keep	—
无 mapper 的 Array.from 不受影响（原生 2,4）	计算键/static 表	没测该层	keep	keep	—
箭头回调不受 thisArg 影响（原生 2）	计算键/static 表	没测该层	keep	keep	—
L2 门禁不再假红：带 thisArg 的 Array.from 不再被判 may-throw	计算键/static 表	没测该层	keep	keep	—
Reflect 面：陷阱派发并返回补全后的描述符（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
Reflect 面：陷阱返回非对象 → TypeError（原生同款）	计算键/static 表	没测该层	keep	keep	—
Reflect 面：无该陷阱 → 落回靶的 [[GetOwnProperty]]（原生同款）	计算键/static 表	没测该层	keep	keep	—
非 Proxy 目标不受影响（负控制）	计算键/static 表	没测该层	keep	keep	—
陷阱派发：value 42（修前读 .value 定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
陷阱派发：描述符被**补全**（value/writable/enumerable/configurable 原生同款）	计算键/static 表	没测该层	keep	keep	—
陷阱对任意键派发：实参 (target, key) 里的 key 透传（原生同款）	计算键/static 表	没测该层	keep	keep	—
非 Proxy 路径不受影响：{a:1} 的自有键 value 1、缺失键 undefined	计算键/static 表	没测该层	keep	keep	—
Reflect 面一致：同一陷阱经 Reflect 面拿到同一个 42	计算键/static 表	没测该层	keep	keep	—
陷阱返回 undefined：不抛，且不假精确（精度缺口 TODO(族05)）	计算键/static 表	没测该层	keep	keep	—
陷阱返回非对象 → TypeError（ToPropertyDescriptor 前置，原生同款）	计算键/static 表	没测该层	keep	keep	—
原型链上的键不是自有属性：gOPD({}, "toString") === undefined	计算键/static 表	没测该层	keep	keep	—
普通对象的描述符三标志不变（writable/enumerable/configurable 全 true）	计算键/static 表	没测该层	keep	keep	—
freeze：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）	计算键/static 表	没测该层	keep	keep	—
seal：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）	计算键/static 表	没测该层	keep	keep	—
freeze：defineProperty 陷阱返回 false ⇒ TypeError（改前不抛）	计算键/static 表	没测该层	keep	keep	—
freeze：preventExtensions + 逐键 defineProperty 陷阱都派发（改前一个都不派发）	计算键/static 表	没测该层	keep	keep	—
seal：同样派发两个陷阱（改前一个都不派发）	计算键/static 表	没测该层	keep	keep	—
负控制：无陷阱的 Proxy 冻结不抛（原生同款）	计算键/static 表	没测该层	keep	keep	—
Proxy defineProperty 陷阱返 false → 返 false（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
Proxy defineProperty 陷阱返 true → 返 true	计算键/static 表	没测该层	keep	keep	—
普通对象：成功 → true 且值落地	计算键/static 表	没测该层	keep	keep	—
普通对象：重定义失败（不可配置属性改值）→ 返 false（不抛）	计算键/static 表	没测该层	keep	keep	—
描述符非法（非对象）→ 仍定抛 TypeError（原生同款）	计算键/static 表	没测该层	keep	keep	—
Object 面保持定抛口径（负控制：Object.defineProperty 仍抛）	计算键/static 表	没测该层	keep	keep	—
getter 值被取到（原生 42，改前 undefined）	计算键/static 表	没测该层	keep	keep	—
getter 副作用真实发生（原生 1，改前 0）	计算键/static 表	没测该层	keep	keep	—
receiver（第 3 实参）作为 getter 的 this（原生 7）	计算键/static 表	没测该层	keep	keep	—
只有 setter 的键读值恒 undefined（原生同款，负控制）	计算键/static 表	没测该层	keep	keep	—
数据属性读值不受影响（负控制）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Function.prototype) === Object.prototype → true（修前恒 false）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Object.prototype) === null → true（链顶恒 null）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf([]) === Array.prototype → true（实例原型面不回归）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Array.prototype) === Object.prototype → true（内建原型上一层）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(userFn) === Function.prototype → true（用户函数的原型面）	计算键/static 表	没测该层	keep	keep	—
typeof Function.prototype → "function"（原生同款；报告称 "object" 是**报告的错误**）	计算键/static 表	没测该层	keep	keep	—
typeof Object.getPrototypeOf(Function.prototype) → "object"（原型对象本身是对象）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Function) === Function.prototype → true（内建构造器自身的原型面）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Object) === Function.prototype → true（内建构造器自身的原型面）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(function(){}) === Function.prototype → true（函数表达式）	计算键/static 表	没测该层	keep	keep	—
Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype → true	计算键/static 表	没测该层	keep	keep	—
Set 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
Map 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
数组迭代器：it[Symbol.iterator]() === it → true（修前：错的 "diff"）	计算键/static 表	没测该层	keep	keep	—
字符串迭代器：it[Symbol.iterator]() === it → true（修前：错的 "diff"）	计算键/static 表	没测该层	keep	keep	—
两个不同集合迭代器互比 → false（原生同款）	计算键/static 表	没测该层	keep	keep	—
迭代器本身与源集合互比 → 不是精确 true（原生 false；引擎给保守 boolean 域）	计算键/static 表	没测该层	keep	keep	—
Error.prototype 自有 name / message（hasOwnProperty true）	计算键/static 表	没测该层	keep	keep	—
取值不变（name = 家族名、message = ""）	计算键/static 表	没测该层	keep	keep	—
"name" / "message" in Error.prototype → true	计算键/static 表	没测该层	keep	keep	—
自有但不可枚举（propertyIsEnumerable false、for-in 不发布）	计算键/static 表	没测该层	keep	keep	—
Error 家族八个原型同款（各自 name = 家族名、message = ""）	计算键/static 表	没测该层	keep	keep	—
对照组：其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）	计算键/static 表	没测该层	keep	keep	—
constructor 自有槽不受影响（仍是原型自有、非枚举）	计算键/static 表	没测该层	keep	keep	—
显式 undefined 第二实参 ⇒ 返回对象、不抛（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
负控制：1 参形态同样返回对象（与显式 undefined 同口径）	计算键/static 表	没测该层	keep	keep	—
负控制：null 第二实参 ⇒ TypeError（ToObject(null)，原生同款）	计算键/static 表	没测该层	keep	keep	—
负控制：数字第二实参 ⇒ 零自有属性的包装器、不抛（原生同款）	计算键/static 表	没测该层	keep	keep	—
负控制：第二实参带描述符 ⇒ 仍安装自有属性	计算键/static 表	没测该层	keep	keep	—
数字第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
布尔第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
空串第二实参 ⇒ 零键 ⇒ 不抛（改前定抛 TypeError）	计算键/static 表	没测该层	keep	keep	—
负控制：null / undefined 第二实参 ⇒ TypeError（原生同款）	计算键/static 表	没测该层	keep	keep	—
负控制：非空字符串第二实参 ⇒ TypeError（描述符是字符，非对象）	计算键/static 表	没测该层	keep	keep	—
负控制：对象第二实参仍照常安装描述符	计算键/static 表	没测该层	keep	keep	—
getProto(getProto(Uint8Array.prototype)) === Object.prototype → true（链条错一级已修）	计算键/static 表	没测该层	keep	keep	—
getProto(Array.prototype) === Object.prototype → true（对照组：一层链的原生同款）	计算键/static 表	没测该层	keep	keep	—
getProto(Uint8Array.prototype) === Object.prototype → **不是精确 true**（原生 false）	计算键/static 表	没测该层	keep	keep	—
getProto(Object.prototype) === null → true（链顶恒 null）	计算键/static 表	没测该层	keep	keep	—
getProto(getProto(Array.prototype)) === null → true（Array.prototype 上一层即顶）	计算键/static 表	没测该层	keep	keep	—
typeof Array.prototype === "object"（内建原型对象的 typeof 面不回归）	计算键/static 表	没测该层	keep	keep	—
join.call(null) / join.call(undefined) ⇒ TypeError（改前不记抛）	计算键/static 表	没测该层	keep	keep	—
toString.call(null) / toString.call(undefined) ⇒ TypeError	计算键/static 表	没测该层	keep	keep	—
toLocaleString.call(null) / toLocaleString.call(undefined) ⇒ TypeError	计算键/static 表	没测该层	keep	keep	—
摘下方法值后以 null 调用 ⇒ TypeError（原生同）	计算键/static 表	没测该层	keep	keep	—
数组接收者仍折出值（原生 "1,2"）	计算键/static 表	没测该层	keep	keep	—
array-like / 字符串 / 数字 / 对象接收者不抛	计算键/static 表	没测该层	keep	keep	—
实例方法调用不受影响（原生 "1,2"）	计算键/static 表	没测该层	keep	keep	—
ToString 通道不受影响（原生 "1,2"）	计算键/static 表	没测该层	keep	keep	—
同对象上其它方法的既有报红不变（原生 TypeError）	计算键/static 表	没测该层	keep	keep	—
L2 门禁不再假绿：nullish 接收者的导出函数被判 may-throw	计算键/static 表	没测该层	keep	keep	—
L2 门禁负控制：非 nullish 接收者仍是 total（0 诊断）	计算键/static 表	没测该层	keep	keep	—
const 函数成员写：值可读、不抛、不重绑；let/非函数/函数声明负控	const 成员写族表	没测该层	keep	keep	—
body-fn 临时名避让：用户撞名仍求值；不撞名负控；避让集来自 AST	const 成员写族表	没测该层	keep	keep	—
super.m() 删除后抛 TypeError、可 catch；未删/toString/动态原型负控	const 成员写族表	没测该层	keep	keep	—
复合赋值到不可重绑成员：直接/计算键折 3；可重绑与只求值一次负控	const 成员写族表	没测该层	keep	keep	—
含内建父的派生 Map/Set 读回条目；缺席/同名/普通 Map 负控	const 成员写族表	没测该层	keep	keep	—
成员在签名面可按名查到，返回类型是实值（string）	计算键/static 表	没测该层	keep	keep	—
不再产生指向错误的 nudo:opaque-result	计算键/static 表	没测该层	keep	keep	—
负控制：普通 CJS 具名导出行为不变（exports.f = fn）	计算键/static 表	没测该层	keep	keep	—
负控制：成员桥不得劫持无关的本地函数	计算键/static 表	没测该层	keep	keep	—
原生 oracle：CJS 成员挂在 exports 对象上（node 另起进程对拍）	计算键/static 表	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
键表达式在类定义期求值 1 次（此前 0 次）	dup:计算键/static 表	commit:f4aa4bc4
多次构造不再重复求值键（此前每构造 1 次）	dup:计算键/static 表	commit:f4aa4bc4
键不再随实例漂移（两次构造同键）	dup:计算键/static 表	commit:f4aa4bc4
键表达式的抛错在定义期表面（构造期不再抛）	dup:计算键/static 表	commit:f4aa4bc4
同名类在两处定义：每次定义各求值 1 次	dup:计算键/static 表	commit:f4aa4bc4
负控制：静态字段/方法的计算键仍各求值 1 次	dup:计算键/static 表	commit:f4aa4bc4
负控制：公有实例字段的键与值不变	dup:计算键/static 表	commit:f4aa4bc4
负控制：抽象计算键不假精确挂名（不抛）	dup:计算键/static 表	commit:f4aa4bc4
static 块在前的静态字段读到块内写入（原生 2）	dup:计算键/static 表	commit:f4aa4bc4
字段-块-字段三段交错（原生 3）	dup:计算键/static 表	commit:f4aa4bc4
副作用轨迹按源码序（原生 1b2）	dup:计算键/static 表	commit:f4aa4bc4
负控制：字段在前的 static 块读前序字段（原生 2）	dup:计算键/static 表	commit:f4aa4bc4
负控制：static 块写外层变量仍在定义期落地	dup:计算键/static 表	commit:f4aa4bc4
负控制：static 块内 this 是类值（写入落槽）	dup:计算键/static 表	commit:f4aa4bc4
brand 接收者 · 闭合 obj · 表外成员（then）⇒ 记 may-throw（never throws TypeError）	dup:brand/fn-sum 表	commit:7a646432
brand 接收者 · 闭合 obj · 表内成员（json / text）⇒ 不记抛	dup:brand/fn-sum 表	commit:7a646432
负控：宿主确实存在的成员（status / ok —— 数据成员）⇒ 不误报成「确定抛」	dup:brand/fn-sum 表	commit:7a646432
soundness 护栏：内层 **unknown** 的 brand ⇒ 不记抛（域不封闭 ⇒ 缺席不可证）	dup:brand/fn-sum 表	commit:7a646432
soundness 护栏：内层 **open** obj 的 brand ⇒ 不记抛	dup:brand/fn-sum 表	commit:7a646432
平 obj 接收者的既有行为逐字不变（表外成员仍定抛 / 表内成员不抛）	dup:brand/fn-sum 表	commit:7a646432
负控：引擎已为原型面建模的内建 brand ⇒ 不判（表外名不可证缺席）	dup:brand/fn-sum 表	commit:7a646432
L2 门禁面：brand 表外成员的调用 ⇒ 记 nudo:entry-may-throw（假绿收口）	dup:brand/fn-sum 表	commit:7a646432
L2 门禁面：brand 表内成员的调用 ⇒ 不记 entry-may-throw	dup:brand/fn-sum 表	commit:7a646432
同步守卫：内建 brand 原型表键集 ⊆ 排除名单（含 .prototype / Intl. 模式）	dup:brand/fn-sum 表	commit:7a646432
负控：原型对象 brand / Intl.* 子构造器 ⇒ 不判（模式排除生效）	dup:brand/fn-sum 表	commit:7a646432
fn⊕fn：两臂都有的静态成员 ⇒ 值域是两臂返回域之并（不是 unknown）	dup:brand/fn-sum 表	commit:7a646432
fn⊕fn：只有一臂有的静态成员 ⇒ 该臂派发 + 另一臂按原生记 may-throw	dup:brand/fn-sum 表	commit:7a646432
fn⊕fn：反向（只有 B 有）⇒ 同样只派发有的一臂	dup:brand/fn-sum 表	commit:7a646432
负控：fn 静态面模型为**空**（确实没有该静态成员）⇒ 仍判「确定没有」	dup:brand/fn-sum 表	commit:7a646432
负控：fn **没有**静态面模型（判据不足）⇒ 保守放行（不记 may-throw）	dup:brand/fn-sum 表	commit:7a646432
负控：Function.prototype 名（toString）沿函数对象恒可得 ⇒ 不判缺席	dup:brand/fn-sum 表	commit:7a646432
负控：prim / brand / obj / arr / tuple / eff 的既有 sum 派发行为逐字不变	dup:brand/fn-sum 表	commit:7a646432
端到端：env 全局是 fn⊕fn sum ⇒ Response.json(x) 的签名不是 unknown	dup:brand/fn-sum 表	commit:7a646432
{ get x(){}, x: 2 } → 读得数据属性 2	dup:重复键表	commit:3e52f562
{ get x(){}, x: 2 } 后的写不再定抛（数据属性写语义）	dup:重复键表	commit:3e52f562
{ get x(){}, x: 2 } 的自有描述符是数据属性（value = 2）	dup:重复键表	commit:3e52f562
{ x: 1, get x(){}, x: 3 } → 最后一个定义（数据属性 3）胜出	dup:重复键表	commit:3e52f562
{ get x(){}, x: 2 } 展开后仍是数据属性 2	dup:重复键表	commit:3e52f562
{ get x(){}, x: 2 } 经 Object.assign 拷贝后仍是数据属性 2	dup:重复键表	commit:3e52f562
被覆盖的 getter 不再被调用（副作用归零）	dup:重复键表	commit:3e52f562
重复键的数据属性仍可枚举（键存在性不丢）	dup:重复键表	commit:3e52f562
方法简写是数据属性：{ get x(){}, x(){} } → 方法胜出	dup:重复键表	commit:3e52f562
symbol 键同键仲裁：{ get [Symbol.iterator](), [Symbol.iterator]: 2 } → 数据属性胜出	dup:重复键表	commit:3e52f562
动态计算键同键仲裁：{ get [k](), [k]: 2 } → 数据属性胜出（定义语义）	dup:重复键表	commit:3e52f562
动态计算键同键仲裁后写语义不塌成定抛（数据属性写）	dup:重复键表	commit:3e52f562
动态计算键：键表达式仍只求值一次	dup:重复键表	commit:3e52f562
函数 / 类实例 instanceof 自身 → true	dup:instanceof 表	commit:a28dada3
派生类实例 instanceof 父类 → true	dup:instanceof 表	commit:a28dada3
原型被替换后旧实例 instanceof 构造器 → false	dup:instanceof 表	commit:a28dada3
原型被替换后新造的实例 instanceof 构造器 → true	dup:instanceof 表	commit:a28dada3
实例原型置 null 后 instanceof 构造器 / Object → false（链 null 终止）	dup:instanceof 表	commit:a28dada3
普通函数 / 类的实例 instanceof Function → false（原生 false，非 true）	dup:instanceof 表	commit:a28dada3
以 Function 为基类的类实例 instanceof Function → true	dup:instanceof 表	commit:a28dada3
函数值本身 instanceof Function / Object → true（本片修：此前直读 left.shape 崩 ⇒ unknown）	dup:instanceof 表	commit:a28dada3
函数值 instanceof 内建构造器（Array） → false	dup:instanceof 表	commit:a28dada3
对象字面量 instanceof 用户函数 / 用户类 → false（此前折抽象 boolean）	dup:instanceof 表	commit:a28dada3
F.prototype = Object.prototype 之后对象字面量 instanceof F → true（原型身份命中）	dup:instanceof 表	commit:a28dada3
对象字面量 instanceof Object → true；instanceof Array → false（既有口径不变）	dup:instanceof 表	commit:a28dada3
箭头函数 RHS（原生定抛 TypeError）不得折 exact false	dup:instanceof 表	commit:a28dada3
生成器函数 RHS（原生 false）不得折 exact true	dup:instanceof 表	commit:a28dada3
bind 产物 RHS（原生 false）不得折 exact false / true	dup:instanceof 表	commit:a28dada3
生成器对象替身（内部槽 obj）不得折 exact（既有钉 exec-review-fixes 复钉）	dup:instanceof 表	commit:a28dada3
setPrototypeOf(f, {}) 之后 instanceof F → 抽象 boolean（不得 exact true）	dup:instanceof 表	commit:a28dada3
F.prototype={} 之后新实例 instanceof Object → 抽象 boolean（原生 true）	dup:instanceof 表	commit:a28dada3
F.prototype = 5 之后 f instanceof F → TypeError	dup:instanceof 表	commit:a28dada3
原型上 writable:false → Reflect.set 返 false（此前返 true）	dup:写门表	commit:90b33e51
原型上 getter-only → Reflect.set 返 false（此前返 true）	dup:写门表	commit:90b33e51
派生类实例同样过门（原型链经类注册表上溯）	dup:写门表	commit:90b33e51
负控制：原型上 writable:true → Reflect.set 返 true	dup:写门表	commit:90b33e51
负控制：原型上没有该键 → Reflect.set 返 true（建自有属性）	dup:写门表	commit:90b33e51
负控制：实例自有可写字段 → Reflect.set 返 true 且值生效	dup:写门表	commit:90b33e51
原型上 writable:false → a.x = 2 抛 TypeError（此前静默写穿）	dup:写门表	commit:90b33e51
原型上 getter-only → a.y = 2 抛 TypeError（此前静默写穿）	dup:写门表	commit:90b33e51
负控制：原型上 writable:true → a.x = 2 不抛	dup:写门表	commit:90b33e51
负控制：实例字段赋值不抛	dup:写门表	commit:90b33e51
原型链 getter-only → Reflect.set 返 false（此前抛 TypeError）	dup:写门表	commit:90b33e51
原型链 writable:false 数据属性 → Reflect.set 返 false	dup:写门表	commit:90b33e51
原型链带 setter → Reflect.set 返 true 且 setter 被派发	dup:写门表	commit:90b33e51
负控制：自有可写属性 → true 且值生效	dup:写门表	commit:90b33e51
负控制：自有不可写（frozen）→ false	dup:写门表	commit:90b33e51
负控制：新键 → true（建自有属性）	dup:写门表	commit:90b33e51
负控制：strict 赋值仍抛 TypeError（core 侧写门不变）	dup:写门表	commit:90b33e51
X.prototype.hasOwnProperty(k) → true（此前折 false：装到无人持有的新 brand）	dup:写门表	commit:90b33e51
X.prototype.k → 1（原型面读得到）	dup:写门表	commit:90b33e51
实例读继承该原型数据属性 → 1（原型链可见）	dup:写门表	commit:90b33e51
实例面 Reflect.set(new A(), 'x', 2) → false（proto-set.ts 经 protoOfRecv 解析类实例原型链）	dup:写门表	commit:90b33e51
实例面 strict 赋值 a.x = 2 → TypeError（同一写门，strict 语义）	dup:写门表	commit:90b33e51
原型链 getter-only（Object.create）→ strict TypeError	dup:写门表	commit:90b33e51
原型链 writable:false 数据属性 → strict TypeError	dup:写门表	commit:90b33e51
原型链 frozen → strict TypeError	dup:写门表	commit:90b33e51
两级原型链 getter → strict TypeError	dup:写门表	commit:90b33e51
原型链带 setter 的访问器 → 派发 setter（不是静默建自有属性）	dup:写门表	commit:90b33e51
fn 上 defineProperty writable:false → strict TypeError	dup:写门表	commit:90b33e51
数组下标 defineProperty writable:false → strict TypeError	dup:写门表	commit:90b33e51
负控制：自有可写属性写 → 成功（值生效）	dup:写门表	commit:90b33e51
负控制：原型链普通可写属性 → receiver 建自有属性（值生效）	dup:写门表	commit:90b33e51
负控制：类字面量访问器（继承面）→ TypeError（既有正确）	dup:写门表	commit:90b33e51
负控制：Object.assign 到继承 non-writable → TypeError（既有正确）	dup:写门表	commit:90b33e51
负控制：函数 expando 写（未 defineProperty）→ 仍成功	dup:写门表	commit:90b33e51
delete a.length → TypeError（表达式位：不可配置自有属性）	dup:delete 写门表	commit:476ed1e0
delete a.length → TypeError（语句位写回通道 $del）	dup:delete 写门表	commit:476ed1e0
delete a["length"]（计算键）→ TypeError	dup:delete 写门表	commit:476ed1e0
负控制：preventExtensions 数组 delete a.length → 仍 TypeError（length 恒不可配置）	dup:delete 写门表	commit:476ed1e0
负控制：delete a[0]（元素可配置）→ true	dup:delete 写门表	commit:476ed1e0
负控制：delete 普通对象自有属性 → true	dup:delete 写门表	commit:476ed1e0
负控制：delete 不存在的属性 → true	dup:delete 写门表	commit:476ed1e0
负控制：delete 普通对象的 length 属性（可配置）→ true（数组专属规则）	dup:delete 写门表	commit:476ed1e0
负控制：frozen 对象删自有属性 → TypeError（既有正确）	dup:delete 写门表	commit:476ed1e0
Reflect.deleteProperty(靶含不可配置键, 陷阱返 true) → TypeError	dup:delete 写门表	commit:476ed1e0
负控制：靶上该键可配置 → 返 true（不抛）	dup:delete 写门表	commit:476ed1e0
负控制：靶上无该键 → 返 true（不抛）	dup:delete 写门表	commit:476ed1e0
负控制：陷阱返 false → 返 false（不抛；原生不变量不适用）	dup:delete 写门表	commit:476ed1e0
delete p.x（运算符路径）→ TypeError（exec/runtime/members.ts 的 $delRes 陷阱臂过 enforceProxyDeleteInvariant）	dup:delete 写门表	commit:476ed1e0
负控制（运算符路径）：靶上该键可配置 → 返 true（不抛）	dup:delete 写门表	commit:476ed1e0
负控制（运算符路径）：靶上无该键 → 返 true（不抛）	dup:delete 写门表	commit:476ed1e0
负控制（运算符路径）：陷阱返 false → strict 定抛 TypeError（原生同）	dup:delete 写门表	commit:476ed1e0
delete 字符串字面量的 length → TypeError（此前折 unknown）	dup:delete 写门表	commit:476ed1e0
负控制：delete 数组的 length → TypeError（既有正确）	dup:delete 写门表	commit:476ed1e0
负控制：delete 字符串的其它键 → 不抛（length 之外的键不受管）	dup:delete 写门表	commit:476ed1e0
钩子把方法条目从注册表摘掉（findMethod 沿链不再命中）	dup:原型删除钩子表	commit:8cb582bc
钩子不误伤静态方法（原生：delete A.prototype.m 不动 A.m）	dup:原型删除钩子表	commit:8cb582bc
钩子对不存在的方法返回 false（幂等）	dup:原型删除钩子表	commit:8cb582bc
负控制：删除钩子不动别的类	dup:原型删除钩子表	commit:8cb582bc
端到端：delete A.prototype.m 后 A.prototype.m / B.prototype.m → undefined、"m" in B.prototype → false	dup:原型删除钩子表	commit:8cb582bc
负控制：delete A.prototype.m 不动别的类的方法	dup:原型删除钩子表	commit:8cb582bc
负控制：delete A.prototype.<不存在的键> → 原有方法仍在	dup:原型删除钩子表	commit:8cb582bc
repro：delete A.prototype.m 后 a.m() → throws TypeError（原生同抛）	dup:原型删除钩子表	commit:8cb582bc
自有类实例同折：delete A.prototype.m 后 new A().m() → TypeError	dup:原型删除钩子表	commit:8cb582bc
方法从未定义同折：a.neverDefined() → TypeError（原生同抛）	dup:原型删除钩子表	commit:8cb582bc
方法在但值不是函数：ctor `this.m = undefined` → a.m() → TypeError（原生同抛）	dup:原型删除钩子表	commit:8cb582bc
user try/catch 可吸收（原生同：抛错被 catch 捕获）	dup:原型删除钩子表	commit:8cb582bc
负控制：**读面**不抛——a.m 读回 undefined（调用面才抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：方法仍在 → 调用不变（a.m() → 1，不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：删除不误伤别的类（new C().m() → 2，不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：Object.prototype 名恒可得（a.toString() 不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：静态面不受影响（A.s() → 2，不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：内建 brand 实例不受影响（new Date().getTime() 不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：ctor 自有 fn 槽调用不变（this.m = fn → 42，不抛）	dup:原型删除钩子表	commit:8cb582bc
负控制：内建父类链保守不判（class MyMap extends Map {} → 链有内建父，原型面不完备）	dup:原型删除钩子表	commit:8cb582bc
Object.assign(A.prototype, {b:1}) → for-in 看得到 b（此前静默丢弃）	dup:brand 原型写表	commit:d842d398
Object.defineProperty(A.prototype,'c',{value:2,enumerable:true}) → for-in 看得到 c	dup:brand 原型写表	commit:d842d398
assign 写的键：实例读得到（原型链继承）	dup:brand 原型写表	commit:d842d398
assign 写的键：原型面 hasOwnProperty → true	dup:brand 原型写表	commit:d842d398
assign 写的键：原型面直接读得到	dup:brand 原型写表	commit:d842d398
非 obj 源（数组字面量）→ 下标键写进原型	dup:brand 原型写表	commit:d842d398
负控制：类方法非可枚举 → for-in 仍只看到 assign 的键	dup:brand 原型写表	commit:d842d398
负控制：普通对象的 assign / for-in 不变	dup:brand 原型写表	commit:d842d398
class 实例：原型上的可枚举属性被枚举	dup:brand 原型写表	commit:d842d398
class 实例：for..in 的枚举个数包含原型键	dup:brand 原型写表	commit:d842d398
function 原型：原型上的可枚举属性被枚举	dup:brand 原型写表	commit:d842d398
派生类：整条原型链的可枚举键都被枚举	dup:brand 原型写表	commit:d842d398
派生类：原型上的方法（class 方法非可枚举）不出现	dup:brand 原型写表	commit:d842d398
原型键被覆写后仍只枚举一次	dup:brand 原型写表	commit:d842d398
负控制：class 方法非可枚举 ⇒ 不出现在 for..in	dup:brand 原型写表	commit:d842d398
负控制：普通对象的 for..in 不变	dup:brand 原型写表	commit:d842d398
负控制：Object.keys 仍只给自有可枚举键（原型键不混入）	dup:brand 原型写表	commit:d842d398
负控制：原型上的属性读取仍正常	dup:brand 原型写表	commit:d842d398
对象字面量访问器：getter 在实参之前跑（原生 mbc / 改前 bmc）	dup:访问器求值序表	commit:87577dcc
对象字面量访问器 + 两个实参：getter → 实参 → 调用（原生 mabc）	dup:访问器求值序表	commit:87577dcc
类访问器：getter 先于实参（原生 gmbc / 改前 bgmc）	dup:访问器求值序表	commit:87577dcc
静态类访问器：getter 先于实参（原生 smbc / 改前 bsmc）	dup:访问器求值序表	commit:87577dcc
嵌套访问器：外层 getter → 内层 getter → 实参（原生 pmbc）	dup:访问器求值序表	commit:87577dcc
计算键调用：键 → 成员读 → 实参（原生 kmbc / 改前 kbmc）	dup:访问器求值序表	commit:87577dcc
getter 抛：实参**不**求值（原生 mT / 改前 bmT）	dup:访问器求值序表	commit:87577dcc
getter 返回非函数：getter → 实参 → TypeError（原生 mbT / 改前 bmT）	dup:访问器求值序表	commit:87577dcc
getter 只跑一次（不得因预读 + 派发各读一次而跑两遍）	dup:访问器求值序表	commit:87577dcc
数据槽方法：成员读无副作用，调用仍在实参之后（原生 bm）	dup:访问器求值序表	commit:87577dcc
普通函数调用：实参从左到右（原生 abf）	dup:访问器求值序表	commit:87577dcc
计算键 + 数据槽方法：键先求值（原生 kbm）	dup:访问器求值序表	commit:87577dcc
super 调用：父类方法仍被派发（this 绑实例）	dup:访问器求值序表	commit:87577dcc
私有名方法调用：this.#m() 仍走类注册表派发	dup:访问器求值序表	commit:87577dcc
数组方法：map 回调仍逐元素跑	dup:访问器求值序表	commit:87577dcc
this 绑定：对象方法体内的 this 仍是接收者	dup:访问器求值序表	commit:87577dcc
字符串键静态方法 → 1 instanceof A 折 false（不当钩子）	dup:hasInstance 表	commit:bfdca40d
字符串键静态字段 → 1 instanceof A 折 false（不当钩子）	dup:hasInstance 表	commit:bfdca40d
字符串键静态 getter → 1 instanceof A 折 false（不当钩子）	dup:hasInstance 表	commit:bfdca40d
字符串键静态方法仍是可读可调的普通静态成员	dup:hasInstance 表	commit:bfdca40d
字符串键形态不破坏普通 instanceof 链（new A() instanceof A 仍为 true）	dup:hasInstance 表	commit:bfdca40d
类表达式形态同样成立（const K = class {…}）	dup:hasInstance 表	commit:bfdca40d
字符串键静态方法的实参与 arguments 口径不变	dup:hasInstance 表	commit:bfdca40d
符号键静态方法仍是钩子（左操作数进钩子）	dup:hasInstance 表	commit:bfdca40d
符号键静态字段仍是钩子	dup:hasInstance 表	commit:bfdca40d
符号键静态成员的可读面（Symbol 键）仍是一等函数	dup:hasInstance 表	commit:bfdca40d
符号键静态成员的类值槽带 symbolKey 标记（读面据此区分符号键槽）	dup:hasInstance 表	commit:bfdca40d
字符串键静态成员的类值槽不带 symbolKey 标记（不是符号键槽）	dup:hasInstance 表	commit:bfdca40d
obj 的字符串键钩子 → TypeError（RHS 非 callable）	dup:hasInstance 表	commit:bfdca40d
obj 的字符串键钩子（返回 true 也一样）→ TypeError	dup:hasInstance 表	commit:bfdca40d
obj 的字符串键槽值不可调用 → TypeError	dup:hasInstance 表	commit:bfdca40d
类值的字符串键钩子 → false（不当钩子、不抛）	dup:hasInstance 表	commit:bfdca40d
类值的字符串键槽值不可调用 → 不抛（原生走 OrdinaryHasInstance → false）	dup:hasInstance 表	commit:bfdca40d
obj 的符号键钩子 → 调 fn 并 ToBoolean	dup:hasInstance 表	commit:bfdca40d
类体 static [Symbol.hasInstance] → 钩子生效	dup:hasInstance 表	commit:bfdca40d
类体 static [Symbol.hasInstance] 的继承（D extends C）→ 钩子生效	dup:hasInstance 表	commit:bfdca40d
类体 static [Symbol.hasInstance] = fn（静态字段形态）→ 钩子生效	dup:hasInstance 表	commit:bfdca40d
普通对象 RHS（无钩子）→ TypeError（原生 RHS 非 callable）	dup:hasInstance 表	commit:bfdca40d
读外类私有 → TypeError（此前返回外类的值）	dup:私有名/模板表	commit:92dabeaf
调外类私有方法 → TypeError	dup:私有名/模板表	commit:92dabeaf
写外类私有 → TypeError	dup:私有名/模板表	commit:92dabeaf
派生类同名私有不覆盖基类私有（基类 1 / 派生 2）	dup:私有名/模板表	commit:92dabeaf
#x in o 只看本类私有 brand（外类实例 → false）	dup:私有名/模板表	commit:92dabeaf
静态私有跨类读 → TypeError	dup:私有名/模板表	commit:92dabeaf
负控制：同类私有读写正常	dup:私有名/模板表	commit:92dabeaf
负控制：自有私有槽对属性 introspection 不可见（仍是内部槽）	dup:私有名/模板表	commit:92dabeaf
负控制：公有字符串键 '#x' 不受私有名作用域化影响	dup:私有名/模板表	commit:92dabeaf
Object.isFrozen(s) → true（原生冻结）	dup:私有名/模板表	commit:92dabeaf
Object.isFrozen(s.raw) → true（raw 数组同样冻结）	dup:私有名/模板表	commit:92dabeaf
Object.keys(s) 只有下标（length/raw/@@iterator 非枚举）	dup:私有名/模板表	commit:92dabeaf
JSON.stringify(s) 走数组序列化面	dup:私有名/模板表	commit:92dabeaf
s.propertyIsEnumerable("length") → false	dup:私有名/模板表	commit:92dabeaf
Object.getOwnPropertyDescriptor(s, "length").enumerable → false	dup:私有名/模板表	commit:92dabeaf
for..in 遍历模板对象只枚举下标	dup:私有名/模板表	commit:92dabeaf
负控制：元素面不变（下标 / length / raw / 展开）	dup:私有名/模板表	commit:92dabeaf
数组原型方法在模板对象上可派发（原生模板对象是数组 exotic）	dup:私有名/模板表	commit:92dabeaf
负控制：普通对象不是数组视图（数组方法面不外溢）	dup:私有名/模板表	commit:92dabeaf
负控制：普通对象仍不是冻结的（extState 标注不外溢）	dup:私有名/模板表	commit:92dabeaf
Array.isArray(s) → true（模板对象是数组 exotic）	dup:私有名/模板表	commit:92dabeaf
Array.isArray(s) → true（多段模板同样成立）	dup:私有名/模板表	commit:92dabeaf
负控制：普通对象 / 非数组值 → false	dup:私有名/模板表	commit:92dabeaf
负控制：迭代器对象仍不是数组	dup:私有名/模板表	commit:92dabeaf
原生不报错：新 prototype 读得出（node v26.10.0：typeof F.prototype.x === 'number'）	dup:const 成员写族表	commit:bc9988af
转译侧不得重绑 const 根（原生：成员写不动绑定）	dup:const 成员写族表	commit:bc9988af
负控：let 绑定维持既有根重绑通道（B1：现经 $rebindable 守卫）	dup:const 成员写族表	commit:bc9988af
负控：非函数表达式的 const 绑定维持既有根重绑通道（收窄口径）	dup:const 成员写族表	commit:bc9988af
负控：函数声明（宿主函数）维持既有根重绑通道	dup:const 成员写族表	commit:bc9988af
用户标识符撞引擎临时名：求值不得 fail-closed（node：12）	dup:const 成员写族表	commit:bc9988af
catch 临时名撞名同样不丢（node：12）	dup:const 成员写族表	commit:bc9988af
负控：不撞名的 body 求值逐字不变（node：12）	dup:const 成员写族表	commit:bc9988af
避让集来自 AST 词形（body 内 Identifier + 形参）	dup:const 成员写族表	commit:bc9988af
删方法后 super 调用定抛 TypeError（原生：TypeError）	dup:const 成员写族表	commit:bc9988af
用户的 try/catch 吸收该 TypeError（原生：'TypeError'）	dup:const 成员写族表	commit:bc9988af
负控：方法未删时 super 调用照常（原生：1）	dup:const 成员写族表	commit:bc9988af
负控：Object.prototype 成员不判缺席（super.toString 原生存在）	dup:const 成员写族表	commit:bc9988af
负控：动态原型写（注册表外）不判缺席（原生有该方法 ⇒ 不抛）	dup:const 成员写族表	commit:bc9988af
mk().x += 2 折 3（原生 3）	dup:const 成员写族表	commit:bc9988af
计算键同款：mk()[k] += 2 折 3（原生 3）	dup:const 成员写族表	commit:bc9988af
负控：可重绑根的复合赋值逐字不变（原生 3）	dup:const 成员写族表	commit:bc9988af
负控：接收者只求值一次（原生 [3, 1]）	dup:const 成员写族表	commit:bc9988af
派生 Map 实例读得回条目（原生：1 / true / 1）	dup:const 成员写族表	commit:bc9988af
派生 Set 实例读得回元素面（原生：2 / true）	dup:const 成员写族表	commit:bc9988af
负控：缺席键仍折 undefined（原生：undefined）	dup:const 成员写族表	commit:bc9988af
负控：用户同名方法优先（原生：'own'）	dup:const 成员写族表	commit:bc9988af
负控：普通 Map 逐字不变（原生：1）	dup:const 成员写族表	commit:bc9988af
单访问器：{ get x(){ return 7 } } → 7	dup:重复键仲裁表	commit:7134e5af
数据在前、访问器在后 → 访问器胜出（读走 getter）	dup:重复键仲裁表	commit:7134e5af
数据在前、访问器在后 → 写仍是 getter-only 的 TypeError	dup:重复键仲裁表	commit:7134e5af
访问器对：{ get x(){}, set x(v){} } → 读得 getter 值 1	dup:重复键仲裁表	commit:7134e5af
setter 仍被调用（写回 receiver 字段）	dup:重复键仲裁表	commit:7134e5af
访问器-访问器：{ get x(){1}, get x(){2} } → 后者 2	dup:重复键仲裁表	commit:7134e5af
数据-数据：{ x: 1, x: 2 } → 2	dup:重复键仲裁表	commit:7134e5af
访问器-数据-访问器：最终是访问器 → 读最后一个 getter	dup:重复键仲裁表	commit:7134e5af
symbol 键：{ [Symbol.iterator]: 2, get [Symbol.iterator](){} } → 访问器胜出	dup:重复键仲裁表	commit:7134e5af
动态计算键：{ [k]: 2, get [k](){} } → 访问器胜出（后写）	dup:重复键仲裁表	commit:7134e5af
动态计算键：不同键互不牵连（getter 键 + 数据键）	dup:重复键仲裁表	commit:7134e5af
方法简写在后：{ x(){}, get x(){} } → 访问器胜出（读 undefined）	dup:重复键仲裁表	commit:7134e5af
其它键不受重复键仲裁牵连	dup:重复键仲裁表	commit:7134e5af
无重复键的字面量不受影响（普通数据属性）	dup:重复键仲裁表	commit:7134e5af
```
