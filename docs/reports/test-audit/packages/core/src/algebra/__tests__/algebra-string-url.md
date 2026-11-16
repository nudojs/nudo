# packages/core/src/algebra/__tests__/algebra-string-url.test.ts

模块套件：字符串/URL/RegExp/Intl/日期面。

审计：107 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
u.href = … 合法且读回新值（改前 never throws TypeError）；其它可写组件（protocol/pathname/search/hash/port）同样不抛；origin 是 getter-only ⇒ strict 下仍确定抛 TypeError；同名用户自定义 class URL 的 this.href 写入不再被表误伤	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
const [a] = '𠮷' ⇒ a.length === 2（改前 1）；const [a,b] = '𠮷x' ⇒ 完整码点 + 后继字符；rest 段同样按码点；ASCII 与 spread / for-of 既有精度不变	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
set 后 u.search 是 '?b=2'（改前 '?b=1'）；delete 后 u.href 去掉查询串；append 后 u.href 增出新查询串；负控制：searchParams 自身与独立 URLSearchParams 精度不变	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
值面仍精确（普通闭对象）；负控制：Symbol 插值的确定 TypeError 仍成立	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
/a/gimuyds.flags ⇒ "dgimsuy"（源码序 ≠ 规范序）；/a/gmsiy.flags ⇒ "gimsy"；/a/gimuyds.toString() ⇒ "/a/dgimsuy"；构造路径仍正确（回归控制）：new RegExp("a","gimuyds").flags ⇒ "dgimsuy"；已规范的 flags 不变（回归控制）：/a/gimsuy.flags ⇒ "gimsuy"；7 个布尔标志 getter 与顺序无关（回归控制）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
`String({valueOf})`：valueOf 不调用（native：0）；`String({valueOf, toString})`：toString 先、valueOf 不调用（native：1 → 编码 1）；`String(o)` 的返回值面仍是 string（值折叠不在本条范围，副作用面已修复）；用户 toString 返回非原语 ⇒ 原生回退 valueOf（ES OrdinaryToPrimitive；native:1）；null-proto 无 coe	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
`o + 1`：valueOf 调一次（native：1）；`o + ""`：default hint 下 valueOf 先（无自有 valueOf ⇒ toString 一次，native：1）；`[Symbol.toPrimitive]` 优先于 hint（两种面各调一次）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
`${o}`：valueOf 不调用（native：0）；`${o}` + toString：toString 先、valueOf 不调用（native：编码 1）；两次插值 ⇒ 每次各调一次 toString（native：2）；`${Symbol()}` ⇒ 原生 TypeError（`String(sym)` 不抛，模板抛）；字面量插值仍折叠（`a${"b"}c` ⇒ "abc"；`${1}` ⇒ "1"）；bigint / null / undefined 字面量插值	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
includes(x, 1n)：原生确定 TypeError（bigint 不能转 number）；includes(x, Symbol())：原生确定 TypeError（symbol 不能转 number）；对照：includes(x, 1) 不抛（number 合法）；对照：indexOf(x, 1n) 早已确定 TypeError（口径一致）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
单行模板字面量里的 `export const z` 不是导出；多行模板字面量里的 `export const z` 不是导出；带插值的模板字面量里的伪导出不是导出；注释里的伪导出不是导出（注释不进产物）；源 AST 口径同样不收模板 / 注释里的伪导出；真实导出照常回收（对照组：证明断言不空转）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
文件里的 re-export 是 y ⇒ 建议点名 y（不再硬编码 x）；没有 re-export 的文件（未定义全局）⇒ 不说 re-export；两个文件的建议不同（旧口径逐字相同）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
@@entries 槽带 internal 标记（投影面据此剔除）；运行时面：new URLSearchParams("a=1") 的 getOwnPropertyNames 是 []；运行时面：hasOwnProperty("@@entries") 是 false（原生同款）；对照组：条目表本身仍可读（内部槽不影响 $get 派发）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
encoding / encode / encodeInto are present；TextDecoder encoding still resolves	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
u.host ⇒ "example.com"（不是 undefined）；u.host === undefined ⇒ false（不假绿）；"host" in u ⇒ true（in 面与读面同结论）；对照组：hostname 仍正确（回归控制）；带端口的 host 含端口、hostname 不含（原生语义）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
非对象字面量 options ⇒ 确定抛 TypeError（此前假绿）；对象 / null / undefined / 函数 options ⇒ 不抛（构造成功）；label ToString 先于 options 字典转换（Symbol label ⇒ Symbol 的 TypeError）；抽象 prim / 全 prim union options ⇒ 确定 TypeError；any / 含对象臂的 union options ⇒ may TypeError（不判确	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
btoa() 折 never + TypeError（此前假绿返回 "dW5kZWZpbmVk"）；atob() 折 never + TypeError（此前抛错种类错 InvalidCharacterError）；对照：btoa(undefined) 仍是 ToString(undefined)；对照：atob(undefined) 仍是 InvalidCharacterError（DOMException）；对照：同族 6 个函数缺参 ≡ ToString(undefin	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
e.name = "CustomError" ⇒ ["stack","message","name"]（宿主次序）；键数不变：覆写后仍是三个键（只是次序）；对照组：不覆写 name ⇒ ["stack","message"]（name 是 inherited，不在自有面）；覆写后 name 是自有且**可枚举**属性（原生语义不变）；覆写后的 name 值可读回	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
字符串字面量导出名：模块正常求值且带出该导出；标识符导出名口径不变（对照组）；无 export * as 的普通模块不受影响（对照组）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
@nudo:throws Error 盖住用户自定义 Error 子类；ignoreThrows: ['Error'] 盖住用户自定义 Error 子类；多级继承（LeafErr → MidErr → BaseErr → Error）同样被盖住；非 Error 的用户类**不被** Error 盖住（不得过度覆盖）；按类名精确申报仍生效（@nudo:throws MyError）；未申报也未忽略时仍报 L2（不得漏报）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
concatString: ("a"|"b") + "!" ⇒ "a!" | "b!"（旧实现折成 "ab!"）；concatString: union 在左侧同样逐成员并联（`v=` + union）；concatString: 两侧都是 union ⇒ 成员级叉乘；concatString: 非 union 侧的既有行为不变（单成员 ⇒ 直接返回该成员）；产品面：`+` 的 union 实参 ⇒ 成员级并联（不是 "ab!"）；产品面：模板字面量（`v=${x}`）的 u	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
字符串 pattern → 迭代器（原生 "abc".matchAll("b") 命中 1）；迭代项是**匹配数组**（RegExpExecArray），不是字符串（原生 m[0]/index/input）；缺省实参 → 空 pattern（原生 "abc".matchAll() 命中 4）；显式 undefined → 空 pattern（原生命中 4）；数字 pattern → ToString(1)（原生 "a1b".matchAll(1) 命中 1，index=1）；	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
抽象 string 接收者 + 字符串 pattern → 迭代器（**不抛** TypeError）；抽象 string 接收者 + 缺省实参 → 迭代器（**不抛** TypeError）；负控制：抽象接收者 + RegExp 无 g → **仍**确定 TypeError（既有行为不变）	algebra-string-url 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
u.href = … 合法且读回新值（改前 never throws TypeError）	dup:algebra-string-url 聚合矩阵	commit:13806366
其它可写组件（protocol/pathname/search/hash/port）同样不抛	dup:algebra-string-url 聚合矩阵	commit:13806366
origin 是 getter-only ⇒ strict 下仍确定抛 TypeError	dup:algebra-string-url 聚合矩阵	commit:13806366
同名用户自定义 class URL 的 this.href 写入不再被表误伤	dup:algebra-string-url 聚合矩阵	commit:13806366
const [a] = '𠮷' ⇒ a.length === 2（改前 1）	dup:algebra-string-url 聚合矩阵	commit:13806366
const [a,b] = '𠮷x' ⇒ 完整码点 + 后继字符	dup:algebra-string-url 聚合矩阵	commit:13806366
rest 段同样按码点	dup:algebra-string-url 聚合矩阵	commit:13806366
ASCII 与 spread / for-of 既有精度不变	dup:algebra-string-url 聚合矩阵	commit:13806366
set 后 u.search 是 '?b=2'（改前 '?b=1'）	dup:algebra-string-url 聚合矩阵	commit:13806366
delete 后 u.href 去掉查询串	dup:algebra-string-url 聚合矩阵	commit:13806366
append 后 u.href 增出新查询串	dup:algebra-string-url 聚合矩阵	commit:13806366
负控制：searchParams 自身与独立 URLSearchParams 精度不变	dup:algebra-string-url 聚合矩阵	commit:13806366
值面仍精确（普通闭对象）	dup:algebra-string-url 聚合矩阵	commit:13806366
负控制：Symbol 插值的确定 TypeError 仍成立	dup:algebra-string-url 聚合矩阵	commit:13806366
/a/gimuyds.flags ⇒ "dgimsuy"（源码序 ≠ 规范序）	dup:algebra-string-url 聚合矩阵	commit:13806366
/a/gmsiy.flags ⇒ "gimsy"	dup:algebra-string-url 聚合矩阵	commit:13806366
/a/gimuyds.toString() ⇒ "/a/dgimsuy"	dup:algebra-string-url 聚合矩阵	commit:13806366
构造路径仍正确（回归控制）：new RegExp("a","gimuyds").flags ⇒ "dgimsuy"	dup:algebra-string-url 聚合矩阵	commit:13806366
已规范的 flags 不变（回归控制）：/a/gimsuy.flags ⇒ "gimsuy"	dup:algebra-string-url 聚合矩阵	commit:13806366
7 个布尔标志 getter 与顺序无关（回归控制）	dup:algebra-string-url 聚合矩阵	commit:13806366
`String({valueOf})`：valueOf 不调用（native：0）	dup:algebra-string-url 聚合矩阵	commit:13806366
`String({valueOf, toString})`：toString 先、valueOf 不调用（native：1 → 编码 1）	dup:algebra-string-url 聚合矩阵	commit:13806366
`String(o)` 的返回值面仍是 string（值折叠不在本条范围，副作用面已修复）	dup:algebra-string-url 聚合矩阵	commit:13806366
用户 toString 返回非原语 ⇒ 原生回退 valueOf（ES OrdinaryToPrimitive；native:1）	dup:algebra-string-url 聚合矩阵	commit:13806366
null-proto 无 coercer ⇒ 仍定抛 TypeError（String(Object.create(null))）	dup:algebra-string-url 聚合矩阵	commit:13806366
`o + 1`：valueOf 调一次（native：1）	dup:algebra-string-url 聚合矩阵	commit:13806366
`o + ""`：default hint 下 valueOf 先（无自有 valueOf ⇒ toString 一次，native：1）	dup:algebra-string-url 聚合矩阵	commit:13806366
`[Symbol.toPrimitive]` 优先于 hint（两种面各调一次）	dup:algebra-string-url 聚合矩阵	commit:13806366
`${o}`：valueOf 不调用（native：0）	dup:algebra-string-url 聚合矩阵	commit:13806366
`${o}` + toString：toString 先、valueOf 不调用（native：编码 1）	dup:algebra-string-url 聚合矩阵	commit:13806366
两次插值 ⇒ 每次各调一次 toString（native：2）	dup:algebra-string-url 聚合矩阵	commit:13806366
`${Symbol()}` ⇒ 原生 TypeError（`String(sym)` 不抛，模板抛）	dup:algebra-string-url 聚合矩阵	commit:13806366
字面量插值仍折叠（`a${"b"}c` ⇒ "abc"；`${1}` ⇒ "1"）	dup:algebra-string-url 聚合矩阵	commit:13806366
bigint / null / undefined 字面量插值恒 total（`${1n}` ⇒ "1"，不记 may-throw）	dup:algebra-string-url 聚合矩阵	commit:13806366
`'x'.concat(o)`：String.prototype.concat 同口径（valueOf 不调用）	dup:algebra-string-url 聚合矩阵	commit:13806366
includes(x, 1n)：原生确定 TypeError（bigint 不能转 number）	dup:algebra-string-url 聚合矩阵	commit:13806366
includes(x, Symbol())：原生确定 TypeError（symbol 不能转 number）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：includes(x, 1) 不抛（number 合法）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：indexOf(x, 1n) 早已确定 TypeError（口径一致）	dup:algebra-string-url 聚合矩阵	commit:13806366
单行模板字面量里的 `export const z` 不是导出	dup:algebra-string-url 聚合矩阵	commit:13806366
多行模板字面量里的 `export const z` 不是导出	dup:algebra-string-url 聚合矩阵	commit:13806366
带插值的模板字面量里的伪导出不是导出	dup:algebra-string-url 聚合矩阵	commit:13806366
注释里的伪导出不是导出（注释不进产物）	dup:algebra-string-url 聚合矩阵	commit:13806366
源 AST 口径同样不收模板 / 注释里的伪导出	dup:algebra-string-url 聚合矩阵	commit:13806366
真实导出照常回收（对照组：证明断言不空转）	dup:algebra-string-url 聚合矩阵	commit:13806366
文件里的 re-export 是 y ⇒ 建议点名 y（不再硬编码 x）	dup:algebra-string-url 聚合矩阵	commit:13806366
没有 re-export 的文件（未定义全局）⇒ 不说 re-export	dup:algebra-string-url 聚合矩阵	commit:13806366
两个文件的建议不同（旧口径逐字相同）	dup:algebra-string-url 聚合矩阵	commit:13806366
@@entries 槽带 internal 标记（投影面据此剔除）	dup:algebra-string-url 聚合矩阵	commit:13806366
运行时面：new URLSearchParams("a=1") 的 getOwnPropertyNames 是 []	dup:algebra-string-url 聚合矩阵	commit:13806366
运行时面：hasOwnProperty("@@entries") 是 false（原生同款）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照组：条目表本身仍可读（内部槽不影响 $get 派发）	dup:algebra-string-url 聚合矩阵	commit:13806366
encoding / encode / encodeInto are present	dup:algebra-string-url 聚合矩阵	commit:13806366
TextDecoder encoding still resolves	dup:algebra-string-url 聚合矩阵	commit:13806366
u.host ⇒ "example.com"（不是 undefined）	dup:algebra-string-url 聚合矩阵	commit:13806366
u.host === undefined ⇒ false（不假绿）	dup:algebra-string-url 聚合矩阵	commit:13806366
"host" in u ⇒ true（in 面与读面同结论）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照组：hostname 仍正确（回归控制）	dup:algebra-string-url 聚合矩阵	commit:13806366
带端口的 host 含端口、hostname 不含（原生语义）	dup:algebra-string-url 聚合矩阵	commit:13806366
非对象字面量 options ⇒ 确定抛 TypeError（此前假绿）	dup:algebra-string-url 聚合矩阵	commit:13806366
对象 / null / undefined / 函数 options ⇒ 不抛（构造成功）	dup:algebra-string-url 聚合矩阵	commit:13806366
label ToString 先于 options 字典转换（Symbol label ⇒ Symbol 的 TypeError）	dup:algebra-string-url 聚合矩阵	commit:13806366
抽象 prim / 全 prim union options ⇒ 确定 TypeError	dup:algebra-string-url 聚合矩阵	commit:13806366
any / 含对象臂的 union options ⇒ may TypeError（不判确定）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：label 面不回退（非法字符确定 RangeError / 知名 label 成功）	dup:algebra-string-url 聚合矩阵	commit:13806366
btoa() 折 never + TypeError（此前假绿返回 "dW5kZWZpbmVk"）	dup:algebra-string-url 聚合矩阵	commit:13806366
atob() 折 never + TypeError（此前抛错种类错 InvalidCharacterError）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：btoa(undefined) 仍是 ToString(undefined)	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：atob(undefined) 仍是 InvalidCharacterError（DOMException）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照：同族 6 个函数缺参 ≡ ToString(undefined)（不得误伤）	dup:algebra-string-url 聚合矩阵	commit:13806366
e.name = "CustomError" ⇒ ["stack","message","name"]（宿主次序）	dup:algebra-string-url 聚合矩阵	commit:13806366
键数不变：覆写后仍是三个键（只是次序）	dup:algebra-string-url 聚合矩阵	commit:13806366
对照组：不覆写 name ⇒ ["stack","message"]（name 是 inherited，不在自有面）	dup:algebra-string-url 聚合矩阵	commit:13806366
覆写后 name 是自有且**可枚举**属性（原生语义不变）	dup:algebra-string-url 聚合矩阵	commit:13806366
覆写后的 name 值可读回	dup:algebra-string-url 聚合矩阵	commit:13806366
字符串字面量导出名：模块正常求值且带出该导出	dup:algebra-string-url 聚合矩阵	commit:13806366
标识符导出名口径不变（对照组）	dup:algebra-string-url 聚合矩阵	commit:13806366
无 export * as 的普通模块不受影响（对照组）	dup:algebra-string-url 聚合矩阵	commit:13806366
@nudo:throws Error 盖住用户自定义 Error 子类	dup:algebra-string-url 聚合矩阵	commit:13806366
ignoreThrows: ['Error'] 盖住用户自定义 Error 子类	dup:algebra-string-url 聚合矩阵	commit:13806366
多级继承（LeafErr → MidErr → BaseErr → Error）同样被盖住	dup:algebra-string-url 聚合矩阵	commit:13806366
非 Error 的用户类**不被** Error 盖住（不得过度覆盖）	dup:algebra-string-url 聚合矩阵	commit:13806366
按类名精确申报仍生效（@nudo:throws MyError）	dup:algebra-string-url 聚合矩阵	commit:13806366
未申报也未忽略时仍报 L2（不得漏报）	dup:algebra-string-url 聚合矩阵	commit:13806366
concatString: ("a"|"b") + "!" ⇒ "a!" | "b!"（旧实现折成 "ab!"）	dup:algebra-string-url 聚合矩阵	commit:13806366
concatString: union 在左侧同样逐成员并联（`v=` + union）	dup:algebra-string-url 聚合矩阵	commit:13806366
concatString: 两侧都是 union ⇒ 成员级叉乘	dup:algebra-string-url 聚合矩阵	commit:13806366
concatString: 非 union 侧的既有行为不变（单成员 ⇒ 直接返回该成员）	dup:algebra-string-url 聚合矩阵	commit:13806366
产品面：`+` 的 union 实参 ⇒ 成员级并联（不是 "ab!"）	dup:algebra-string-url 聚合矩阵	commit:13806366
产品面：模板字面量（`v=${x}`）的 union 实参 ⇒ 成员级并联（不是 "v=ab"）	dup:algebra-string-url 聚合矩阵	commit:13806366
产品面：union 实参的两段拼接（`x + "-"` 再 `+ "!"`）仍是成员级并联	dup:algebra-string-url 聚合矩阵	commit:13806366
字符串 pattern → 迭代器（原生 "abc".matchAll("b") 命中 1）	dup:algebra-string-url 聚合矩阵	commit:13806366
迭代项是**匹配数组**（RegExpExecArray），不是字符串（原生 m[0]/index/input）	dup:algebra-string-url 聚合矩阵	commit:13806366
缺省实参 → 空 pattern（原生 "abc".matchAll() 命中 4）	dup:algebra-string-url 聚合矩阵	commit:13806366
显式 undefined → 空 pattern（原生命中 4）	dup:algebra-string-url 聚合矩阵	commit:13806366
数字 pattern → ToString(1)（原生 "a1b".matchAll(1) 命中 1，index=1）	dup:algebra-string-url 聚合矩阵	commit:13806366
null → ToString(null)="null"（原生 "abc".matchAll(null) 命中 0，**不抛**）	dup:algebra-string-url 聚合矩阵	commit:13806366
布尔 / 小数 pattern → ToString 折叠（原生命中 0，**不抛**）	dup:algebra-string-url 聚合矩阵	commit:13806366
非法 pattern → **确定 SyntaxError**（不回落「本臂不接管」哨兵）	dup:algebra-string-url 聚合矩阵	commit:13806366
symbol pattern → 确定 TypeError（ToString(symbol) 抛，原生同款）	dup:algebra-string-url 聚合矩阵	commit:13806366
负控制：RegExp 实参确定无 g → **仍**确定 TypeError（原生同款）	dup:algebra-string-url 聚合矩阵	commit:13806366
负控制：RegExp 实参带 g → 迭代器，命中 1（原生同款）	dup:algebra-string-url 聚合矩阵	commit:13806366
协议面：typeof → object；next() → {value,done}；@@iterator 返自身	dup:algebra-string-url 聚合矩阵	commit:13806366
协议面：next().value 是匹配数组（原生 RegExpExecArray）	dup:algebra-string-url 聚合矩阵	commit:13806366
抽象 string 接收者 + 字符串 pattern → 迭代器（**不抛** TypeError）	dup:algebra-string-url 聚合矩阵	commit:13806366
抽象 string 接收者 + 缺省实参 → 迭代器（**不抛** TypeError）	dup:algebra-string-url 聚合矩阵	commit:13806366
负控制：抽象接收者 + RegExp 无 g → **仍**确定 TypeError（既有行为不变）	dup:algebra-string-url 聚合矩阵	commit:13806366
```
