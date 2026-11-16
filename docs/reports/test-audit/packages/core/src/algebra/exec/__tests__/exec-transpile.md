# packages/core/src/algebra/exec/__tests__/exec-transpile.test.ts

模块套件：exec/transpile 运行时面（类/代理/迭代/构造/作用域）。

审计：145 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
同名 static + 实例方法并存 ⇒ A.m() 跑静态体（native "S"）；类值上无该静态成员 ⇒ 定抛 TypeError（native: A.m is not a function）；control：实例接收者仍跑实例体（native "I"）；control：只有静态方法 ⇒ A.m() 跑静态体（native "S"）；control：静态方法沿构造器继承链（B extends A ⇒ B.m() → "S"）；差分对账（native oracle）：改前	exec-transpile 聚合矩阵	没测该层	keep	keep	—
const g = A.m（静态侧）⇒ g() 跑静态体（native "S"）；const g = new A().m（实例侧）⇒ g() 跑实例体（native "I"）；借用调用：g.call(A) ⇒ 跑静态体（native "S"）；control：只有静态方法 ⇒ 摘下调用跑静态体（native "S"）；control：只有实例方法 ⇒ 摘下调用跑实例体（native "I"）；差分对账（native oracle）：改前 FALSE-THROW / 改后一致	exec-transpile 聚合矩阵	没测该层	keep	keep	—
charAt(0, 1n) → "a"（此前判「必抛 TypeError」）；charCodeAt(0, 1n) → 97；codePointAt(0, 1n) → 97；at(0, 1n) → "a"；对照组：真有两实参的方法仍校验第二实参（slice / substring / substr）；对照组：单参调用仍正常折叠	exec-transpile 聚合矩阵	没测该层	keep	keep	—
A 模块实例的构造体与自有字段不被 B 模块的同名类顶掉；B 模块实例保持自己的字段（对照：不是把两边都改坏）；A 模块实例上不存在的成员判 undefined（不读到 B 的槽）；B 模块实例上不存在的成员判 undefined（不读到 A 的槽）；实例方法链首环用值自己的规格：mkA().kind() 恒为 A 的方法体	exec-transpile 聚合矩阵	没测该层	keep	keep	—
a) 无界迭代器：break 臂可达 ⇒ IteratorClose 的 return() 计入出口（宿主同结论）；b) 有界迭代器（报 done）仍逐元素精确展开：break 关闭 ⇒ CLOSED，自然耗尽 ⇒ 不关闭 ⇒ NOT；b2) 有界迭代仍精确：0+1+2 折 3 #exact（不得因代表元抽象而宽化）；c) 循环变量 = 元素域抽象（不折首元素 0）——修前 `return x` 折 0 #exact；c2) 代表元抽象后分支两侧都探索——修前 out 折 "	exec-transpile 聚合矩阵	没测该层	keep	keep	—
A.prototype.m = fn ⇒ new A().m() 跑用户函数（native 2）；a.m = fn ⇒ a.m() 跑用户函数（native 5）；ctor 内 this.m = fn ⇒ new A().m() 跑用户函数（native 3）；A.prototype.m = 5 ⇒ 调用定抛 TypeError（native: not a function）；Object.defineProperty(A.prototype,'m',{value:fn})	exec-transpile 聚合矩阵	没测该层	keep	keep	—
派生构造器不调 super()：new B() 定抛 ReferenceError；派生构造器重复调 super()：第二次定抛 ReferenceError；正常 super() 路径不受影响（值仍精确）；基类构造器不受影响（无 super 需求）；隐式派生构造器（无显式 ctor）不受影响；多层派生链：内层 super() 不得被误判成外层「已调」（各层各记各的）	exec-transpile 聚合矩阵	没测该层	keep	keep	—
类实例目标：源属性不丢；类实例目标：自有键集合含源属性；Error 实例目标：源属性不丢；Date 实例目标：源属性不丢；Map 实例目标：源属性不丢；函数构造实例目标：源属性不丢	exec-transpile 聚合矩阵	没测该层	keep	keep	—
父类 getter-only 同名访问器不拦截子类字段落地；父类 setter-only：字段落地不调父类 setter（父类侧槽保持缺席）；父类 getter+setter 同款：字段落地仍不派发父类访问器；字段是自有可枚举属性（Object.keys 可见）；无访问器干扰的普通字段路径不受影响	exec-transpile 聚合矩阵	没测该层	keep	keep	—
typeof it.next → "function"（原生协议面；此前 "undefined"）；typeof it[Symbol.iterator] → "function"；it.next().value[0] → 首个匹配项；it.next() 逐次推进同一游标（第二次 → 第二项）；耗尽后 done → true、value → undefined；Object.prototype.toString.call(it) → "[object RegExp String	exec-transpile 聚合矩阵	没测该层	keep	keep	—
宿主构造器返回数组：new F() 是数组；宿主构造器返回数组：内容可读（不是被换回的 this）；宿主构造器返回函数：typeof new F() === 'function'；宿主构造器返回箭头函数：typeof new F() === 'function'；宿主构造器返回原始值：忽略并返回 this（typeof 仍 'object'）；宿主构造器返回普通对象：仍用它（既有口径不退化）；类构造器返回数组：new C() 是数组（既有口径不退化）	exec-transpile 聚合矩阵	没测该层	keep	keep	—
Number.prototype.toLocaleString 保留千分位（此前折成 toString）；Number.prototype.toLocaleString 保留 -0 的符号；Number.prototype.toLocaleString 保留指数形态的分组展开；BigInt.prototype.toLocaleString 保留千分位；默认 locale 也不再折成 toString 的裸数字串；locales 为 null → 确定 TypeError（nu	exec-transpile 聚合矩阵	没测该层	keep	keep	—
search("(") → SyntaxError（此前 throws 域折 never）；match("(") → SyntaxError；match("*") → SyntaxError（非法量词）；matchAll("(") → SyntaxError；抽象接收者路径同样进 throws 面；合法模式不受影响（对照组）；try/catch 可吸收（原生同款）	exec-transpile 聚合矩阵	没测该层	keep	keep	—
宿主函数 bind 产物：new B() 的 this = 新实例（绑定实参前置）；类值 bind 产物：new B() 造的是目标类的实例；二次 bind 产物仍可构造（绑定实参逐层前置）；普通调用面不受影响（B(9) 走绑定 thisArg——原生同口径抛 TypeError）	exec-transpile 聚合矩阵	没测该层	keep	keep	—
靶不可构造（箭头函数）：定抛 TypeError；靶不可构造（普通对象）：定抛 TypeError；靶不可构造：construct 陷阱**不派发**（副作用不发生）；靶可构造（函数表达式）：construct 陷阱照常派发	exec-transpile 聚合矩阵	没测该层	keep	keep	—
apply({length:2,0:1,1:2}) ⇒ 2 个实参（native 2）；apply 的实参值参与运算（native 3）；apply({length:0}) ⇒ 0 个实参（native 0）；apply({length:1,0:9}) ⇒ 1 个实参（native 1）；control：apply 真数组 ⇒ 3 个实参（native 3）；差分对账（native oracle）：改前 MISMATCH / 改后一致	exec-transpile 聚合矩阵	没测该层	keep	keep	—
派生类 static 字段遮蔽继承的 static 方法 → 原生 TypeError；三级链同样遮蔽（C extends B extends A）；读面不受影响：B.m 仍是 own 静态字段值 2；无自有静态字段时不回归：空派生类继承父类 static 方法；自有静态方法覆盖不回归（own static method wins）；祖先的静态字段同样遮蔽（原生 own 查找序：B.__proto__ = A）；own 静态字段值可调用 → 调用它（this = 类值）；Ty	exec-transpile 聚合矩阵	没测该层	keep	keep	—
number 侧成员不再被排除：pick(y).toFixed() 的值是 number 分支结果（native "1"）；string 侧缺该方法 ⇒ 该分支记 TypeError may-throw（原生该分支定抛）；number 侧缺该方法（toUpperCase）⇒ 同样记 TypeError may-throw（改前无记录 = 假绿）；两侧都有该方法（toString）⇒ 不记 throws，值域是两侧的并；control：字面量 number 的 toFixed	exec-transpile 聚合矩阵	没测该层	keep	keep	—
Math.clamp(1,0,2) ⇒ TypeError；JSON.foo(1) ⇒ TypeError；Object.foo(1) ⇒ TypeError；Number.foo(1) ⇒ TypeError；Reflect.foo(1) ⇒ TypeError；成员存在但不是函数（Math.PI()）⇒ TypeError；control：Math.max(1,3) ⇒ 3（原生一致）；control：JSON.parse("2") ⇒ 2（原生一致）；差分对账（nati	exec-transpile 聚合矩阵	没测该层	keep	keep	—
数组元组上调用不存在的方法 → 原生 TypeError；内建 brand 上调用不存在的方法 → 原生 TypeError；TypeError 可被 try/catch 吸收（原生同口径）；原型面内的方法不回归：数组方法照常派发；原型面内的方法不回归：内建 brand 方法照常派发；Object.prototype 名不回归（数组上的 toString / hasOwnProperty）；注册用户类实例不回归（域不同：callSiteHasNoCallableTarget	exec-transpile 聚合矩阵	没测该层	keep	keep	—
super.constructor.name = 父类名；super.constructor === 父类（引用恒等）；无显式构造器的父类同样取到父类名	exec-transpile 聚合矩阵	没测该层	keep	keep	—
search(undefined) → 0（空模式在 0 处匹配）；search(void 0) → 0；match(undefined)[0] → ""；match(undefined).length → 1	exec-transpile 聚合矩阵	没测该层	keep	keep	—
Object.keys(F.prototype) → ''（原生空）；constructor 描述符 enumerable → false；Object.getOwnPropertyNames(F.prototype) → 'constructor'（自有但在枚举视图外）；Object.assign 不复制 constructor（原生不复制不可枚举键）；复制出的对象上 constructor !== 原型（原生不复制）；spread 同样不复制 constructor	exec-transpile 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
同名 static + 实例方法并存 ⇒ A.m() 跑静态体（native "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
类值上无该静态成员 ⇒ 定抛 TypeError（native: A.m is not a function）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：实例接收者仍跑实例体（native "I"）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：只有静态方法 ⇒ A.m() 跑静态体（native "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：静态方法沿构造器继承链（B extends A ⇒ B.m() → "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
差分对账（native oracle）：改前 MISMATCH / 改后一致	dup:exec-transpile 聚合矩阵	commit:54f54850
const g = A.m（静态侧）⇒ g() 跑静态体（native "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
const g = new A().m（实例侧）⇒ g() 跑实例体（native "I"）	dup:exec-transpile 聚合矩阵	commit:54f54850
借用调用：g.call(A) ⇒ 跑静态体（native "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：只有静态方法 ⇒ 摘下调用跑静态体（native "S"）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：只有实例方法 ⇒ 摘下调用跑实例体（native "I"）	dup:exec-transpile 聚合矩阵	commit:54f54850
差分对账（native oracle）：改前 FALSE-THROW / 改后一致	dup:exec-transpile 聚合矩阵	commit:54f54850
charAt(0, 1n) → "a"（此前判「必抛 TypeError」）	dup:exec-transpile 聚合矩阵	commit:54f54850
charCodeAt(0, 1n) → 97	dup:exec-transpile 聚合矩阵	commit:54f54850
codePointAt(0, 1n) → 97	dup:exec-transpile 聚合矩阵	commit:54f54850
at(0, 1n) → "a"	dup:exec-transpile 聚合矩阵	commit:54f54850
对照组：真有两实参的方法仍校验第二实参（slice / substring / substr）	dup:exec-transpile 聚合矩阵	commit:54f54850
对照组：单参调用仍正常折叠	dup:exec-transpile 聚合矩阵	commit:54f54850
A 模块实例的构造体与自有字段不被 B 模块的同名类顶掉	dup:exec-transpile 聚合矩阵	commit:54f54850
B 模块实例保持自己的字段（对照：不是把两边都改坏）	dup:exec-transpile 聚合矩阵	commit:54f54850
A 模块实例上不存在的成员判 undefined（不读到 B 的槽）	dup:exec-transpile 聚合矩阵	commit:54f54850
B 模块实例上不存在的成员判 undefined（不读到 A 的槽）	dup:exec-transpile 聚合矩阵	commit:54f54850
实例方法链首环用值自己的规格：mkA().kind() 恒为 A 的方法体	dup:exec-transpile 聚合矩阵	commit:54f54850
a) 无界迭代器：break 臂可达 ⇒ IteratorClose 的 return() 计入出口（宿主同结论）	dup:exec-transpile 聚合矩阵	commit:54f54850
b) 有界迭代器（报 done）仍逐元素精确展开：break 关闭 ⇒ CLOSED，自然耗尽 ⇒ 不关闭 ⇒ NOT	dup:exec-transpile 聚合矩阵	commit:54f54850
b2) 有界迭代仍精确：0+1+2 折 3 #exact（不得因代表元抽象而宽化）	dup:exec-transpile 聚合矩阵	commit:54f54850
c) 循环变量 = 元素域抽象（不折首元素 0）——修前 `return x` 折 0 #exact	dup:exec-transpile 聚合矩阵	commit:54f54850
c2) 代表元抽象后分支两侧都探索——修前 out 折 "miss" #exact	dup:exec-transpile 聚合矩阵	commit:54f54850
A.prototype.m = fn ⇒ new A().m() 跑用户函数（native 2）	dup:exec-transpile 聚合矩阵	commit:54f54850
a.m = fn ⇒ a.m() 跑用户函数（native 5）	dup:exec-transpile 聚合矩阵	commit:54f54850
ctor 内 this.m = fn ⇒ new A().m() 跑用户函数（native 3）	dup:exec-transpile 聚合矩阵	commit:54f54850
A.prototype.m = 5 ⇒ 调用定抛 TypeError（native: not a function）	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.defineProperty(A.prototype,'m',{value:fn}) ⇒ 跑用户函数（native 4）	dup:exec-transpile 聚合矩阵	commit:54f54850
实例自有槽遮住原型上的写（native 6）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：未打补丁 ⇒ 仍走注册表方法体（native 1）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：原型上新名字（注册表无此名）⇒ 走写面（native 7）	dup:exec-transpile 聚合矩阵	commit:54f54850
派生构造器不调 super()：new B() 定抛 ReferenceError	dup:exec-transpile 聚合矩阵	commit:54f54850
派生构造器重复调 super()：第二次定抛 ReferenceError	dup:exec-transpile 聚合矩阵	commit:54f54850
正常 super() 路径不受影响（值仍精确）	dup:exec-transpile 聚合矩阵	commit:54f54850
基类构造器不受影响（无 super 需求）	dup:exec-transpile 聚合矩阵	commit:54f54850
隐式派生构造器（无显式 ctor）不受影响	dup:exec-transpile 聚合矩阵	commit:54f54850
多层派生链：内层 super() 不得被误判成外层「已调」（各层各记各的）	dup:exec-transpile 聚合矩阵	commit:54f54850
类实例目标：源属性不丢	dup:exec-transpile 聚合矩阵	commit:54f54850
类实例目标：自有键集合含源属性	dup:exec-transpile 聚合矩阵	commit:54f54850
Error 实例目标：源属性不丢	dup:exec-transpile 聚合矩阵	commit:54f54850
Date 实例目标：源属性不丢	dup:exec-transpile 聚合矩阵	commit:54f54850
Map 实例目标：源属性不丢	dup:exec-transpile 聚合矩阵	commit:54f54850
函数构造实例目标：源属性不丢	dup:exec-transpile 聚合矩阵	commit:54f54850
父类 getter-only 同名访问器不拦截子类字段落地	dup:exec-transpile 聚合矩阵	commit:54f54850
父类 setter-only：字段落地不调父类 setter（父类侧槽保持缺席）	dup:exec-transpile 聚合矩阵	commit:54f54850
父类 getter+setter 同款：字段落地仍不派发父类访问器	dup:exec-transpile 聚合矩阵	commit:54f54850
字段是自有可枚举属性（Object.keys 可见）	dup:exec-transpile 聚合矩阵	commit:54f54850
无访问器干扰的普通字段路径不受影响	dup:exec-transpile 聚合矩阵	commit:54f54850
typeof it.next → "function"（原生协议面；此前 "undefined"）	dup:exec-transpile 聚合矩阵	commit:54f54850
typeof it[Symbol.iterator] → "function"	dup:exec-transpile 聚合矩阵	commit:54f54850
it.next().value[0] → 首个匹配项	dup:exec-transpile 聚合矩阵	commit:54f54850
it.next() 逐次推进同一游标（第二次 → 第二项）	dup:exec-transpile 聚合矩阵	commit:54f54850
耗尽后 done → true、value → undefined	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.prototype.toString.call(it) → "[object RegExp String Iterator]"	dup:exec-transpile 聚合矩阵	commit:54f54850
协议槽是原型的（非自有可枚举）：Object.keys 空、hasOwnProperty 假、in 真	dup:exec-transpile 聚合矩阵	commit:54f54850
展开 / for-of 仍按侧表精确迭代（对照组）	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回数组：new F() 是数组	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回数组：内容可读（不是被换回的 this）	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回函数：typeof new F() === 'function'	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回箭头函数：typeof new F() === 'function'	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回原始值：忽略并返回 this（typeof 仍 'object'）	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主构造器返回普通对象：仍用它（既有口径不退化）	dup:exec-transpile 聚合矩阵	commit:54f54850
类构造器返回数组：new C() 是数组（既有口径不退化）	dup:exec-transpile 聚合矩阵	commit:54f54850
Number.prototype.toLocaleString 保留千分位（此前折成 toString）	dup:exec-transpile 聚合矩阵	commit:54f54850
Number.prototype.toLocaleString 保留 -0 的符号	dup:exec-transpile 聚合矩阵	commit:54f54850
Number.prototype.toLocaleString 保留指数形态的分组展开	dup:exec-transpile 聚合矩阵	commit:54f54850
BigInt.prototype.toLocaleString 保留千分位	dup:exec-transpile 聚合矩阵	commit:54f54850
默认 locale 也不再折成 toString 的裸数字串	dup:exec-transpile 聚合矩阵	commit:54f54850
locales 为 null → 确定 TypeError（number）	dup:exec-transpile 聚合矩阵	commit:54f54850
locales 为 null → 确定 TypeError（bigint）	dup:exec-transpile 聚合矩阵	commit:54f54850
locales 为 null → 确定 TypeError（字符串 toLocaleUpperCase）	dup:exec-transpile 聚合矩阵	commit:54f54850
locales 为非法 language tag → 确定 RangeError	dup:exec-transpile 聚合矩阵	commit:54f54850
无实参 / 非 string 实参 → 仍 total（原生忽略 symbol / 数字 locales）	dup:exec-transpile 聚合矩阵	commit:54f54850
search("(") → SyntaxError（此前 throws 域折 never）	dup:exec-transpile 聚合矩阵	commit:54f54850
match("(") → SyntaxError	dup:exec-transpile 聚合矩阵	commit:54f54850
match("*") → SyntaxError（非法量词）	dup:exec-transpile 聚合矩阵	commit:54f54850
matchAll("(") → SyntaxError	dup:exec-transpile 聚合矩阵	commit:54f54850
抽象接收者路径同样进 throws 面	dup:exec-transpile 聚合矩阵	commit:54f54850
合法模式不受影响（对照组）	dup:exec-transpile 聚合矩阵	commit:54f54850
try/catch 可吸收（原生同款）	dup:exec-transpile 聚合矩阵	commit:54f54850
宿主函数 bind 产物：new B() 的 this = 新实例（绑定实参前置）	dup:exec-transpile 聚合矩阵	commit:54f54850
类值 bind 产物：new B() 造的是目标类的实例	dup:exec-transpile 聚合矩阵	commit:54f54850
二次 bind 产物仍可构造（绑定实参逐层前置）	dup:exec-transpile 聚合矩阵	commit:54f54850
普通调用面不受影响（B(9) 走绑定 thisArg——原生同口径抛 TypeError）	dup:exec-transpile 聚合矩阵	commit:54f54850
靶不可构造（箭头函数）：定抛 TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
靶不可构造（普通对象）：定抛 TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
靶不可构造：construct 陷阱**不派发**（副作用不发生）	dup:exec-transpile 聚合矩阵	commit:54f54850
靶可构造（函数表达式）：construct 陷阱照常派发	dup:exec-transpile 聚合矩阵	commit:54f54850
apply({length:2,0:1,1:2}) ⇒ 2 个实参（native 2）	dup:exec-transpile 聚合矩阵	commit:54f54850
apply 的实参值参与运算（native 3）	dup:exec-transpile 聚合矩阵	commit:54f54850
apply({length:0}) ⇒ 0 个实参（native 0）	dup:exec-transpile 聚合矩阵	commit:54f54850
apply({length:1,0:9}) ⇒ 1 个实参（native 1）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：apply 真数组 ⇒ 3 个实参（native 3）	dup:exec-transpile 聚合矩阵	commit:54f54850
派生类 static 字段遮蔽继承的 static 方法 → 原生 TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
三级链同样遮蔽（C extends B extends A）	dup:exec-transpile 聚合矩阵	commit:54f54850
读面不受影响：B.m 仍是 own 静态字段值 2	dup:exec-transpile 聚合矩阵	commit:54f54850
无自有静态字段时不回归：空派生类继承父类 static 方法	dup:exec-transpile 聚合矩阵	commit:54f54850
自有静态方法覆盖不回归（own static method wins）	dup:exec-transpile 聚合矩阵	commit:54f54850
祖先的静态字段同样遮蔽（原生 own 查找序：B.__proto__ = A）	dup:exec-transpile 聚合矩阵	commit:54f54850
own 静态字段值可调用 → 调用它（this = 类值）	dup:exec-transpile 聚合矩阵	commit:54f54850
TypeError 可被 try/catch 吸收（原生同口径）	dup:exec-transpile 聚合矩阵	commit:54f54850
number 侧成员不再被排除：pick(y).toFixed() 的值是 number 分支结果（native "1"）	dup:exec-transpile 聚合矩阵	commit:54f54850
string 侧缺该方法 ⇒ 该分支记 TypeError may-throw（原生该分支定抛）	dup:exec-transpile 聚合矩阵	commit:54f54850
number 侧缺该方法（toUpperCase）⇒ 同样记 TypeError may-throw（改前无记录 = 假绿）	dup:exec-transpile 聚合矩阵	commit:54f54850
两侧都有该方法（toString）⇒ 不记 throws，值域是两侧的并	dup:exec-transpile 聚合矩阵	commit:54f54850
control：字面量 number 的 toFixed 仍是精确值（native "1"）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：字面量 string 的 toFixed 记 TypeError may-throw（原生定抛）	dup:exec-transpile 聚合矩阵	commit:54f54850
Math.clamp(1,0,2) ⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
JSON.foo(1) ⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.foo(1) ⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
Number.foo(1) ⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
Reflect.foo(1) ⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
成员存在但不是函数（Math.PI()）⇒ TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
control：Math.max(1,3) ⇒ 3（原生一致）	dup:exec-transpile 聚合矩阵	commit:54f54850
control：JSON.parse("2") ⇒ 2（原生一致）	dup:exec-transpile 聚合矩阵	commit:54f54850
差分对账（native oracle）：改前 MISSED-THROW / 改后一致	dup:exec-transpile 聚合矩阵	commit:54f54850
数组元组上调用不存在的方法 → 原生 TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
内建 brand 上调用不存在的方法 → 原生 TypeError	dup:exec-transpile 聚合矩阵	commit:54f54850
原型面内的方法不回归：数组方法照常派发	dup:exec-transpile 聚合矩阵	commit:54f54850
原型面内的方法不回归：内建 brand 方法照常派发	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.prototype 名不回归（数组上的 toString / hasOwnProperty）	dup:exec-transpile 聚合矩阵	commit:54f54850
注册用户类实例不回归（域不同：callSiteHasNoCallableTarget 判）	dup:exec-transpile 聚合矩阵	commit:54f54850
闭对象接收者不回归（既有 definitelyUncallableMember 路径）	dup:exec-transpile 聚合矩阵	commit:54f54850
prim 接收者的软判定不回归（number 上缺失方法 → unknown + may-throw）	dup:exec-transpile 聚合矩阵	commit:54f54850
super.constructor.name = 父类名	dup:exec-transpile 聚合矩阵	commit:54f54850
super.constructor === 父类（引用恒等）	dup:exec-transpile 聚合矩阵	commit:54f54850
无显式构造器的父类同样取到父类名	dup:exec-transpile 聚合矩阵	commit:54f54850
search(undefined) → 0（空模式在 0 处匹配）	dup:exec-transpile 聚合矩阵	commit:54f54850
search(void 0) → 0	dup:exec-transpile 聚合矩阵	commit:54f54850
match(undefined)[0] → ""	dup:exec-transpile 聚合矩阵	commit:54f54850
match(undefined).length → 1	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.keys(F.prototype) → ''（原生空）	dup:exec-transpile 聚合矩阵	commit:54f54850
constructor 描述符 enumerable → false	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.getOwnPropertyNames(F.prototype) → 'constructor'（自有但在枚举视图外）	dup:exec-transpile 聚合矩阵	commit:54f54850
Object.assign 不复制 constructor（原生不复制不可枚举键）	dup:exec-transpile 聚合矩阵	commit:54f54850
复制出的对象上 constructor !== 原型（原生不复制）	dup:exec-transpile 聚合矩阵	commit:54f54850
spread 同样不复制 constructor	dup:exec-transpile 聚合矩阵	commit:54f54850
```
