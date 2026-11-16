# packages/core/src/algebra/__tests__/algebra-object-runtime.test.ts

模块套件：对象/原型/Proxy/Reflect/属性描述符面。

审计：228 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
isHiddenInternalSlot 剔除 symbolKey 槽（与 service 副本同款）；internal 规则与规范数组下标例外保持不变；formatShape（check / test 签名面）不发布符号键槽；denoteGuard（guard 面）不写恒假的 Object.hasOwn(@@iterator) 子句	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
字符串键 "@@iterator" 在 tuple 上确定缺席（改前折成函数）；"@@iterator" in [1,2] → false（改前是自信的 true）；Symbol.iterator in [1,2] → true（符号键保持命中，既有钉不回归）；普通对象面本就正确，不回归；Array.prototype 普通字符串键方法不受影响；调用面同样分态：字符串键 "@@iterator"() 不产迭代器、Symbol.iterator() 产迭代器；brand 面同样	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
(5).toString.call(5) ⇒ "5"（不是 "[object Number]"）；true.toString.call(true) ⇒ "true"（不是 "[object Boolean]"）；(5).toString.call("x") ⇒ 定抛 TypeError（brand check）；(5).toString.call(5n) ⇒ 定抛 TypeError（brand check）；(5).toString.call(true) ⇒ 定抛 Type	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
gOPD(function f(){}, "length").value ⇒ 0（原生精确值）；gOPD(function f(){}, "name").writable ⇒ false（原生 false）；gOPD(function f(){}, "name").value ⇒ 字符串（不抛、不折 never）；gOPD(class A {}, "name").value ⇒ "A"（原生精确值）；gOPD(function f(){}, "prototype").writ	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
shape({ ['__proto__']: number() }) 的字段表含 __proto__ 自有键；partial / omit / pick 转一道后字段仍在（不二次吞键）；对照组：普通字段名行为不变（不被误伤）；契约面：shape({ __proto__: number() }) 的字段不得消失；门禁面：f({}) 违反「含 __proto__: number」⇒ 报 missing field（改前判绿）；门禁面：对照组（字段名 p）与 __proto__ 的	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
Object.getOwnPropertyDescriptor(p, "a").value ⇒ 抛 TypeError（native：同款）；Reflect.getOwnPropertyDescriptor(p, "a").value ⇒ 抛 TypeError（native：同款）；用户 try/catch 捕到（native："threw"）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶属性**可写**（普通 {a:1}）⇒ 陷阱值原样给出（native：2）；陷阱报**同一个值** ⇒ 不抛（native：值一致不违 12.f）；靶**无**该自有键 + 陷阱报**可配置** ⇒ 不变量不适用（native：不抛，2）；非 Proxy 路径不受影响：{a:1} 的描述符 value 1	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶 {} + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）；靶 {} + 陷阱报 configurable:true ⇒ 不抛（native：2）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶可配置 + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）；靶不可配置 + 陷阱报 configurable:true ⇒ 抛 TypeError（native：抛）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶不可配置+可写 + 陷阱报 writable:false ⇒ 抛 TypeError（native：抛）；靶不可配置+可写 + 陷阱报 enumerable 不同 ⇒ 抛 TypeError（native：抛）；靶不可配置+不可写 + 陷阱报 writable:true ⇒ 抛 TypeError（native：抛）；靶不可配置+可写 + 陷阱报同 writable/enumerable ⇒ 不抛（native：2）；靶可配置 ⇒ 陷阱报任意 writable/enumer	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶是访问器 + 陷阱报数据描述符 ⇒ 抛 TypeError（native：抛）；靶是数据属性 + 陷阱报访问器描述符 ⇒ 抛 TypeError（native：抛）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
Reflect.ownKeys(gOPDs(o)).length ⇒ 2（native：2；修前：1）；Object.getOwnPropertySymbols(gOPDs(o)).length ⇒ 1（native：1；修前：0）；well-known symbol 键同款：ownKeys 2 条 / getOwnPropertySymbols 1 条（native 同款）；symbol 键的描述符值可读（native：d[Symbol.toStringTag].value	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
Object.keys(gOPDs(o)) ⇒ "a"（native：symbol 键不进字符串键面）；Object.getOwnPropertyNames(gOPDs(o)) ⇒ "a"（native：同款）；无 symbol 键的对象：gOPDs 只有一个字符串键（native 同款）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
ownKeys(o) ⇒ "a,sym"（native：a 在前、symbol 在后；修前："sym,a"）；ownKeys(o)[0] 是字符串 "a"、typeof ownKeys(o)[1] 是 "symbol"（native 同款）；well-known symbol 键同款："a,sym"（native 同款）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
只有字符串键：ownKeys 保持插入序（native："b,a"）；整数键升序在前（native："0,1"）；无 symbol 键时长度不变（native：1）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
Object 面：靶是可配置数据属性 + 陷阱报访问器描述符 ⇒ 不抛；Reflect 面同款 ⇒ 不抛；Object 面：靶是可配置访问器属性 + 陷阱报数据描述符 ⇒ 不抛；Reflect 面同款 ⇒ 不抛	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
Object 面：靶是不可配置数据属性 + 陷阱报访问器描述符 ⇒ 抛；Reflect 面同款 ⇒ 抛；Object 面：靶是不可配置访问器属性 + 陷阱报数据描述符 ⇒ 抛；Reflect 面同款 ⇒ 抛	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
陷阱诚实报 enumerable:true ⇒ 不抛（native：不抛）；Reflect 面同款 ⇒ 不抛；陷阱报 writable:true ⇒ 抛（frozen 仍冻结 writable；native：抛）；陷阱报 enumerable:false ⇒ 抛（靶的 enumerable 仍是 true；native：抛）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
陷阱报与靶完全一致的描述符 ⇒ 不抛（native：不抛）；Reflect 面同款 ⇒ 不抛；陷阱报 writable:true ⇒ 抛（native：抛）；陷阱报 enumerable:false ⇒ 抛（native：抛）；陷阱报 value:2（值不同）⇒ 抛（native：抛）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
可配置靶 + 异形态陷阱 ⇒ 零 L2 / 零 error（修前：error 级 1 条 ⇒ 卡 CI）；frozen 靶 + 陷阱诚实报 ⇒ 零 L2 / 零 error（修前：error 级 1 条）；brand 靶 + 陷阱报一致描述符 ⇒ 零 L2 / 零 error（修前：error 级 1 条）；负控制：真违约（不可配置靶 + 不可写 + 值不同）⇒ 仍报 error 级 L2（闸门没被关掉）；负控制：不可配置靶 + 异形态陷阱 ⇒ 仍报 error 级 L2（闸	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
槽带 internal 标记（投影面据此剔除）；isHiddenInternalSlot 对 [[PrimitiveValue]] 判真（guard / dts / schema 三面同判据）；运行时面：new Number(1) 的 getOwnPropertyNames 是 []（原生同款）；运行时面：new Number(1).hasOwnProperty("[[PrimitiveValue]]") 是 false；对照组：new String("s") 的**真实**	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
u.toJSON 折函数值（不是 exact undefined）；u.toJSON === undefined 折 false（此前假绿 true）；"toJSON" in u 折 exact true（此前假红 false）；u.toString 同为原型方法（同一行表项的四项之一）；对照：host 半已修且不得回退（host 含端口、hostname 不含）；对照：组件槽（href/hostname/pathname/search）读面不回退	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
legacy 四件的 `=== undefined` 恒 false（原生恒是函数）；legacy 四件的 `in` 面仍为 true（与值读面同结论）；对照组：既有六件两表都有 ⇒ 值读面仍正确；同步守卫：`in` 面名单 ⊆ 值读面名单 ∪ {constructor, __proto__}	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
no hard TypeError for registered symbol members；iterator member calls yield an iterator face (not undefined)	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
missing prototype ⇒ native TypeError (not a synthetic brand)；generator function has a prototype ⇒ boolean	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
2 参合法形：target/argsList 均为用户类值 → 不抛、不记 may；3 参形（newTarget 亦用户类）→ target/newTarget 两侧均不记 may；内建类值控制组（Array）结论不变：不抛、不记 may；对照：实例 brand 无 ctor facet ⇒ 保守口径保持（不折假不抛）；对照：ctor:false 的宿主一等函数（Math.max）⇒ 定抛 TypeError	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
"returns the explicit object instead of may-throw"	"回归：`Reflect.construct(用户类, argsList[, newTarget])` 不得误报 may-throw TypeError。 原生（node v26）：用户类值 `class A {}` 恒有 `[[Construct]]`（ClassDefinition- Evaluation 建构造器时装）⇒ `Reflect.construct(A, [])` / `(A, [], B)` **从不抛**。 断言：expect(sigOf(r, \"derivedReturnObj\")).toBe(\"{ q: 1 }\");；expect(sigOf(r, \"DerivedB\")).toBe(\"DerivedB\");"	夹具漏形态	keep	keep	—
getter through a computed variable key resolves；plain literal key resolves	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶上不可配置自有属性 + 陷阱返 false ⇒ 定抛 TypeError（改前：false，不抛）；负控：同一陷阱 + 靶上该键**可配置** ⇒ 不抛，值 false（缺口只在这一格）；负控：靶上**没有**该键 + 陷阱返 false ⇒ 不抛，值 false；负控：陷阱返 true ⇒ 不触发不变式（该门只对 falsy 生效）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
toUpperCase.call(1) = '1'（原生 generic；此前定抛 TypeError）；trim / charAt / at / concat 借用给数字接收者 = 原生值；品牌方法仍要品牌（toString / valueOf.call(1) → TypeError）；nullish 接收者仍定抛（RequireObjectCoercible）；其它家族的品牌检查不受影响（Number.toFixed.call('s') → TypeError）；直接字符	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
literal symbol key reads back；computed symbol assignment reads back；own symbol keys are counted	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
toString.call({name:'X', message:'y'}) = 'X: y'（原生；此前定抛）；toString.call({}) = 'Error'（缺省名）；toString.call({name:'X'}) = 'X'（空消息只回名）；空名只回消息（toString.call({name:'',message:'y'}) = 'y'）；TypeError.prototype.toString 同口径（'X: y'）；Error 实例沿既有 brand	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
"a" in Object.create({a:1}) 折 exact true（HasProperty 口径）；自有键面不得见继承槽（Object.keys/values/entries/for-in）；值面维持保守 unknown（只承诺存在性，不冒充确定值）；对照：自有属性对象行为不变；门禁面：f(Object.create({a:1})) 不再报 missing field（与三个导出产物同结论）；门禁面负控制：真缺字段仍报 missing field（不得整面放水）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
靶是普通对象 → throws TypeError（此前 unknown + never）；靶是数组 → throws TypeError；靶是类值 → throws TypeError（类构造器不带 new 被调）；靶不可调用 → apply 陷阱**不派发**（原生同口径）；控制组：可调用靶的代理调用正常（不抛）；控制组：代理的读面正常（get 陷阱不受影响）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
无 apply 陷阱 → 回退靶的 [[Call]]（此前恒 unknown）；apply 陷阱 → 派发并取其返回值；apply 陷阱副作用保留（此前陷阱从未被调用）；apply 陷阱实参口径：(target, thisArg, args)；控制组：get 陷阱仍照旧派发（本次只加 apply 面）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
类实例：描述符映射的键集 = 自有键集（改前 []）；类实例：键集与 gOPN / gOPD(单数) 三面一致（引擎内部不再互斥）；描述符内容精确：类字段是 writable/enumerable/configurable 全真的数据属性；内建 brand（Error 家族）：键集 = 自有键集（stack/message，name 是原型链槽）；内建 brand（Map + m.foo）：键集 = 用户新增自有键；单变量对照组 A：普通对象（引擎 == 宿主）；单变量对照组	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
陷阱报 false 而靶可扩展 → TypeError（此前恒折 true）；陷阱报 true 而靶可扩展 → true（陷阱被调用，副作用保留）；靶已不可扩展：陷阱报 false → false（不变量一致，不抛）；靶已不可扩展：陷阱报 true → TypeError（不变量冲突）；陷阱副作用保留（此前陷阱从未被调用）；无陷阱 → 回退靶语义（控制组）；控制组：普通对象 → true；不可扩展普通对象 → false；陷阱内抛出的 TypeError 透出（throws	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
陷阱返回不在靶上的键 → 0 次（此前枚举靶的 2 个键）；陷阱返回不在靶上的键 → 键序列为空（此前 "ac"）；陷阱部分命中 → 只枚举可枚举的命中键；陷阱全命中 → 键序按陷阱结果（原生不重排整数键）；无 ownKeys 陷阱 → 落靶语义（控制组）；陷阱返回重复键 → 原生抛 TypeError（规范不变量）；陷阱漏掉靶的不可配置自有键 → 原生抛 TypeError（规范不变量）；陷阱副作用保留（此前陷阱从未被调用）；控制组：普通对象的 for…in 不受影响；gO	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
原生 oracle：可克隆形态不抛 / 不可克隆形态抛 DataCloneError；L2 门禁：可克隆形态零 L2（原口径：一条 may throw TypeError 假红）；L2 门禁：不可克隆形态一条 L2（kind = DataCloneError）；契约面：`@nudo:throws DataCloneError` 能申报（原先写不出正确的 kind）；无约束实参（any）：仍诚实记 may-throw，但 kind 是 DataCloneError；try-ca	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
"可克隆形态（%s）：零 throws 面（native 不抛 ⇒ 原口径是假红）"	表驱动用例：可克隆形态（%s）：零 throws 面（native 不抛 ⇒ 原口径是假红）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"不可克隆形态（%s）：throws 面 = DataCloneError（不是 TypeError）"	表驱动用例：不可克隆形态（%s）：throws 面 = DataCloneError（不是 TypeError）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
原型链 key 不进字段表（constructor / toString / valueOf …）；字段表里的每个条目都是真字段（带 constraint）；原型链 key 不得让契约崩溃（entry Abs / 实例化面）；合法 key 仍然取到字段	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
shape(42) 抛 Nudo 原生诊断（点名构造器 + 实际类型）；shape(null) / shape([]) / shape("x") 同样被拒；正常实参不受影响；产品面：shape(42) 的侧车契约不再静默退化成空 shape	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
`o[{}] = 1` 的键为 "[object Object]" ⇒ 写落地（native：1）；`o[k] = 1`（k 有 toString）⇒ 键为 toString 的结果（native：1）；类实例接收者同样落地（native："number"）；读面：对象键读到对应的槽值（native：1）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
写面：键的 toString 被调一次（native：1）；读面：键的 toString 被调一次（native：1）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
"函数键的 ToString 不可判 ⇒ 键集折 partial（native：1，引擎不得折 exact 0）"	"计算成员访问的**对象键**不做 ToPropertyKey：写被静默丢弃、 键强制转换副作用全丢。 修前（HEAD）：`propertyKeyOf` 只认**字面量** term ⇒ 对象键落「抽象键」臂 ⇒ - 写被**静默丢弃**（`o[{}] = 1` 之后 `Object.keys(o).length` = 0； 断言：expect(r.ok).toBe(false);"	夹具漏形态	keep	keep	—
"字符串键 / 数字键照旧落地（native：1）"	"计算成员访问的**对象键**不做 ToPropertyKey：写被静默丢弃、 键强制转换副作用全丢。 修前（HEAD）：`propertyKeyOf` 只认**字面量** term ⇒ 对象键落「抽象键」臂 ⇒ - 写被**静默丢弃**（`o[{}] = 1` 之后 `Object.keys(o).length` = 0； 断言：expect(val(`export function f() { const o = {}; o[\"x\"] = 1; return Object.keys(o).length; }`)).toEqual({；expect(val(`export function f() { const o = {}; o"	夹具漏形态	keep	keep	—
`Object.setPrototypeOf(Object.prototype, {})` ⇒ 抛 TypeError（native：同款）；用户 try/catch 捕到（native："threw"）；设为自身原型同样拒绝（native：同款）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
"`Reflect.setPrototypeOf(Object.prototype, {})` ⇒ false（native：false）"	"`Object.setPrototypeOf(Object.prototype, …)` **不查不可变原型**： 引擎**静默改写** `Object.prototype` 的原型并声称「不会抛」（假绿）。 修前（HEAD）：`protoChangeAllowed` 只查 extensibility + SameValue ⇒ `Object.setPrototypeOf(Object.prototype, {})` **不抛**（native：TypeError: Immutable prototype object 'Object.prototype' cannot have their prototype set）。 断言："	没测该层	keep	keep	—
`Object.setPrototypeOf(Array.prototype, {})` 不抛（native：可改）；`Reflect.setPrototypeOf(Array.prototype, {})` 返 true（native：true）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
渲染层第二道防线：formatObjectKey 把 `__proto__` 写成计算键（不是裸键）；core 投影层：字段表原型为 null（原型 setter 不会吞掉赋值）；core 投影层：`__proto__` 是自有键（`Object.hasOwn` 为真，键没被吞）；对照：普通键同样投影成自有键（口径一致）	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
display / detail / abs 三字段都不含内部 id；人类面 --verbose 同样不得含内部 id；机器面 display 与人类面签名行同源（口径一致）；detail 首行仍是函数名（Bug 377 的「不得串号」契约不回归）；同内容不同路径 ⇒ 载荷逐字相同（不再随参数列表位置漂移）；非内部 id 的 term 段仍在（verbose 明细不丢信息 —— D2 契约）；不带内部 id 的签名：term / pred 证据仍在（契约面不被无谓收紧）；内部	algebra-object-runtime 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
isHiddenInternalSlot 剔除 symbolKey 槽（与 service 副本同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
internal 规则与规范数组下标例外保持不变	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
formatShape（check / test 签名面）不发布符号键槽	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
denoteGuard（guard 面）不写恒假的 Object.hasOwn(@@iterator) 子句	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
字符串键 "@@iterator" 在 tuple 上确定缺席（改前折成函数）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
"@@iterator" in [1,2] → false（改前是自信的 true）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Symbol.iterator in [1,2] → true（符号键保持命中，既有钉不回归）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
普通对象面本就正确，不回归	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Array.prototype 普通字符串键方法不受影响	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
调用面同样分态：字符串键 "@@iterator"() 不产迭代器、Symbol.iterator() 产迭代器	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
brand 面同样分态：m["@@iterator"] 定缺、m[Symbol.iterator] 折函数	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
arrayProtoMemberForKey：只在真符号键下命中迭代器投影名	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
(5).toString.call(5) ⇒ "5"（不是 "[object Number]"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
true.toString.call(true) ⇒ "true"（不是 "[object Boolean]"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
(5).toString.call("x") ⇒ 定抛 TypeError（brand check）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
(5).toString.call(5n) ⇒ 定抛 TypeError（brand check）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
(5).toString.call(true) ⇒ 定抛 TypeError（brand check）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
true.toString.call(0) ⇒ 定抛 TypeError（brand check）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
(5).valueOf.call(5) ⇒ 5（自身）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
true.valueOf.call(true) ⇒ true（自身）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：string / bigint / symbol 三条 prim 通道仍与原生一致	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(function f(){}, "length").value ⇒ 0（原生精确值）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(function f(){}, "name").writable ⇒ false（原生 false）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(function f(){}, "name").value ⇒ 字符串（不抛、不折 never）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(class A {}, "name").value ⇒ "A"（原生精确值）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(function f(){}, "prototype").writable ⇒ true（普通函数可写）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD(class A {}, "prototype").writable ⇒ false（类值不可写）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Reflect.getOwnPropertyDescriptor(fn, "name").value ⇒ 不抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照组：普通对象的描述符面仍正确（回归控制）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
shape({ ['__proto__']: number() }) 的字段表含 __proto__ 自有键	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
partial / omit / pick 转一道后字段仍在（不二次吞键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照组：普通字段名行为不变（不被误伤）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
契约面：shape({ __proto__: number() }) 的字段不得消失	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
门禁面：f({}) 违反「含 __proto__: number」⇒ 报 missing field（改前判绿）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
门禁面：对照组（字段名 p）与 __proto__ 的判定强度一致（都不放行）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.getOwnPropertyDescriptor(p, "a").value ⇒ 抛 TypeError（native：同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Reflect.getOwnPropertyDescriptor(p, "a").value ⇒ 抛 TypeError（native：同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
用户 try/catch 捕到（native："threw"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶属性**可写**（普通 {a:1}）⇒ 陷阱值原样给出（native：2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报**同一个值** ⇒ 不抛（native：值一致不违 12.f）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶**无**该自有键 + 陷阱报**可配置** ⇒ 不变量不适用（native：不抛，2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
非 Proxy 路径不受影响：{a:1} 的描述符 value 1	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶 {} + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶 {} + 陷阱报 configurable:true ⇒ 不抛（native：2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶可配置 + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可配置 + 陷阱报 configurable:true ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可配置+可写 + 陷阱报 writable:false ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可配置+可写 + 陷阱报 enumerable 不同 ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可配置+不可写 + 陷阱报 writable:true ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可配置+可写 + 陷阱报同 writable/enumerable ⇒ 不抛（native：2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶可配置 ⇒ 陷阱报任意 writable/enumerable ⇒ 不抛（native：2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶是访问器 + 陷阱报数据描述符 ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶是数据属性 + 陷阱报访问器描述符 ⇒ 抛 TypeError（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Reflect.ownKeys(gOPDs(o)).length ⇒ 2（native：2；修前：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.getOwnPropertySymbols(gOPDs(o)).length ⇒ 1（native：1；修前：0）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
well-known symbol 键同款：ownKeys 2 条 / getOwnPropertySymbols 1 条（native 同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
symbol 键的描述符值可读（native：d[Symbol.toStringTag].value === 2）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.keys(gOPDs(o)) ⇒ "a"（native：symbol 键不进字符串键面）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.getOwnPropertyNames(gOPDs(o)) ⇒ "a"（native：同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无 symbol 键的对象：gOPDs 只有一个字符串键（native 同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
ownKeys(o) ⇒ "a,sym"（native：a 在前、symbol 在后；修前："sym,a"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
ownKeys(o)[0] 是字符串 "a"、typeof ownKeys(o)[1] 是 "symbol"（native 同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
well-known symbol 键同款："a,sym"（native 同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
只有字符串键：ownKeys 保持插入序（native："b,a"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
整数键升序在前（native："0,1"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无 symbol 键时长度不变（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object 面：靶是可配置数据属性 + 陷阱报访问器描述符 ⇒ 不抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Reflect 面同款 ⇒ 不抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object 面：靶是可配置访问器属性 + 陷阱报数据描述符 ⇒ 不抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object 面：靶是不可配置数据属性 + 陷阱报访问器描述符 ⇒ 抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Reflect 面同款 ⇒ 抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object 面：靶是不可配置访问器属性 + 陷阱报数据描述符 ⇒ 抛	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱诚实报 enumerable:true ⇒ 不抛（native：不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 writable:true ⇒ 抛（frozen 仍冻结 writable；native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 enumerable:false ⇒ 抛（靶的 enumerable 仍是 true；native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报与靶完全一致的描述符 ⇒ 不抛（native：不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 writable:true ⇒ 抛（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 enumerable:false ⇒ 抛（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 value:2（值不同）⇒ 抛（native：抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
可配置靶 + 异形态陷阱 ⇒ 零 L2 / 零 error（修前：error 级 1 条 ⇒ 卡 CI）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
frozen 靶 + 陷阱诚实报 ⇒ 零 L2 / 零 error（修前：error 级 1 条）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
brand 靶 + 陷阱报一致描述符 ⇒ 零 L2 / 零 error（修前：error 级 1 条）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
负控制：真违约（不可配置靶 + 不可写 + 值不同）⇒ 仍报 error 级 L2（闸门没被关掉）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
负控制：不可配置靶 + 异形态陷阱 ⇒ 仍报 error 级 L2（闸门没被关掉）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
槽带 internal 标记（投影面据此剔除）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
isHiddenInternalSlot 对 [[PrimitiveValue]] 判真（guard / dts / schema 三面同判据）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
运行时面：new Number(1) 的 getOwnPropertyNames 是 []（原生同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
运行时面：new Number(1).hasOwnProperty("[[PrimitiveValue]]") 是 false	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照组：new String("s") 的**真实**自有键仍可见（下标 + length）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
u.toJSON 折函数值（不是 exact undefined）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
u.toJSON === undefined 折 false（此前假绿 true）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
"toJSON" in u 折 exact true（此前假红 false）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
u.toString 同为原型方法（同一行表项的四项之一）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：host 半已修且不得回退（host 含端口、hostname 不含）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：组件槽（href/hostname/pathname/search）读面不回退	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
legacy 四件的 `=== undefined` 恒 false（原生恒是函数）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
legacy 四件的 `in` 面仍为 true（与值读面同结论）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照组：既有六件两表都有 ⇒ 值读面仍正确	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
同步守卫：`in` 面名单 ⊆ 值读面名单 ∪ {constructor, __proto__}	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
no hard TypeError for registered symbol members	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
iterator member calls yield an iterator face (not undefined)	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
missing prototype ⇒ native TypeError (not a synthetic brand)	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
generator function has a prototype ⇒ boolean	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
2 参合法形：target/argsList 均为用户类值 → 不抛、不记 may	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
3 参形（newTarget 亦用户类）→ target/newTarget 两侧均不记 may	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
内建类值控制组（Array）结论不变：不抛、不记 may	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：实例 brand 无 ctor facet ⇒ 保守口径保持（不折假不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：ctor:false 的宿主一等函数（Math.max）⇒ 定抛 TypeError	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
getter through a computed variable key resolves	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
plain literal key resolves	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶上不可配置自有属性 + 陷阱返 false ⇒ 定抛 TypeError（改前：false，不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
负控：同一陷阱 + 靶上该键**可配置** ⇒ 不抛，值 false（缺口只在这一格）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
负控：靶上**没有**该键 + 陷阱返 false ⇒ 不抛，值 false	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
负控：陷阱返 true ⇒ 不触发不变式（该门只对 falsy 生效）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
toUpperCase.call(1) = '1'（原生 generic；此前定抛 TypeError）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
trim / charAt / at / concat 借用给数字接收者 = 原生值	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
品牌方法仍要品牌（toString / valueOf.call(1) → TypeError）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
nullish 接收者仍定抛（RequireObjectCoercible）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
其它家族的品牌检查不受影响（Number.toFixed.call('s') → TypeError）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
直接字符串方法不受影响（'abc'.toUpperCase() = 'ABC'）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
literal symbol key reads back	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
computed symbol assignment reads back	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
own symbol keys are counted	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
toString.call({name:'X', message:'y'}) = 'X: y'（原生；此前定抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
toString.call({}) = 'Error'（缺省名）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
toString.call({name:'X'}) = 'X'（空消息只回名）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
空名只回消息（toString.call({name:'',message:'y'}) = 'y'）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
TypeError.prototype.toString 同口径（'X: y'）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Error 实例沿既有 brand 面（'Error: m'，不回归）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
原始值接收者原生定抛 TypeError（this 必须是对象）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
"a" in Object.create({a:1}) 折 exact true（HasProperty 口径）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
自有键面不得见继承槽（Object.keys/values/entries/for-in）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
值面维持保守 unknown（只承诺存在性，不冒充确定值）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：自有属性对象行为不变	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
门禁面：f(Object.create({a:1})) 不再报 missing field（与三个导出产物同结论）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
门禁面负控制：真缺字段仍报 missing field（不得整面放水）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
null 原型分支不受影响（Object.create(null) 无继承槽）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶是普通对象 → throws TypeError（此前 unknown + never）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶是数组 → throws TypeError	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶是类值 → throws TypeError（类构造器不带 new 被调）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶不可调用 → apply 陷阱**不派发**（原生同口径）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
控制组：可调用靶的代理调用正常（不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
控制组：代理的读面正常（get 陷阱不受影响）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无 apply 陷阱 → 回退靶的 [[Call]]（此前恒 unknown）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
apply 陷阱 → 派发并取其返回值	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
apply 陷阱副作用保留（此前陷阱从未被调用）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
apply 陷阱实参口径：(target, thisArg, args)	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
控制组：get 陷阱仍照旧派发（本次只加 apply 面）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
类实例：描述符映射的键集 = 自有键集（改前 []）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
类实例：键集与 gOPN / gOPD(单数) 三面一致（引擎内部不再互斥）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
描述符内容精确：类字段是 writable/enumerable/configurable 全真的数据属性	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
内建 brand（Error 家族）：键集 = 自有键集（stack/message，name 是原型链槽）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
内建 brand（Map + m.foo）：键集 = 用户新增自有键	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
单变量对照组 A：普通对象（引擎 == 宿主）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
单变量对照组 B：数组（索引 + length）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
单变量对照组 C：不可枚举自有键在描述符映射里照列（gOPDs 是全部自有键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
兜底路径诚实降级：键集不可判时不折 exact 空元组	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 false 而靶可扩展 → TypeError（此前恒折 true）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱报 true 而靶可扩展 → true（陷阱被调用，副作用保留）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶已不可扩展：陷阱报 false → false（不变量一致，不抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
靶已不可扩展：陷阱报 true → TypeError（不变量冲突）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱副作用保留（此前陷阱从未被调用）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无陷阱 → 回退靶语义（控制组）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
控制组：普通对象 → true；不可扩展普通对象 → false	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱内抛出的 TypeError 透出（throws 面）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
可扩展性不变量冲突 → throws 面是 TypeError（此前恒折 true、不记抛）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱结果非布尔 → ToBoolean（1 折 true）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.preventExtensions(proxy) 之后 → false（原生冻结的是**靶**）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
Object.freeze(proxy) 之后 → false（原生冻结的是**靶**）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
preventExtensions 陷阱自己冻结靶 → 陷阱报 false 与靶一致 → false	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱返回不在靶上的键 → 0 次（此前枚举靶的 2 个键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱返回不在靶上的键 → 键序列为空（此前 "ac"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱部分命中 → 只枚举可枚举的命中键	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱全命中 → 键序按陷阱结果（原生不重排整数键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无 ownKeys 陷阱 → 落靶语义（控制组）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱返回重复键 → 原生抛 TypeError（规范不变量）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱漏掉靶的不可配置自有键 → 原生抛 TypeError（规范不变量）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
控制组：普通对象的 for…in 不受影响	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD 陷阱把键报成不可枚举 → 不进 for…in	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
gOPD 陷阱把靶上没有的键报成可枚举 → 进 for…in	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
陷阱返回重复键 → throws 面是 TypeError（此前静默枚举靶的键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
原生 oracle：可克隆形态不抛 / 不可克隆形态抛 DataCloneError	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
L2 门禁：可克隆形态零 L2（原口径：一条 may throw TypeError 假红）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
L2 门禁：不可克隆形态一条 L2（kind = DataCloneError）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
契约面：`@nudo:throws DataCloneError` 能申报（原先写不出正确的 kind）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
无约束实参（any）：仍诚实记 may-throw，但 kind 是 DataCloneError	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
try-catch 消化：native 返回 "caught"，引擎同口径（不再假绿）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照组：非 structuredClone 的宿主全局仍走原保守口径（parseInt(Symbol) 定抛 TypeError）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
原型链 key 不进字段表（constructor / toString / valueOf …）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
字段表里的每个条目都是真字段（带 constraint）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
原型链 key 不得让契约崩溃（entry Abs / 实例化面）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
合法 key 仍然取到字段	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
shape(42) 抛 Nudo 原生诊断（点名构造器 + 实际类型）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
shape(null) / shape([]) / shape("x") 同样被拒	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
正常实参不受影响	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
产品面：shape(42) 的侧车契约不再静默退化成空 shape	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
`o[{}] = 1` 的键为 "[object Object]" ⇒ 写落地（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
`o[k] = 1`（k 有 toString）⇒ 键为 toString 的结果（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
类实例接收者同样落地（native："number"）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
读面：对象键读到对应的槽值（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
写面：键的 toString 被调一次（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
读面：键的 toString 被调一次（native：1）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
`Object.setPrototypeOf(Object.prototype, {})` ⇒ 抛 TypeError（native：同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
设为自身原型同样拒绝（native：同款）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
`Object.setPrototypeOf(Array.prototype, {})` 不抛（native：可改）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
`Reflect.setPrototypeOf(Array.prototype, {})` 返 true（native：true）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
渲染层第二道防线：formatObjectKey 把 `__proto__` 写成计算键（不是裸键）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
core 投影层：字段表原型为 null（原型 setter 不会吞掉赋值）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
core 投影层：`__proto__` 是自有键（`Object.hasOwn` 为真，键没被吞）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
对照：普通键同样投影成自有键（口径一致）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
display / detail / abs 三字段都不含内部 id	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
人类面 --verbose 同样不得含内部 id	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
机器面 display 与人类面签名行同源（口径一致）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
detail 首行仍是函数名（Bug 377 的「不得串号」契约不回归）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
同内容不同路径 ⇒ 载荷逐字相同（不再随参数列表位置漂移）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
非内部 id 的 term 段仍在（verbose 明细不丢信息 —— D2 契约）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
不带内部 id 的签名：term / pred 证据仍在（契约面不被无谓收紧）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
内部计数器 id 换成稳定名（谓词证据不丢）	dup:algebra-object-runtime 聚合矩阵	commit:6e96354b
```
