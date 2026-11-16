# packages/core/src/algebra/__tests__/algebra-eval-builtins.test.ts

模块套件：求值面：内置对象/容器/字符串。

审计：339 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
prim 接收者：别名的方法值读是 function（原生同）；原型对象面：String.prototype.<别名> 值读是 function（原生同）；调用面别修坏：别名 ≡ trimStart / trimEnd（原生同）；负控：表外名字仍折 exact undefined（没把整张表改成全放行）；may-throw 通道：String.prototype.<别名>.call(s) 不再记 TypeError（L2 假红消失）；表与宿主同名集同源（node 实测对拍，防	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
has:()=>0 → false（此前折「有」）；has:()=>1 → true；has:()=>"" → false（此前折「有」）；has:()=>null → false；has:()=>[] → true（对象恒真）；负控制：has:()=>true → true；负控制：无 has 陷阱 → 回退靶语义（普通对象缺席 → false）；Proxy set 陷阱返回 falsy 非 false（0/""/null/undefined）→ strict TypeEr	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Reflect.get(冻结靶代理, 'a') → TypeError（此前折 2 且声称不抛）；冻结靶 + 陷阱返回**实际值** → 正常返回 1；冻结靶 + 读**非自有**键 → 不抛（不变量只管自有属性）；仅不可写（configurable:true）→ 不抛；仅不可配置（writable:true）→ 不抛；密封靶（不可配置但可写）→ 不抛；负控制：普通冻结对象读 → 1（不涉及 Proxy）；负控制：可扩展靶 + get 陷阱 → 2（无 [[Get]] 约束）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
ownKeys 陷阱结果含重复名 → TypeError（此前折 'a,a'）；不可扩展靶 + 陷阱漏掉其自有键 → TypeError（此前折 'b'）；不可扩展靶 + 陷阱**多出**靶没有的键 → TypeError（此前折 'a,b'）；可扩展靶 + 陷阱漏掉其**不可配置**自有键 → TypeError（此前折 ''）；ownKeys 陷阱结果含非字符串键 → TypeError；ownKeys 陷阱返回非对象 → TypeError；gOPN 走 ownKeys	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
命名空间对象的 Symbol.toStringTag 是原生标签；标签面：Object.prototype.toString.call(命名空间) → [object X]；负控制：字面量串键 "@@toStringTag" 仍是字符串键（不被当成 symbol）；负控制：普通对象无 Symbol.toStringTag（标签仍是 [object Object]）；负控制：函数值的标签面不变	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
a.length = undefined → RangeError；a.length = {} → RangeError；a.length = "abc" → RangeError；负控制：a.length = 1 → length = 1；负控制：a.length = "2" → length = 2（ToNumber 合法）；负控制：a.length = null → length = 0；负控制：a.length = true → length = 1；负控制：a.le	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
负下标写后读回不是 exact undefined（改前是）；非整数下标写后读回不是 exact undefined；负控制：闭元组（无 expando 写）的非下标读仍是 exact undefined；负控制：元组的规范下标读仍是元素值；负控制：字符串键 expando 路径的既有口径（unknown）不变	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
[...new String("ab")] → ["a","b"]（原生不抛）；for-of 遍历 String 包装对象 → 字符序列；String 包装对象展开：不记 TypeError（L2 门禁不再假红）；负控制：[...new Number(1)] 仍定抛 TypeError（不得一起放开）；负控制：[...new Boolean(true)] 仍定抛 TypeError；负控制：原始字符串仍可迭代；负控制：原始 number 仍不可迭代；负控制：Map / Set	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
new Intl.Collator('en') 的 brand 名不是内部伪名；new Intl.ListFormat('en') / new Intl.Locale('en') 的 brand 名不是内部伪名；负控制：已建模的 Intl 子构造器保留其 brand 名（Intl.NumberFormat）；负控制：未建模子构造器的**调用**形（Intl.Collator('en')）折 unknown（台账：接受 unknown）；负控制：用户类的实例 brand 仍是用	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object.keys({a:1, [Symbol.toStringTag]:2}) → ["a"]（symbol 键不进 keys）；for-in {a:1, [Symbol.toStringTag]:2} → 只得 "a"（原生：["a"]）；Object.getOwnPropertyNames({a:1, [Symbol.toStringTag]:2}) → ["a"]；Object.getOwnPropertyDescriptors({a:1, [Symbol.toS	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
真 symbol 键仍被命中：o[Symbol.toStringTag] 读到 2 且 Symbol.toStringTag in o 为真；字面量字符串键 "@@toStringTag" 不是 symbol 键：照常枚举（不被误剔）；无 symbol 键的普通对象：各枚举面照常（不回归）；Reflect.ownKeys 仍是**字符串 + symbol** 双族视图（不是只剩字符串）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
class A{} → for (const k in A.prototype) 是**空**（原生 []；改前引擎给 ["constructor"]）；for (const k in Object.prototype) 是**空**（原生 []；改前引擎给 ["constructor"]）；(function(){}).prototype 的 for-in 是**空**（原生 []；改前引擎给 ["constructor"]）；class A{ m(){} } → for	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object.getOwnPropertyNames(A.prototype) 精确 ["constructor"]（原生 ["constructor"]）；函数原型：Object.getOwnPropertyNames((function(){}).prototype) → 精确 ["constructor"]（原生同款）；原生描述符口径：函数原型的 constructor 描述符 enumerable 为 false	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object.keys(Object.assign({}, o))：只含字符串键 "a"（改前含伪键 "@@toStringTag"）；Object.values(Object.assign({}, o))：只含字符串键的值（改前含 2）；Object.entries(Object.assign({}, o))：只含字符串键的条目（改前含 "@@toStringTag:2"）；JSON.stringify(Object.assign({}, o))：不发布伪键（改前含 "@@	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
源对象自身的字符串键枚举面不变：Object.keys/values/entries/JSON.stringify；spread / 对象 rest 仍**拷贝** symbol 键（原生同款：node 实测 rest 也拷）；无 symbol 键的普通对象：assign / 枚举面照常；字面量字符串键 "@@toStringTag" 不是 symbol 键：照常枚举（不被误剔）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
enumOwnKeys = CopyDataProperties 视图（含 symbol 键——spread/assign 拷贝链要它）；enumOwnStringKeys = 字符串键视图（剔除 symbol 投影槽——for-in / keys 家族要它）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
setUTCFullYear / setUTCMonth / setUTCDate → ISO 更新；setUTCHours / setUTCMinutes / setUTCSeconds / setUTCMilliseconds → ISO 更新；setTime → time value 回写（ISO 同步）；MakeDay 归一化：1 月 31 日 setUTCMonth(1) → 3 月 2 日（原生口径）；多实参形态：setUTCFullYear(y, m, d) /	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
reviver 调用次数 = 节点数（node: 3）；标量文本：根键一次（node: 1）；键序 = 后序深度优先（node: "b;a;;"）；function 表达式 reviver 同样被调用（node: 2）；this 绑定 = holder（原生 typeof this === "object"）；reviver 抛错原样传播（原生抛原异常——不是 SyntaxError）；reviver 抛错不被降级成 SyntaxError（负控制：解析失败仍是 Syntax	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
第 4 实参 receiver：写落在 receiver，target 不变；第 4 实参 receiver：target 无自有键 ⇒ receiver 建自有键，target 不变；receiver 自有访问器属性 → 写门失败返 false（原生不抛、不改写）；缺省 receiver ≡ target：写在 target 上；Proxy set 陷阱返 false / 0 → Reflect.set 返 false（改前定抛 TypeError）；Proxy set 陷	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
"%s → RangeError"	表驱动用例：%s → RangeError；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"构造期 RangeError 进 throws 域（此前 throws=never 假 total）"	"回归：new <TypedArray>(buffer) 缺省长度——「buffer 剩余字节数须为 元素大小整数倍」的 RangeError 检查。 原生 AllocateTypedArrayBuffer（node v26 实测）： new Int32Array(new ArrayBuffer(6)) → RangeError（byte length 须是 4 的倍数） new Float64Array(new ArrayBuffer(9)) → RangeError new Int16Array(new ArrayBuffer(3)) → RangeError new Int32Array(new ArrayBuffer(9),"	没测该层	keep	keep	—
"%s"	表驱动用例：%s；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"%s"	同名表行在多处 describe 重复；逐处保留审计记录。	夹具漏形态	keep	keep	—
显式 byteLength 臂不查整除（原生同：new Int32Array(buf6, 0, 1) → 1）；offset 对齐档先于整除档（原生报错序：Int32(buf6, 2) → 偏移未对齐）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
抽象 buffer byteLength（缺省长度臂整除不可判）→ may RangeError；抽象 buffer byteLength + 显式长度 → may RangeError（既有越界档）；定抛臂进 L2（entry-may-throw 记账）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
"%s → TypeError"	表驱动用例：%s → TypeError；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"跨内容类型 set 进 throws 域（此前 throws=never 假 total）"	"回归：%TypedArray%.prototype.set 缺「源/目标**内容类型**（number vs bigint）一致」校验。 原生（node v26 实测）： new Uint8Array(2).set(new BigInt64Array(1)) → TypeError （Cannot mix BigInt and other types, use explicit conversions） new BigInt64Array(2).set(new Uint8Array(1)) → TypeError 规范约束的是**内容类型**（[[ContentType]] number/bigint）而**不是家族名**： new"	没测该层	keep	keep	—
"%s → no-throw"	表驱动用例：%s → no-throw；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"%s → no-throw"	同名表行在另一 describe 中重复出现；逐处保留审计记录。	夹具漏形态	keep	keep	—
非 TA 源（数组/字符串）不受内容类型校验影响；越界档优先于内容类型档（原生报错序：u8.set(bi64(1), 2) → RangeError）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
跨内容类型 set 进 L2（entry-may-throw 记账）；抽象源（any）→ may TypeError（不误报定抛）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
"逐元素转换错误进 throws 域（此前 throws=never 假 total）"	"回归：%TypedArray%.prototype.set 缺**逐元素 ToNumber / ToBigInt** 转换校验。 原生（node v26 实测）： new Uint8Array(2).set([1n]) → TypeError（Cannot convert a BigInt value to a number） new BigInt64Array(2).set([1]) → TypeError（Invalid argument type in ToBigInt operation） new BigInt64Array(2).set([1.5]) → TypeError new BigInt64Array(2).set"	没测该层	keep	keep	—
字符串源：number 域不抛（ToNumber(字符) 恒 NaN→0）；越界档优先于元素转换档（原生报错序：u8.set([1n,2n,3n]) → RangeError）；既有 Bug 38 档不回退：BigInt 家族越界 RangeError / nullish 源 TypeError	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
逐元素转换错误进 L2（entry-may-throw 记账）；抽象元素 → may TypeError（不误报定抛）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
gOPN：列出自有 lastIndex（改前折空元组）；gOPN：全局正则同样列 lastIndex（改前折空元组）；gOPD：lastIndex 折可写的数据描述符（改前读 .writable 定抛 TypeError）；负控制：Object.keys 仍为空（lastIndex 非可枚举）；负控制：Map / Set 的 gOPN 仍为空（无自有键）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
new URL(u).searchParams.get("a") → 精确 "1"（修前：确定抛 TypeError ⇒ 折 never）；new URL(u).searchParams 是 URLSearchParams 品牌（不再是 undefined）；typeof new URL(u).searchParams → "object"（原生同款；修前是 "undefined"）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
new URL(u).href → "https://x/?a=1"；new URL(u).search → "?a=1"；new URL(u).origin → "https://x"（相邻组件槽不回归）；非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
自定义 toString 的值透传（改前折 "[object Object]"）；自定义 toString 的抛错透传（改前被吞成标签）；成员调用面同样委派（o.toLocaleString() === o.toString()）；null 原型接收者 ⇒ TypeError（改前 no-throw / 折 unknown）；数组接收者 ⇒ Array.prototype.toString 的值（原生 "1,2"）；数字接收者 ⇒ Number.prototype.toStr	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
options 无 cause 键 ⇒ 无自有 cause 槽（hasOwnProperty false）；options 无 cause 键 ⇒ "cause" in e 恒 false（$in 走槽存在性）；options 无 cause 键 ⇒ e.cause 读出 undefined（缺席槽）；Object.hasOwn：无 cause 键 ⇒ false；options 有 cause 键 ⇒ 装槽（自有、值精确）；cause 键存在但值为 undefined ⇒	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
e.errors !== 入参（原生 false；修前折 true）；入参后续变更不改写 e.errors（原生 length 不变）；拷贝内容与入参一致（长度 / 下标 / join / isArray）；同一实例的 errors 恒等；两次构造互不等（两个独立列表）；errors 槽仍是自有不可枚举数据属性（gOPD 描述符不变）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
new Date(NaN).toJSON() → null（原生口径）；toJSON() === null → true（修复前折确定的 false）；String(new Date(NaN).toJSON()) → "null"；有效日期的 toJSON → ISO 串（原生口径）；负控制：JSON.stringify 投影面不变（Invalid → "null"，有效 → ISO 串）；负控制：toISOString 对非法日期仍确定抛 RangeError（toJSON	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
length 被截断（原生 1 / [1]，改前 3 / [1,2,3]）；length 被延长（原生 5）；返回值是 true（原生同款）；下标写不受影响（负控制）；直接赋值 length 仍可用（负控制）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
get(name) 命中 → 精确值（原生 "1"）；get(name) 未命中 → null（原生 null，**不是** undefined）；getAll(name) → 全部匹配值（原生 ["1","2"]）；has(name) → 命中 true / 未命中 false（原生同款）；size 是 **getter**（原生 2，条目数）；toString() → 查询串（原生 "a=1&b=2"）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
字符串 init → 查询串解析（原生 get("b") === "2"）；init 缺席 → 空表（原生 size === 0）；二元组 tuple init → 逐条精确（原生 get("a") === "1"）；record init → 槽值为字符串字面量时精确（原生 get("a") === "1"）；数字 / 布尔字面量 init → 按查询串解析（原生 "5=" / "true="）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
append 追加一条（同键不去重）→ toString 原生 "a=1&b=2&b=2"；set 替换全部同键条目 → getAll("a") 原生 ["9"]；delete 返 **undefined**（原生 undefined，**不是** boolean）；delete 真的移除条目（原生 get("a") === null、size === 1）；set / append 返 undefined（原生同款）；sort 按名排序（原生 "a=1&b=2"）；keys	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
URL 的其它组件槽不变（href / search）；非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）；条目表不可知时**不假精确**（抽象 init → unknown 域，且不抛）；抽象 URL 的 searchParams 条目表同样不可知（unknown 域，不抛）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
new URL(u).searchParams.get("a")：不再是 never（改前确定抛 TypeError ⇒ 折 never）；new URL(u).searchParams.get("a")：值口径精确 "1"（条目表已建模——原生同值）；typeof new URL(u).searchParams === "object"（原生同款；改前是 "undefined"）；new URL(u).searchParams.has("a")：不再是 never（同款假抛	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
URL 其它组件槽不变：href / protocol / search / toString；new URLSearchParams("a=1").get("a")：条目表已建模 ⇒ 精确 "1"（原生同值）；new URLSearchParams("a=1").get 是函数（品牌方法名集仍生效）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object.groupBy 的 keys 不再折 exact 空元组（改前折 []）；Object.groupBy 的 values / entries 同样不再折 exact 空元组；组键可判时（字面量键）仍折精确键集（原生 keys === ["a"]）；负控制：普通对象的 keys/values/entries 仍精确；负控制：Object.create(<obj>) 的自有键集确为空 ⇒ 仍精确折 []（Bug 41 pin）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Promise 对象 → {}（原生 '{"p":{}}'，不抛）；Map 实例 → {}（原生 '{"m":{}}'，不抛）；Date 实例 → ISO 串（原生 '{"d":"1970-01-01T00:00:00.000Z"}'）；生成器对象 → {}（原生 '{"g":{}}'，不抛）；eff 臂不记 may-throw（产品面 L1/L2 假红消失）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
★ 构造器 brand 作 replacer → 抛 TypeError（原生 'Constructor Map requires new'）；★ brand **实例**作 replacer → 不抛（原生 '{"a":1}'）；eff 作 replacer → 不抛（原生 '{"a":1}'）；普通对象作 replacer → 不抛（原生 '{"a":1}'）；brand 实例 / eff 作 replacer 不记 may-throw（负控制：构造器 brand 仍记）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
可调用 replacer 仍逐键生效（原生同款）；普通对象 / 数组序列化不回归（原生 '{"a":1,"b":[1,2]}'）；用户 toJSON 面仍不可折（仍记 may-throw）；BigInt 元素家族仍记 may-throw TypeError（原生定抛，不在 total 集）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
嵌套 Date → 精确折叠（node: {"when":"1970-01-01T00:00:00.000Z"}）；嵌套 Map / Set / RegExp / Error → {}（node）；装箱 prim → 拆箱后的原始值（node: {"s":"ab"}）；嵌套 brand 不再记 may-throw（负控制：BigInt 元素家族仍记）；嵌套 brand 的入口不记 may-throw（产品面 L2 假红消失）；深层嵌套（数组 / 多层对象）同样折叠（node）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
String(new Date(0))：不抛 + 值域是 string（原生给日期串，不抛）；String(new Map())：不抛 + 值域是 string（原生 "[object Map]"，不抛）；String({})：不抛 + 值域是 string（原生 "[object Object]"，不抛）；模板串 `${new Date(0)}`：与 String() 同口径——不抛 + 值域是 string	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
String(new Date(0)) 与模板串**同样不抛**（修前：String 记 may-throw、模板串判 OK）；String(123) → 精确 "123"（原始值路径的精确面不回归）；String(new Error("x"))：不抛 + 值域是 string（Error 品牌同样不抛）；String(null) → 精确 "null"、String(undefined) → 精确 "undefined"（原始值面）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
typeof new Intl.Collator() → "object"（原生同款）；new Intl.Collator() 是 Intl.Collator 品牌实例（不是 undefined / 伪名）；new Intl.Collator().name → undefined（**实例**没有 name 属性——报告的 "Collator" 是勘误）；new Intl.Collator("en").name → undefined（带 locale 参数同款）；typeo	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Intl.NumberFormat.name → "NumberFormat"（已建模子构造器：原生同款）；Intl.DateTimeFormat.name → "DateTimeFormat"（已建模子构造器：原生同款）；Intl.Collator.name → "Collator"（原生同款：非限定名）；Intl.Locale.name → "Locale"（原生同款：非限定名）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
typeof new Intl.Collator().compare → "function"（族 65 第 4 条已建模）；new Intl.Collator().compare("a", "b")：不抛（原生返回 -1 / 1，不抛）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
派生类 Set：add 后 size 是精确值（原生 1）；派生类 Map：set 后 size 是精确值（原生 1）；派生类 Set：has 走条目表（原生 true）；负控：基础 Set / Map 的 size 仍是精确值（原生 2 / 1）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
函数声明的 constructor === Function（原生 true）；函数声明的 constructor.name === "Function"（原生 "Function"）；生成器声明的 constructor.name === "GeneratorFunction"（原生同款）；async 声明的 constructor.name === "AsyncFunction"（原生同款）；Number.constructor === Function（原生 true）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object(Symbol('x')).toString() → "Symbol(x)"；Object(5).valueOf() → 5；Object(5).constructor === Number（原生 true）；包装 brand 的同名成员带 brand check：Object(Symbol('x')).toString.call(1) → TypeError；负控：Object.prototype.toString 的泛型面不受影响	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
has 陷阱返回 0 → false（原生 false）；has 陷阱返回 "" → false（原生 false）；has 陷阱返回 [] → true（对象恒真，原生 true）；set 陷阱返回 falsy → strict TypeError（原生 strict 同款）；负控：无 has 陷阱 → 回退靶语义（原生 false）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Object.keys 走 ownKeys 陷阱（原生 ["a","b"]）；Reflect.ownKeys 走 ownKeys 陷阱（原生 ["a","b"]）；ownKeys 返靶外键 → Object.keys 按可枚举性过滤（原生 []）；负控：无 ownKeys 陷阱 → Object.keys 走靶面（原生 ["a","b"]）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
用户符号键写后可回读（原生 1）；用户符号键写字符串值可回读（原生 "v"）；运行时 well-known 符号键写后可回读（原生 1）；两个不同用户符号互不串键（原生 "b"）；符号槽不落字符串枚举面（原生 ["k"]）；负控：字符串键读写逐字不变（原生 1）；负控：Proxy get 陷阱仍收到**真 symbol**（原生 "symbol"，不走槽寻址）；负控：Proxy get 陷阱收到 well-known 符号（原生 "symbol"）；负控：数组下标读写逐字不变	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
for-of 取迭代序而非索引序（原生 ["I0","I1"]）；解构取迭代序而非索引序（原生 ["I0","I1"]）；spread 取迭代序而非索引序（原生 ["I0","I1"]）；负控：纯用户 iterable 逐字不变（原生 ["I0","I1"]）；负控：Set 的 for-of 逐字不变（原生 ["A","B"]）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
mk().x += 2 折 3（原生 3）——exec/transpile/expr/assignment.ts「根不可重绑」分支补回 compoundFn；计算键同款：mk()[k] += 2 折 3（原生 3）；负控：可重绑根的复合赋值逐字不变（原生 3）；负控：可重绑根的复合赋值读回（原生 3）	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
"Symbol 键的对象不会被误判成抛错面"	"逐条对应（族 57 台账）： 1. `s.size` 精确值（派生类 brand）——✅ 已是原生（闭合点： exec/class/super.ts 的 $super「不重铸 Abs」——W9 并发落盘） 2. 宿主函数面 / 命名空间面的 `constructor`——✅ 已修（本片） 3. 包装 brand（Object(5) / Object(Symbol(\"x\"))）的成员面——✅ 已是原生 4. Proxy `has` / `set` 陷阱返回值 ToBoolean 归一——✅ 已是原生 5. Proxy `ownKeys` 陷阱派发通道——✅ 已是原生 6. 外-02 符号键槽寻址（普通对象面）——① 读写 ✅ 已修（本"	夹具漏形态	keep	keep	—
Math.min(x,0) > 0：x>0 时原生恒 "nonpos"（改前折 "pos" 且 conf: exact）；Math.max(x,0) < 0：x<0 时原生恒 "nonneg"（改前折 "neg"）；Math.min(x,0) < 0：x>0 时原生恒 "nonneg"（区间下界不再是 > 0 的矛盾谓词）；Math.max(x,0) > 0：x<0 时原生恒 "nonpos"（区间上界不再是 < 0 的矛盾谓词）；L1 返回契约门禁：Math.min(x,0	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
Math.min(x,1) > 0：x>0 时原生恒 "pos"；Math.max(x,-1) > 0：x>0 时原生恒 "pos"（max 的析取位语义不变）；Math.max(x,0) < 0：x<0 时原生恒 "nonneg"（与 min 臂对称）；字面量折叠路径不变：Math.min(3,5)=3 / Math.max(3,5)=5；round / abs 不走区间合并路径，结果不变	algebra-eval-builtins 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
prim 接收者：别名的方法值读是 function（原生同）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
原型对象面：String.prototype.<别名> 值读是 function（原生同）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
调用面别修坏：别名 ≡ trimStart / trimEnd（原生同）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：表外名字仍折 exact undefined（没把整张表改成全放行）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
may-throw 通道：String.prototype.<别名>.call(s) 不再记 TypeError（L2 假红消失）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
表与宿主同名集同源（node 实测对拍，防「派发面认识、读面不认识」再次分裂）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has:()=>0 → false（此前折「有」）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has:()=>1 → true	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has:()=>"" → false（此前折「有」）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has:()=>null → false	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has:()=>[] → true（对象恒真）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：has:()=>true → true	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：无 has 陷阱 → 回退靶语义（普通对象缺席 → false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Proxy set 陷阱返回 falsy 非 false（0/""/null/undefined）→ strict TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：set 陷阱返回 truthy（true/1）→ 不抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Reflect.get(冻结靶代理, 'a') → TypeError（此前折 2 且声称不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
冻结靶 + 陷阱返回**实际值** → 正常返回 1	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
冻结靶 + 读**非自有**键 → 不抛（不变量只管自有属性）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
仅不可写（configurable:true）→ 不抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
仅不可配置（writable:true）→ 不抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
密封靶（不可配置但可写）→ 不抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通冻结对象读 → 1（不涉及 Proxy）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：可扩展靶 + get 陷阱 → 2（无 [[Get]] 约束）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
成员读面 p.a（冻结靶 + get 陷阱）→ TypeError（containers/member.ts 的 Proxy get 臂过 enforceProxyGetInvariant）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
成员读面 p.a（冻结靶 + 陷阱返回实际值）→ 1（不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
成员读面 p.a（仅不可写，configurable:true）→ 2（不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
成员读面 p.a（可扩展靶 + get 陷阱）→ 2（无 [[Get]] 约束）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱结果含重复名 → TypeError（此前折 'a,a'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
不可扩展靶 + 陷阱漏掉其自有键 → TypeError（此前折 'b'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
不可扩展靶 + 陷阱**多出**靶没有的键 → TypeError（此前折 'a,b'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
可扩展靶 + 陷阱漏掉其**不可配置**自有键 → TypeError（此前折 ''）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱结果含非字符串键 → TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱返回非对象 → TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPN 走 ownKeys 陷阱：重复名同样定抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱正常派发：Reflect.ownKeys 折陷阱结果	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱正常派发：Object.keys 按靶的可枚举性过滤	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 陷阱正常派发：gOPN 只取字符串键	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
无 ownKeys 陷阱 → 转发靶的自有键面（Reflect.ownKeys / keys / gOPN）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通对象的 Reflect.ownKeys / keys 不受牵连	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
命名空间对象的 Symbol.toStringTag 是原生标签	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
标签面：Object.prototype.toString.call(命名空间) → [object X]	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：字面量串键 "@@toStringTag" 仍是字符串键（不被当成 symbol）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通对象无 Symbol.toStringTag（标签仍是 [object Object]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：函数值的标签面不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
a.length = undefined → RangeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
a.length = {} → RangeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
a.length = "abc" → RangeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = 1 → length = 1	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = "2" → length = 2（ToNumber 合法）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = null → length = 0	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = true → length = 1	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = [] → length = 0（ToNumber([]) 合法）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = 1.7 → RangeError（既有正确）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：a.length = -1 → RangeError（既有正确）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负下标写后读回不是 exact undefined（改前是）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
非整数下标写后读回不是 exact undefined	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：闭元组（无 expando 写）的非下标读仍是 exact undefined	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：元组的规范下标读仍是元素值	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：字符串键 expando 路径的既有口径（unknown）不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
[...new String("ab")] → ["a","b"]（原生不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
for-of 遍历 String 包装对象 → 字符序列	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String 包装对象展开：不记 TypeError（L2 门禁不再假红）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：[...new Number(1)] 仍定抛 TypeError（不得一起放开）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：[...new Boolean(true)] 仍定抛 TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：原始字符串仍可迭代	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：原始 number 仍不可迭代	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Map / Set 包装对象仍按内建可迭代面展开	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.Collator('en') 的 brand 名不是内部伪名	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.ListFormat('en') / new Intl.Locale('en') 的 brand 名不是内部伪名	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：已建模的 Intl 子构造器保留其 brand 名（Intl.NumberFormat）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：未建模子构造器的**调用**形（Intl.Collator('en')）折 unknown（台账：接受 unknown）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：用户类的实例 brand 仍是用户类名（不得被伪名/降级污染）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.keys({a:1, [Symbol.toStringTag]:2}) → ["a"]（symbol 键不进 keys）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
for-in {a:1, [Symbol.toStringTag]:2} → 只得 "a"（原生：["a"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.getOwnPropertyNames({a:1, [Symbol.toStringTag]:2}) → ["a"]	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.getOwnPropertyDescriptors({a:1, [Symbol.toStringTag]:2}) → 字符串键面只有 a；自有键面含 symbol 键（Bug 1075）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Reflect.ownKeys({a:1, [Symbol.toStringTag]:2}) → 长度 2；[0] 是字符串 "a"；[1] typeof 是 "symbol"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
"@@toStringTag" in o → false；Symbol.toStringTag in o → true（字符串键不误命中 symbol 槽）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.assign(A.prototype, {a:1, [Symbol.toStringTag]:2}) → A.prototype 的 for-in **不含** "@@toStringTag"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
JSON.stringify({a:1, [Symbol.toStringTag]:2}) → '{"a":1}'（symbol 键不进 JSON 面）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
真 symbol 键仍被命中：o[Symbol.toStringTag] 读到 2 且 Symbol.toStringTag in o 为真	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
字面量字符串键 "@@toStringTag" 不是 symbol 键：照常枚举（不被误剔）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
无 symbol 键的普通对象：各枚举面照常（不回归）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Reflect.ownKeys 仍是**字符串 + symbol** 双族视图（不是只剩字符串）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
class A{} → for (const k in A.prototype) 是**空**（原生 []；改前引擎给 ["constructor"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
for (const k in Object.prototype) 是**空**（原生 []；改前引擎给 ["constructor"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
(function(){}).prototype 的 for-in 是**空**（原生 []；改前引擎给 ["constructor"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
class A{ m(){} } → for (const k in A.prototype) 是**空**（类方法本身也不可枚举）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
class A{} → new A() 实例的 for-in 是**空**（实例无自有可枚举键）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
实例的原型面同样为空：for (const k in Object.getPrototypeOf(new A()))	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.getOwnPropertyNames(A.prototype) 精确 ["constructor"]（原生 ["constructor"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
函数原型：Object.getOwnPropertyNames((function(){}).prototype) → 精确 ["constructor"]（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
原生描述符口径：函数原型的 constructor 描述符 enumerable 为 false	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.keys(Object.assign({}, o))：只含字符串键 "a"（改前含伪键 "@@toStringTag"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.values(Object.assign({}, o))：只含字符串键的值（改前含 2）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.entries(Object.assign({}, o))：只含字符串键的条目（改前含 "@@toStringTag:2"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
JSON.stringify(Object.assign({}, o))：不发布伪键（改前含 "@@toStringTag"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.getOwnPropertyNames(Object.assign({}, o))：只含字符串键（改前含伪键）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.assign 仍**拷贝** symbol 键本身：t[Symbol.toStringTag] 读得到 2（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
源对象自身的字符串键枚举面不变：Object.keys/values/entries/JSON.stringify	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
spread / 对象 rest 仍**拷贝** symbol 键（原生同款：node 实测 rest 也拷）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
无 symbol 键的普通对象：assign / 枚举面照常	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
enumOwnKeys = CopyDataProperties 视图（含 symbol 键——spread/assign 拷贝链要它）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
enumOwnStringKeys = 字符串键视图（剔除 symbol 投影槽——for-in / keys 家族要它）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
setUTCFullYear / setUTCMonth / setUTCDate → ISO 更新	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
setUTCHours / setUTCMinutes / setUTCSeconds / setUTCMilliseconds → ISO 更新	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
setTime → time value 回写（ISO 同步）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
MakeDay 归一化：1 月 31 日 setUTCMonth(1) → 3 月 2 日（原生口径）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
多实参形态：setUTCFullYear(y, m, d) / setUTCHours(h, m, s, ms)	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
setter 返回新 time value（number 字面量）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
getTime / valueOf 读同一 time value 槽（与 setter 同步）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
TimeClip 越界 → Invalid Date → toISOString 确定 RangeError（原生口径）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：无 setter 的构造期 ISO 不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：两个实例互不影响（各自 time value）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Symbol / BigInt 实参仍确定 TypeError（Bug 62 口径不回归）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：new Date()（time value 不可知）上的 setter 返回抽象 number 且不记抛	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Date.now() / Date.prototype.setTime 成员面不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
reviver 调用次数 = 节点数（node: 3）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
标量文本：根键一次（node: 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
键序 = 后序深度优先（node: "b;a;;"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
function 表达式 reviver 同样被调用（node: 2）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
this 绑定 = holder（原生 typeof this === "object"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
reviver 抛错原样传播（原生抛原异常——不是 SyntaxError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
reviver 抛错不被降级成 SyntaxError（负控制：解析失败仍是 SyntaxError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：非 callable reviver 原生忽略（结果仍是解析值）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：stringify replacer 侧不回归（仍被调用 3 次）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：parse 的值域仍保守 unknown（逐键变换未建模）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
第 4 实参 receiver：写落在 receiver，target 不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
第 4 实参 receiver：target 无自有键 ⇒ receiver 建自有键，target 不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
receiver 自有访问器属性 → 写门失败返 false（原生不抛、不改写）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
缺省 receiver ≡ target：写在 target 上	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Proxy set 陷阱返 false / 0 → Reflect.set 返 false（改前定抛 TypeError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Proxy set 陷阱返 true → Reflect.set 返 true	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
冻结目标 → 返 false（原生不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
显式 byteLength 臂不查整除（原生同：new Int32Array(buf6, 0, 1) → 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
offset 对齐档先于整除档（原生报错序：Int32(buf6, 2) → 偏移未对齐）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
抽象 buffer byteLength（缺省长度臂整除不可判）→ may RangeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
抽象 buffer byteLength + 显式长度 → may RangeError（既有越界档）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
定抛臂进 L2（entry-may-throw 记账）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
非 TA 源（数组/字符串）不受内容类型校验影响	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
越界档优先于内容类型档（原生报错序：u8.set(bi64(1), 2) → RangeError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
跨内容类型 set 进 L2（entry-may-throw 记账）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
抽象源（any）→ may TypeError（不误报定抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
字符串源：number 域不抛（ToNumber(字符) 恒 NaN→0）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
越界档优先于元素转换档（原生报错序：u8.set([1n,2n,3n]) → RangeError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
既有 Bug 38 档不回退：BigInt 家族越界 RangeError / nullish 源 TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
逐元素转换错误进 L2（entry-may-throw 记账）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
抽象元素 → may TypeError（不误报定抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPN：列出自有 lastIndex（改前折空元组）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPN：全局正则同样列 lastIndex（改前折空元组）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPD：lastIndex 折可写的数据描述符（改前读 .writable 定抛 TypeError）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Object.keys 仍为空（lastIndex 非可枚举）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Map / Set 的 gOPN 仍为空（无自有键）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).searchParams.get("a") → 精确 "1"（修前：确定抛 TypeError ⇒ 折 never）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).searchParams 是 URLSearchParams 品牌（不再是 undefined）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
typeof new URL(u).searchParams → "object"（原生同款；修前是 "undefined"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).href → "https://x/?a=1"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).search → "?a=1"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).origin → "https://x"（相邻组件槽不回归）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
自定义 toString 的值透传（改前折 "[object Object]"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
自定义 toString 的抛错透传（改前被吞成标签）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
成员调用面同样委派（o.toLocaleString() === o.toString()）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
null 原型接收者 ⇒ TypeError（改前 no-throw / 折 unknown）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
数组接收者 ⇒ Array.prototype.toString 的值（原生 "1,2"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
数字接收者 ⇒ Number.prototype.toString 的值（原生 "5"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通对象仍折 "[object Object]"（toString 标签面不变）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Object.prototype.toString 标签面不受影响	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
options 无 cause 键 ⇒ 无自有 cause 槽（hasOwnProperty false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
options 无 cause 键 ⇒ "cause" in e 恒 false（$in 走槽存在性）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
options 无 cause 键 ⇒ e.cause 读出 undefined（缺席槽）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.hasOwn：无 cause 键 ⇒ false	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
options 有 cause 键 ⇒ 装槽（自有、值精确）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
cause 键存在但值为 undefined ⇒ 仍装槽（值为 undefined）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPN：cause 槽缺席 ⇒ 安装序止于 stack→message（原生同）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
gOPD：cause 键缺席 ⇒ 描述符 undefined；存在 ⇒ 数据描述符	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
cause 槽不可枚举（原生非枚举数据属性）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
e.errors !== 入参（原生 false；修前折 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
入参后续变更不改写 e.errors（原生 length 不变）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
拷贝内容与入参一致（长度 / 下标 / join / isArray）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
同一实例的 errors 恒等；两次构造互不等（两个独立列表）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
errors 槽仍是自有不可枚举数据属性（gOPD 描述符不变）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Date(NaN).toJSON() → null（原生口径）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
toJSON() === null → true（修复前折确定的 false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(new Date(NaN).toJSON()) → "null"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
有效日期的 toJSON → ISO 串（原生口径）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：JSON.stringify 投影面不变（Invalid → "null"，有效 → ISO 串）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：toISOString 对非法日期仍确定抛 RangeError（toJSON 不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：抽象 Date（time value 不可知）→ string | null 域（不折确定 false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
length 被截断（原生 1 / [1]，改前 3 / [1,2,3]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
length 被延长（原生 5）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
返回值是 true（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
下标写不受影响（负控制）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
直接赋值 length 仍可用（负控制）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
get(name) 命中 → 精确值（原生 "1"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
get(name) 未命中 → null（原生 null，**不是** undefined）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
getAll(name) → 全部匹配值（原生 ["1","2"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has(name) → 命中 true / 未命中 false（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
size 是 **getter**（原生 2，条目数）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
toString() → 查询串（原生 "a=1&b=2"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
字符串 init → 查询串解析（原生 get("b") === "2"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
init 缺席 → 空表（原生 size === 0）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
二元组 tuple init → 逐条精确（原生 get("a") === "1"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
record init → 槽值为字符串字面量时精确（原生 get("a") === "1"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
数字 / 布尔字面量 init → 按查询串解析（原生 "5=" / "true="）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
append 追加一条（同键不去重）→ toString 原生 "a=1&b=2&b=2"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
set 替换全部同键条目 → getAll("a") 原生 ["9"]	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
delete 返 **undefined**（原生 undefined，**不是** boolean）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
delete 真的移除条目（原生 get("a") === null、size === 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
set / append 返 undefined（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
sort 按名排序（原生 "a=1&b=2"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
keys / values 迭代出条目名 / 条目值（原生 ["a","b"] / ["1","2"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
URL 的其它组件槽不变（href / search）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
条目表不可知时**不假精确**（抽象 init → unknown 域，且不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
抽象 URL 的 searchParams 条目表同样不可知（unknown 域，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).searchParams.get("a")：不再是 never（改前确定抛 TypeError ⇒ 折 never）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).searchParams.get("a")：值口径精确 "1"（条目表已建模——原生同值）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
typeof new URL(u).searchParams === "object"（原生同款；改前是 "undefined"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URL(u).searchParams.has("a")：不再是 never（同款假抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
URL 其它组件槽不变：href / protocol / search / toString	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URLSearchParams("a=1").get("a")：条目表已建模 ⇒ 精确 "1"（原生同值）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new URLSearchParams("a=1").get 是函数（品牌方法名集仍生效）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.groupBy 的 keys 不再折 exact 空元组（改前折 []）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.groupBy 的 values / entries 同样不再折 exact 空元组	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
组键可判时（字面量键）仍折精确键集（原生 keys === ["a"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通对象的 keys/values/entries 仍精确	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：Object.create(<obj>) 的自有键集确为空 ⇒ 仍精确折 []（Bug 41 pin）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Promise 对象 → {}（原生 '{"p":{}}'，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Map 实例 → {}（原生 '{"m":{}}'，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Date 实例 → ISO 串（原生 '{"d":"1970-01-01T00:00:00.000Z"}'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
生成器对象 → {}（原生 '{"g":{}}'，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
eff 臂不记 may-throw（产品面 L1/L2 假红消失）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
★ 构造器 brand 作 replacer → 抛 TypeError（原生 'Constructor Map requires new'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
★ brand **实例**作 replacer → 不抛（原生 '{"a":1}'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
eff 作 replacer → 不抛（原生 '{"a":1}'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
普通对象作 replacer → 不抛（原生 '{"a":1}'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
brand 实例 / eff 作 replacer 不记 may-throw（负控制：构造器 brand 仍记）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
可调用 replacer 仍逐键生效（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
普通对象 / 数组序列化不回归（原生 '{"a":1,"b":[1,2]}'）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
用户 toJSON 面仍不可折（仍记 may-throw）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
BigInt 元素家族仍记 may-throw TypeError（原生定抛，不在 total 集）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
嵌套 Date → 精确折叠（node: {"when":"1970-01-01T00:00:00.000Z"}）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
嵌套 Map / Set / RegExp / Error → {}（node）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
装箱 prim → 拆箱后的原始值（node: {"s":"ab"}）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
嵌套 brand 不再记 may-throw（负控制：BigInt 元素家族仍记）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
嵌套 brand 的入口不记 may-throw（产品面 L2 假红消失）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
深层嵌套（数组 / 多层对象）同样折叠（node）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
URL 嵌套 → href 串（node）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
replacer 路径同款：嵌套 brand 走 toJSON 步（先于 replacer，node）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：顶层 Date 折叠不回归（node）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：TypedArray 家族 total 但值不可知（元素值未建模）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：用户 toJSON 面不折（仍记 may-throw）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控制：普通对象 / 数组序列化不回归	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(new Date(0))：不抛 + 值域是 string（原生给日期串，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(new Map())：不抛 + 值域是 string（原生 "[object Map]"，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String({})：不抛 + 值域是 string（原生 "[object Object]"，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
模板串 `${new Date(0)}`：与 String() 同口径——不抛 + 值域是 string	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(new Date(0)) 与模板串**同样不抛**（修前：String 记 may-throw、模板串判 OK）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(123) → 精确 "123"（原始值路径的精确面不回归）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(new Error("x"))：不抛 + 值域是 string（Error 品牌同样不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
String(null) → 精确 "null"、String(undefined) → 精确 "undefined"（原始值面）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
typeof new Intl.Collator() → "object"（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.Collator() 是 Intl.Collator 品牌实例（不是 undefined / 伪名）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.Collator().name → undefined（**实例**没有 name 属性——报告的 "Collator" 是勘误）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.Collator("en").name → undefined（带 locale 参数同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
typeof Intl.Collator → "function"（构造器面的 typeof 不回归）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Intl.NumberFormat.name → "NumberFormat"（已建模子构造器：原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Intl.DateTimeFormat.name → "DateTimeFormat"（已建模子构造器：原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Intl.Collator.name → "Collator"（原生同款：非限定名）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Intl.Locale.name → "Locale"（原生同款：非限定名）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
typeof new Intl.Collator().compare → "function"（族 65 第 4 条已建模）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
new Intl.Collator().compare("a", "b")：不抛（原生返回 -1 / 1，不抛）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
派生类 Set：add 后 size 是精确值（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
派生类 Map：set 后 size 是精确值（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
派生类 Set：has 走条目表（原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：基础 Set / Map 的 size 仍是精确值（原生 2 / 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
函数声明的 constructor === Function（原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
函数声明的 constructor.name === "Function"（原生 "Function"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
生成器声明的 constructor.name === "GeneratorFunction"（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
async 声明的 constructor.name === "AsyncFunction"（原生同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Number.constructor === Function（原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Number.constructor.name === "Function"（原生 "Function"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.constructor === Object（原生 true）——命名空间是普通对象	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.constructor.name === "Object"（原生 "Object"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：函数声明的 name / length 不受影响	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：类值的 constructor 仍是 Function（原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object(Symbol('x')).toString() → "Symbol(x)"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object(5).valueOf() → 5	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object(5).constructor === Number（原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
包装 brand 的同名成员带 brand check：Object(Symbol('x')).toString.call(1) → TypeError	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：Object.prototype.toString 的泛型面不受影响	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has 陷阱返回 0 → false（原生 false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has 陷阱返回 "" → false（原生 false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
has 陷阱返回 [] → true（对象恒真，原生 true）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
set 陷阱返回 falsy → strict TypeError（原生 strict 同款）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：无 has 陷阱 → 回退靶语义（原生 false）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Object.keys 走 ownKeys 陷阱（原生 ["a","b"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Reflect.ownKeys 走 ownKeys 陷阱（原生 ["a","b"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
ownKeys 返靶外键 → Object.keys 按可枚举性过滤（原生 []）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：无 ownKeys 陷阱 → Object.keys 走靶面（原生 ["a","b"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
用户符号键写后可回读（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
用户符号键写字符串值可回读（原生 "v"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
运行时 well-known 符号键写后可回读（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
两个不同用户符号互不串键（原生 "b"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
符号槽不落字符串枚举面（原生 ["k"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：字符串键读写逐字不变（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：Proxy get 陷阱仍收到**真 symbol**（原生 "symbol"，不走槽寻址）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：Proxy get 陷阱收到 well-known 符号（原生 "symbol"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：数组下标读写逐字不变（原生 1）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
✅ 已修：用户符号的 `in` 折确定 true（原生 true）——修法在 exec/runtime/members.ts（$in，W8 落盘）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
✅ 已修：well-known 符号的 delete 删掉槽（原生 false）——修法在 exec/runtime/members.ts（$del，W8 落盘）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
for-of 取迭代序而非索引序（原生 ["I0","I1"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
解构取迭代序而非索引序（原生 ["I0","I1"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
spread 取迭代序而非索引序（原生 ["I0","I1"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：纯用户 iterable 逐字不变（原生 ["I0","I1"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：Set 的 for-of 逐字不变（原生 ["A","B"]）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
mk().x += 2 折 3（原生 3）——exec/transpile/expr/assignment.ts「根不可重绑」分支补回 compoundFn	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
计算键同款：mk()[k] += 2 折 3（原生 3）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：可重绑根的复合赋值逐字不变（原生 3）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
负控：可重绑根的复合赋值读回（原生 3）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.min(x,0) > 0：x>0 时原生恒 "nonpos"（改前折 "pos" 且 conf: exact）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.max(x,0) < 0：x<0 时原生恒 "nonneg"（改前折 "neg"）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.min(x,0) < 0：x>0 时原生恒 "nonneg"（区间下界不再是 > 0 的矛盾谓词）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.max(x,0) > 0：x<0 时原生恒 "nonpos"（区间上界不再是 < 0 的矛盾谓词）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
L1 返回契约门禁：Math.min(x,0)（x>0）恒为 0 ⇒ 违反 number().gt(0)（改前假绿 OK）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
L1 返回契约门禁：Math.max(x,0)（x<0）恒为 0 ⇒ 违反 number().lt(0)（改前假绿 OK）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
L1 返回契约门禁：Math.min(x,1)（x>0）值域 (0,1] ⇒ 满足 number().gt(0)（不误报红）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
自洽性守卫：合并区间为空时不发互斥事实（不得让矛盾 pred 触发 ex falso 放电）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.min(x,1) > 0：x>0 时原生恒 "pos"	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.max(x,-1) > 0：x>0 时原生恒 "pos"（max 的析取位语义不变）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
Math.max(x,0) < 0：x<0 时原生恒 "nonneg"（与 min 臂对称）	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
字面量折叠路径不变：Math.min(3,5)=3 / Math.max(3,5)=5	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
round / abs 不走区间合并路径，结果不变	dup:algebra-eval-builtins 聚合矩阵	commit:15ec764d
```
