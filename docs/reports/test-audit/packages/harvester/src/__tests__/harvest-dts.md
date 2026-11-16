# packages/harvester/src/__tests__/harvest-dts.test.ts

模块套件：harvest 声明面（class/interface/alias/namespace/overload/generic/record/tuple）。

审计：200 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
别名 `type Id = string` ⇒ string()，不是 any()；契约**真的**要求 string（域隶属判定 = 零义务已消除）；产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）；收割面同答案：(string) => string；类型别名指向对象时展开成 shape；interface 也展开；interface 的**继承成员**也在契约里（只展开自身成员 ⇒ 悄悄放宽）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
草稿是 partial(shape({…}))，不是原样透传的 shape({…})；契约里两个字段都**可选**（isOptional）；产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）；收割面同答案：该位无义务（unknown）⇒ 两侧都接受 {}	harvest-dts 聚合矩阵	没测该层	keep	keep	—
键是字面量集合时，**值域落到实现**（shape 的字段就是值域）；键不是字面量时**如实降级**：不宣称值域 + note 明说未建模 + 计入 skipped；产品面：值域落地的 Record **红**（与 tsc 的 TS2322 同向，不再放绿）；收割面同口径：Record 是**开放对象且带索引值域**（值域没丢）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
`x is T` 的返回面是 boolean（不是 unknown，也不是被谓词的 T）；`asserts x is T` 的返回面与 `: void` 同口径（不是 unknown）；`asserts x`（无 `is T`）也是 void 口径；`this is T` / `asserts this is T` 同口径；谓词里的联合被谓词类型不影响返回面（仍是 boolean）；接口方法签名上的谓词同口径；函数类型（type literal）上的谓词同口径；负控：普通返回	harvest-dts 聚合矩阵	没测该层	keep	keep	—
不同类型实参 ⇒ 不同实例（改前 Box<number> 被折成 Box<string>）；同一类型实参 ⇒ 命中缓存（同一个实例对象）；实参个数相同、类型不同 ⇒ 不共缓存（个数相同也必须分开）；嵌套实参也按身份区分（Box<Box<string>> ≠ Box<Box<number>>）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
A.Opts 只有 A 的成员（不含 B.Opts 的 b）；B.Opts 只有 B 的成员（不含 A.Opts 的 a）；对照：单命名空间时成员照常可见（不是「全都丢了」）；对照：非限定引用仍解析得到接口成员（既有口径不被破坏）；对照：lodash 形态的模块增强仍与命名空间限定名合并	harvest-dts 聚合矩阵	没测该层	keep	keep	—
顶层函数的 `this` 形参被跳过（元数 = 真实实参数）；`this` 形参的类型不进入参数位；多个真实实参时元数只算真实实参；接口方法签名上的 `this` 形参同口径（不进实例面的参数位）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
`const p: Point` 绑定保留在 globals 里（改前整个消失）；`p` 的类型是 Point 的实例面（不是 unknown）；实例成员进实例面（x / y / label / move / origin）；以类名做参数类型时参数面是 Point（改前退化成 unknown）；静态成员不进实例面	harvest-dts 聚合矩阵	没测该层	keep	keep	—
类型 vs 字面量 ⇒ 假（number extends 1 / string extends "a"）；字面量 vs 字面量 ⇒ 按值比（"a" vs "b" 假；1 vs 1 真；1 vs 2 假）；字面量 vs 类型 ⇒ 真（1 extends number / "a" extends string）；判定不是「一律判假」：同值字面量仍然成立	harvest-dts 聚合矩阵	没测该层	keep	keep	—
带括号的数组 infer 绑定元素类型（改前 any）；带括号的类型字面量 infer 绑定成员类型（改前 any）；无括号的 Promise infer 仍然绑定（不被括号口径改坏）；同一语义（带括号 / 不带括号）得到同一个值	harvest-dts 聚合矩阵	没测该层	keep	keep	—
Point & Size 的成员是并集（x/y/w/h 四个）；交叉类型与单侧**可区分**（改前两者完全同形）；成员的值域保留（不是 unknown / never）；同名冲突成员取 never（TS 的 A & B 属性冲突语义）；纯字面量交叉（无对象面）不崩，兜底取第一侧	harvest-dts 聚合矩阵	没测该层	keep	keep	—
Box<number> / Box<string> 的成员值域分别是 number / string；两个实例**可区分**（改前完全同形）；别名路径与接口路径**同口径**（两者都会代入实参）；别名体内是数组时也代入实参（Box<T> = T[]）；非泛型别名不受影响（不凭空多出实参）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
`number | null` 的草稿是 union(number(), null)，不是 any()；契约**真的**拒绝字符串（域隶属判定 = 假绿已消除）；产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）；收割面同口径：`null` 是真 null 面（渲染成 number | null）；约束位上的裸字面量是**真约束**（顶层 null 导出不是 `export const x = null`）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
[number, string] 的槽位分别是 number / string；槽位 ≥1 的元素域是**各自**的类型（不再与首元素相同）；元组不再是数组（不再折成 number[]）；rest 槽位保留自己的元素类型（[number, ...string[]]）；具名元组成员保留自己的类型	harvest-dts 聚合矩阵	没测该层	keep	keep	—
Record<string, number> 是开放对象且带索引值域 number；两个不同的 Record **可区分**（改前都是闭空对象、完全同形）；类型字面量的索引签名也建成开放对象；索引签名 + 具名成员共存时两者都在（具名成员不被索引吞掉）；没有索引签名的类型字面量仍是**闭**对象（开放性不被乱加）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
映射类型 / 模板字面量 / 索引访问 / keyof / typeof 的绑定全部保留；值域未知时退成 unknown（降级，不是符号不存在）；可判定的类型不受影响（对照组：仍是确切类型）；没有类型标注的 `declare const` 也保留绑定	harvest-dts 聚合矩阵	没测该层	keep	keep	—
同名 overload 的返回类型不再被抹除（并集）；参数位逐位并集（与顶层函数路径同口径）；顶层函数路径与接口成员路径同形（同一实体两条路径不得分叉）；单个签名（无重载）不受影响；重载成员仍可调用（relation 面完整：参数位 + 返回位都在）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
递归别名 = 按名 brand（不是内联展开的对象）；自引用点 = 按名 brand 引用（内层「形状待定」，不再展开一层）；规模有界：自引用成员数增加时 env 模块不指数增长；互引别名（type A = { b: B }; type B = { a: A }）也被识别为递归	harvest-dts 聚合矩阵	没测该层	keep	keep	—
brand 成员与**模块级**提升成员的形态完全一致（BUG-253：提升只对模块作用域成立）；重载集保留全部返回类型（不是只剩第一个 overload）；对照：单签名方法两条路径同样一致；泛型接口：brand 面用类型实参（string），提升面不产出未绑定 α	harvest-dts 聚合矩阵	没测该层	keep	keep	—
Derived 的实例面含基接口的成员 b；继承来的成员不是「读不到」（不是 exact undefined）；对照：基接口自身只有自己的成员（不被子接口的成员污染）；对照：多级继承链（extends 递归）；对照：无 extends 时成员表不变（既有口径不被破坏）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
接口的 α 照常代入（sh.v 是实参类型）；方法自己的 α **不被**接口实参替换（方法仍是泛型的）；遮蔽的 α 与外层 α 是**不同**的身份；无同名遮蔽时，方法的 α 仍可被接口实参代入（不误伤）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
自引用点是 brand 且内层「形状待定」；非递归成员仍然精确（value: number 不受影响）；成员读不折成 exact undefined（L2 假红的成因消失）；三条收割路径给出同一个类型（收割面 / 磁盘往返面 / 落盘发射面）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
无实参引用取默认值（改前是 any = 未绑定 α）；`Box` ≡ `Box<string>`（默认路径与显式实参路径同形）；显式实参仍然优先于默认值；无默认值时取约束面（不留完全无约束的 α）；既无默认值也无约束 ⇒ 推断 unknown（不是未绑定 α）；多形参：部分显式 + 其余取默认值	harvest-dts 聚合矩阵	没测该层	keep	keep	—
结构相同的两个 interface ⇒ 判真（改前按名字判假）；结构不同的两个 interface ⇒ 判假（不能因为放宽而一律判真）；同名 interface ⇒ 判真（不得被结构口径改坏）；多成员结构相同 ⇒ 判真；源上**缺成员** ⇒ 判假	harvest-dts 聚合矩阵	没测该层	keep	keep	—
内联字面量与 interface 两条路径的成员集合**一致**；访问器的读面是 getter 的返回类型（不是 exact undefined）；get / set 对的读面**与声明顺序无关**（set 在前也取 getter）；只有 setter 时读面不折 exact undefined（写面单独建模）；无访问器的普通字面量不受影响	harvest-dts 聚合矩阵	没测该层	keep	keep	—
逐字相同的两条声明 ⇒ 调用点返回类型完全一致；属性位的条件元数据不被下一条签名捡走（inferFrom 必须为空）；冷 / 热缓存两种状态同口径（重复收割结果不变）；遍历顺序不影响结论（接口单独一个文件 / 换文件顺序）；真支就是 infer 变量时，元数据仍挂在**自己那条**签名上	harvest-dts 聚合矩阵	没测该层	keep	keep	—
keyof 可算 ⇒ 照常判定（"z" 不在 {a,b} ⇒ 假）；keyof 可算 ⇒ 在键集合里 ⇒ 真（不能一律判不出）；typeof 判不出 ⇒ 不取支（两支并集，不是恒真）；未解析的类型引用判不出 ⇒ 不取支（两支并集）；keyof 的判定方向不随「判不出」放宽（对拍 TS 的两条断言）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
嵌套条件类型的真支被递归求值（真支取值出现在结果里）；不再返回 infer 变量顶替出来的错误确切值；真支就是 infer 变量时仍走 α 捷径（inferFrom 在位）；嵌套真支不被当成 infer 变量 ⇒ 不挂 inferFrom	harvest-dts 聚合矩阵	没测该层	keep	keep	—
重载集保留**全部** overload 的返回类型（不被塌成第一个）；每条 overload 的签名都看得见（note 里逐条列出）；被合并掉的 overload **计入 skipped**（汇总行说真话）；N 条 overload ⇒ N−1 条丢失被逐条计数；单条声明（无重载）不算丢失	harvest-dts 聚合矩阵	没测该层	keep	keep	—
类值带 `ctor: true` facet（改前缺省 = 可构造性未知）；mock 化时透传 ctor facet（否则又变回「可构造性未知」）；`new Gadget()` 不记 may TypeError（改前记「可构造性未知」）；`new Gadget()` 产出实例面（Point/Gadget 品牌，不是 unknown）；反向：去掉 ctor facet ⇒ 同一个 new 记 may TypeError（证明判据就是这个 facet）；普通函数（不是类）不带 c	harvest-dts 聚合矩阵	没测该层	keep	keep	—
参数位保留每个 overload 的参数类型（不再只取 sigs[0]）；单个声明的函数不受影响（参数位不被改写）；参数个数不同的 overload 不改参数位（arity 不能被改）；带泛型 α 的 overload 不改参数位（α 是逐参数绑定的）；A6：overloads 随磁盘签名投影往返（缓存命中不丢派发面）；A6：重载集进入 fn shape 的 overloads 承载位（声明序逐 arm）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
构造签名产出 fn 形状且带 ctor: true facet；构造形参与实例面保留（new C(1) 的实例类型是声明的返回类型）；构造形参是可选时带上 undefined（与普通形参同口径）；与构造签名共存的具名成员不丢（静态槽）；无构造签名的普通字面量不带 ctor facet	harvest-dts 聚合矩阵	没测该层	keep	keep	—
调用签名产出 fn 形状（不是空 obj）；形参与返回面保留（形参位是 number、返回位是 string）；多形参 / 可选形参按普通签名同口径；与调用签名共存的具名成员不丢（静态槽）；无调用签名的普通字面量仍是 obj（不误投影成 fn）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
迭代协议成员进入实例模型（@@iterator 槽存在且可调用）；具名成员不受影响（对照组：只有计算成员名被丢）；异步迭代协议同样保留（@@asyncIterator）；不可静态判定的计算成员名被跳过（不产出错误成员名，也不崩）；计算成员名不影响具名成员的类型（不被覆盖成 unknown）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
带引号 / 连字符的键产出**合法**的 DSL（引号串形态）；草稿产物真能过 `node --check`（改前：Unexpected token）；`__proto__` 键走计算属性名（对象字面量的 __proto__ 会改原型）；**抄进侧车后 `nudo check` 仍然绿**（改前：sidecar 加载失败 ⇒ exit 1）；反向闸：语法非法的侧车**必定**加载失败（证明上一条不是永真断言）；导出名撞 builder import ⇒ 走别名形态（草稿仍是合	harvest-dts 聚合矩阵	没测该层	keep	keep	—
草稿的返回位**不是** resolve 后的类型（外壳不被剥掉）；该位的丢失**如实标注**（note + skipped 计数），不静默放宽；产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）；收割面同口径：Promise 外壳**保留**（promise<…>）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
方法成员进契约：`port: fn({}, number())`；数字键成员也不被丢；产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2345 同向）；收割面同口径：方法成员在收割面也在（port: () => number）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
可选方法的槽位含 undefined（可能不存在，不是必定存在）；可选方法与可选属性的可省性口径一致（两者都含 undefined）；必选方法不被加上 undefined；提升面同口径（可选方法提升出的模块成员也含 undefined）；对照：内联类型字面量的可选方法同口径（第二条成员收集路径）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
可选形参记进 optionalParams，必选元数 = TS minArgumentCount（1）；rest 形参不是必选位（元数 0）；对照：全必选签名不受影响（元数 2）；磁盘投影往返保留 optionalParams（冷 / 热同元数）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
第二份声明的成员不丢（extra 在）；声明顺序不影响成员集合	harvest-dts 聚合矩阵	没测该层	keep	keep	—
具体 overload 在前：返回位保留具体类型（不是悬空 T / any）；泛型 overload 在前：保留 α（可被实参绑定）；两种声明顺序不被抹成静默 any（旧行为：(string) => T ⇒ any）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
数字 / 字符串 / const enum 都有成员面（不再是 unknown）；无初始化器的成员按 TS 语义从 0 自增；与契约草稿面同口径（两面不再矛盾）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
必选形态完成（基线）；可选形态同样完成，且成员是 `L26 | undefined`	harvest-dts 聚合矩阵	没测该层	keep	keep	—
导出名撞 builder import ⇒ 走别名形态（改前：export const number）；草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）；负控制：普通导出名仍是 export const <name>（不误改别名形态）	harvest-dts 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
别名 `type Id = string` ⇒ string()，不是 any()	dup:harvest-dts 聚合矩阵	commit:13806366
契约**真的**要求 string（域隶属判定 = 零义务已消除）	dup:harvest-dts 聚合矩阵	commit:13806366
产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同答案：(string) => string	dup:harvest-dts 聚合矩阵	commit:13806366
类型别名指向对象时展开成 shape；interface 也展开	dup:harvest-dts 聚合矩阵	commit:13806366
interface 的**继承成员**也在契约里（只展开自身成员 ⇒ 悄悄放宽）	dup:harvest-dts 聚合矩阵	commit:13806366
草稿是 partial(shape({…}))，不是原样透传的 shape({…})	dup:harvest-dts 聚合矩阵	commit:13806366
契约里两个字段都**可选**（isOptional）	dup:harvest-dts 聚合矩阵	commit:13806366
产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同答案：该位无义务（unknown）⇒ 两侧都接受 {}	dup:harvest-dts 聚合矩阵	commit:13806366
键是字面量集合时，**值域落到实现**（shape 的字段就是值域）	dup:harvest-dts 聚合矩阵	commit:13806366
键不是字面量时**如实降级**：不宣称值域 + note 明说未建模 + 计入 skipped	dup:harvest-dts 聚合矩阵	commit:13806366
产品面：值域落地的 Record **红**（与 tsc 的 TS2322 同向，不再放绿）	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同口径：Record 是**开放对象且带索引值域**（值域没丢）	dup:harvest-dts 聚合矩阵	commit:13806366
`x is T` 的返回面是 boolean（不是 unknown，也不是被谓词的 T）	dup:harvest-dts 聚合矩阵	commit:13806366
`asserts x is T` 的返回面与 `: void` 同口径（不是 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
`asserts x`（无 `is T`）也是 void 口径	dup:harvest-dts 聚合矩阵	commit:13806366
`this is T` / `asserts this is T` 同口径	dup:harvest-dts 聚合矩阵	commit:13806366
谓词里的联合被谓词类型不影响返回面（仍是 boolean）	dup:harvest-dts 聚合矩阵	commit:13806366
接口方法签名上的谓词同口径	dup:harvest-dts 聚合矩阵	commit:13806366
函数类型（type literal）上的谓词同口径	dup:harvest-dts 聚合矩阵	commit:13806366
负控：普通返回类型的收割结果不变	dup:harvest-dts 聚合矩阵	commit:13806366
不同类型实参 ⇒ 不同实例（改前 Box<number> 被折成 Box<string>）	dup:harvest-dts 聚合矩阵	commit:13806366
同一类型实参 ⇒ 命中缓存（同一个实例对象）	dup:harvest-dts 聚合矩阵	commit:13806366
实参个数相同、类型不同 ⇒ 不共缓存（个数相同也必须分开）	dup:harvest-dts 聚合矩阵	commit:13806366
嵌套实参也按身份区分（Box<Box<string>> ≠ Box<Box<number>>）	dup:harvest-dts 聚合矩阵	commit:13806366
A.Opts 只有 A 的成员（不含 B.Opts 的 b）	dup:harvest-dts 聚合矩阵	commit:13806366
B.Opts 只有 B 的成员（不含 A.Opts 的 a）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：单命名空间时成员照常可见（不是「全都丢了」）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：非限定引用仍解析得到接口成员（既有口径不被破坏）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：lodash 形态的模块增强仍与命名空间限定名合并	dup:harvest-dts 聚合矩阵	commit:13806366
顶层函数的 `this` 形参被跳过（元数 = 真实实参数）	dup:harvest-dts 聚合矩阵	commit:13806366
`this` 形参的类型不进入参数位	dup:harvest-dts 聚合矩阵	commit:13806366
多个真实实参时元数只算真实实参	dup:harvest-dts 聚合矩阵	commit:13806366
接口方法签名上的 `this` 形参同口径（不进实例面的参数位）	dup:harvest-dts 聚合矩阵	commit:13806366
`const p: Point` 绑定保留在 globals 里（改前整个消失）	dup:harvest-dts 聚合矩阵	commit:13806366
`p` 的类型是 Point 的实例面（不是 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
实例成员进实例面（x / y / label / move / origin）	dup:harvest-dts 聚合矩阵	commit:13806366
以类名做参数类型时参数面是 Point（改前退化成 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
静态成员不进实例面	dup:harvest-dts 聚合矩阵	commit:13806366
类型 vs 字面量 ⇒ 假（number extends 1 / string extends "a"）	dup:harvest-dts 聚合矩阵	commit:13806366
字面量 vs 字面量 ⇒ 按值比（"a" vs "b" 假；1 vs 1 真；1 vs 2 假）	dup:harvest-dts 聚合矩阵	commit:13806366
字面量 vs 类型 ⇒ 真（1 extends number / "a" extends string）	dup:harvest-dts 聚合矩阵	commit:13806366
判定不是「一律判假」：同值字面量仍然成立	dup:harvest-dts 聚合矩阵	commit:13806366
带括号的数组 infer 绑定元素类型（改前 any）	dup:harvest-dts 聚合矩阵	commit:13806366
带括号的类型字面量 infer 绑定成员类型（改前 any）	dup:harvest-dts 聚合矩阵	commit:13806366
无括号的 Promise infer 仍然绑定（不被括号口径改坏）	dup:harvest-dts 聚合矩阵	commit:13806366
同一语义（带括号 / 不带括号）得到同一个值	dup:harvest-dts 聚合矩阵	commit:13806366
Point & Size 的成员是并集（x/y/w/h 四个）	dup:harvest-dts 聚合矩阵	commit:13806366
交叉类型与单侧**可区分**（改前两者完全同形）	dup:harvest-dts 聚合矩阵	commit:13806366
成员的值域保留（不是 unknown / never）	dup:harvest-dts 聚合矩阵	commit:13806366
同名冲突成员取 never（TS 的 A & B 属性冲突语义）	dup:harvest-dts 聚合矩阵	commit:13806366
纯字面量交叉（无对象面）不崩，兜底取第一侧	dup:harvest-dts 聚合矩阵	commit:13806366
Box<number> / Box<string> 的成员值域分别是 number / string	dup:harvest-dts 聚合矩阵	commit:13806366
两个实例**可区分**（改前完全同形）	dup:harvest-dts 聚合矩阵	commit:13806366
别名路径与接口路径**同口径**（两者都会代入实参）	dup:harvest-dts 聚合矩阵	commit:13806366
别名体内是数组时也代入实参（Box<T> = T[]）	dup:harvest-dts 聚合矩阵	commit:13806366
非泛型别名不受影响（不凭空多出实参）	dup:harvest-dts 聚合矩阵	commit:13806366
`number | null` 的草稿是 union(number(), null)，不是 any()	dup:harvest-dts 聚合矩阵	commit:13806366
契约**真的**拒绝字符串（域隶属判定 = 假绿已消除）	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同口径：`null` 是真 null 面（渲染成 number | null）	dup:harvest-dts 聚合矩阵	commit:13806366
约束位上的裸字面量是**真约束**（顶层 null 导出不是 `export const x = null`）	dup:harvest-dts 聚合矩阵	commit:13806366
[number, string] 的槽位分别是 number / string	dup:harvest-dts 聚合矩阵	commit:13806366
槽位 ≥1 的元素域是**各自**的类型（不再与首元素相同）	dup:harvest-dts 聚合矩阵	commit:13806366
元组不再是数组（不再折成 number[]）	dup:harvest-dts 聚合矩阵	commit:13806366
rest 槽位保留自己的元素类型（[number, ...string[]]）	dup:harvest-dts 聚合矩阵	commit:13806366
具名元组成员保留自己的类型	dup:harvest-dts 聚合矩阵	commit:13806366
Record<string, number> 是开放对象且带索引值域 number	dup:harvest-dts 聚合矩阵	commit:13806366
两个不同的 Record **可区分**（改前都是闭空对象、完全同形）	dup:harvest-dts 聚合矩阵	commit:13806366
类型字面量的索引签名也建成开放对象	dup:harvest-dts 聚合矩阵	commit:13806366
索引签名 + 具名成员共存时两者都在（具名成员不被索引吞掉）	dup:harvest-dts 聚合矩阵	commit:13806366
没有索引签名的类型字面量仍是**闭**对象（开放性不被乱加）	dup:harvest-dts 聚合矩阵	commit:13806366
映射类型 / 模板字面量 / 索引访问 / keyof / typeof 的绑定全部保留	dup:harvest-dts 聚合矩阵	commit:13806366
值域未知时退成 unknown（降级，不是符号不存在）	dup:harvest-dts 聚合矩阵	commit:13806366
可判定的类型不受影响（对照组：仍是确切类型）	dup:harvest-dts 聚合矩阵	commit:13806366
没有类型标注的 `declare const` 也保留绑定	dup:harvest-dts 聚合矩阵	commit:13806366
同名 overload 的返回类型不再被抹除（并集）	dup:harvest-dts 聚合矩阵	commit:13806366
参数位逐位并集（与顶层函数路径同口径）	dup:harvest-dts 聚合矩阵	commit:13806366
顶层函数路径与接口成员路径同形（同一实体两条路径不得分叉）	dup:harvest-dts 聚合矩阵	commit:13806366
单个签名（无重载）不受影响	dup:harvest-dts 聚合矩阵	commit:13806366
重载成员仍可调用（relation 面完整：参数位 + 返回位都在）	dup:harvest-dts 聚合矩阵	commit:13806366
递归别名 = 按名 brand（不是内联展开的对象）	dup:harvest-dts 聚合矩阵	commit:13806366
自引用点 = 按名 brand 引用（内层「形状待定」，不再展开一层）	dup:harvest-dts 聚合矩阵	commit:13806366
规模有界：自引用成员数增加时 env 模块不指数增长	dup:harvest-dts 聚合矩阵	commit:13806366
互引别名（type A = { b: B }; type B = { a: A }）也被识别为递归	dup:harvest-dts 聚合矩阵	commit:13806366
brand 成员与**模块级**提升成员的形态完全一致（BUG-253：提升只对模块作用域成立）	dup:harvest-dts 聚合矩阵	commit:13806366
重载集保留全部返回类型（不是只剩第一个 overload）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：单签名方法两条路径同样一致	dup:harvest-dts 聚合矩阵	commit:13806366
泛型接口：brand 面用类型实参（string），提升面不产出未绑定 α	dup:harvest-dts 聚合矩阵	commit:13806366
Derived 的实例面含基接口的成员 b	dup:harvest-dts 聚合矩阵	commit:13806366
继承来的成员不是「读不到」（不是 exact undefined）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：基接口自身只有自己的成员（不被子接口的成员污染）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：多级继承链（extends 递归）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：无 extends 时成员表不变（既有口径不被破坏）	dup:harvest-dts 聚合矩阵	commit:13806366
接口的 α 照常代入（sh.v 是实参类型）	dup:harvest-dts 聚合矩阵	commit:13806366
方法自己的 α **不被**接口实参替换（方法仍是泛型的）	dup:harvest-dts 聚合矩阵	commit:13806366
遮蔽的 α 与外层 α 是**不同**的身份	dup:harvest-dts 聚合矩阵	commit:13806366
无同名遮蔽时，方法的 α 仍可被接口实参代入（不误伤）	dup:harvest-dts 聚合矩阵	commit:13806366
自引用点是 brand 且内层「形状待定」	dup:harvest-dts 聚合矩阵	commit:13806366
非递归成员仍然精确（value: number 不受影响）	dup:harvest-dts 聚合矩阵	commit:13806366
成员读不折成 exact undefined（L2 假红的成因消失）	dup:harvest-dts 聚合矩阵	commit:13806366
三条收割路径给出同一个类型（收割面 / 磁盘往返面 / 落盘发射面）	dup:harvest-dts 聚合矩阵	commit:13806366
无实参引用取默认值（改前是 any = 未绑定 α）	dup:harvest-dts 聚合矩阵	commit:13806366
`Box` ≡ `Box<string>`（默认路径与显式实参路径同形）	dup:harvest-dts 聚合矩阵	commit:13806366
显式实参仍然优先于默认值	dup:harvest-dts 聚合矩阵	commit:13806366
无默认值时取约束面（不留完全无约束的 α）	dup:harvest-dts 聚合矩阵	commit:13806366
既无默认值也无约束 ⇒ 推断 unknown（不是未绑定 α）	dup:harvest-dts 聚合矩阵	commit:13806366
多形参：部分显式 + 其余取默认值	dup:harvest-dts 聚合矩阵	commit:13806366
结构相同的两个 interface ⇒ 判真（改前按名字判假）	dup:harvest-dts 聚合矩阵	commit:13806366
结构不同的两个 interface ⇒ 判假（不能因为放宽而一律判真）	dup:harvest-dts 聚合矩阵	commit:13806366
同名 interface ⇒ 判真（不得被结构口径改坏）	dup:harvest-dts 聚合矩阵	commit:13806366
多成员结构相同 ⇒ 判真；源上**缺成员** ⇒ 判假	dup:harvest-dts 聚合矩阵	commit:13806366
内联字面量与 interface 两条路径的成员集合**一致**	dup:harvest-dts 聚合矩阵	commit:13806366
访问器的读面是 getter 的返回类型（不是 exact undefined）	dup:harvest-dts 聚合矩阵	commit:13806366
get / set 对的读面**与声明顺序无关**（set 在前也取 getter）	dup:harvest-dts 聚合矩阵	commit:13806366
只有 setter 时读面不折 exact undefined（写面单独建模）	dup:harvest-dts 聚合矩阵	commit:13806366
无访问器的普通字面量不受影响	dup:harvest-dts 聚合矩阵	commit:13806366
逐字相同的两条声明 ⇒ 调用点返回类型完全一致	dup:harvest-dts 聚合矩阵	commit:13806366
属性位的条件元数据不被下一条签名捡走（inferFrom 必须为空）	dup:harvest-dts 聚合矩阵	commit:13806366
冷 / 热缓存两种状态同口径（重复收割结果不变）	dup:harvest-dts 聚合矩阵	commit:13806366
遍历顺序不影响结论（接口单独一个文件 / 换文件顺序）	dup:harvest-dts 聚合矩阵	commit:13806366
真支就是 infer 变量时，元数据仍挂在**自己那条**签名上	dup:harvest-dts 聚合矩阵	commit:13806366
keyof 可算 ⇒ 照常判定（"z" 不在 {a,b} ⇒ 假）	dup:harvest-dts 聚合矩阵	commit:13806366
keyof 可算 ⇒ 在键集合里 ⇒ 真（不能一律判不出）	dup:harvest-dts 聚合矩阵	commit:13806366
typeof 判不出 ⇒ 不取支（两支并集，不是恒真）	dup:harvest-dts 聚合矩阵	commit:13806366
未解析的类型引用判不出 ⇒ 不取支（两支并集）	dup:harvest-dts 聚合矩阵	commit:13806366
keyof 的判定方向不随「判不出」放宽（对拍 TS 的两条断言）	dup:harvest-dts 聚合矩阵	commit:13806366
嵌套条件类型的真支被递归求值（真支取值出现在结果里）	dup:harvest-dts 聚合矩阵	commit:13806366
不再返回 infer 变量顶替出来的错误确切值	dup:harvest-dts 聚合矩阵	commit:13806366
真支就是 infer 变量时仍走 α 捷径（inferFrom 在位）	dup:harvest-dts 聚合矩阵	commit:13806366
嵌套真支不被当成 infer 变量 ⇒ 不挂 inferFrom	dup:harvest-dts 聚合矩阵	commit:13806366
重载集保留**全部** overload 的返回类型（不被塌成第一个）	dup:harvest-dts 聚合矩阵	commit:13806366
每条 overload 的签名都看得见（note 里逐条列出）	dup:harvest-dts 聚合矩阵	commit:13806366
被合并掉的 overload **计入 skipped**（汇总行说真话）	dup:harvest-dts 聚合矩阵	commit:13806366
N 条 overload ⇒ N−1 条丢失被逐条计数	dup:harvest-dts 聚合矩阵	commit:13806366
单条声明（无重载）不算丢失	dup:harvest-dts 聚合矩阵	commit:13806366
类值带 `ctor: true` facet（改前缺省 = 可构造性未知）	dup:harvest-dts 聚合矩阵	commit:13806366
mock 化时透传 ctor facet（否则又变回「可构造性未知」）	dup:harvest-dts 聚合矩阵	commit:13806366
`new Gadget()` 不记 may TypeError（改前记「可构造性未知」）	dup:harvest-dts 聚合矩阵	commit:13806366
`new Gadget()` 产出实例面（Point/Gadget 品牌，不是 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
反向：去掉 ctor facet ⇒ 同一个 new 记 may TypeError（证明判据就是这个 facet）	dup:harvest-dts 聚合矩阵	commit:13806366
普通函数（不是类）不带 ctor facet（可构造性保持未知，不误报可构造）	dup:harvest-dts 聚合矩阵	commit:13806366
参数位保留每个 overload 的参数类型（不再只取 sigs[0]）	dup:harvest-dts 聚合矩阵	commit:13806366
单个声明的函数不受影响（参数位不被改写）	dup:harvest-dts 聚合矩阵	commit:13806366
参数个数不同的 overload 不改参数位（arity 不能被改）	dup:harvest-dts 聚合矩阵	commit:13806366
带泛型 α 的 overload 不改参数位（α 是逐参数绑定的）	dup:harvest-dts 聚合矩阵	commit:13806366
A6：overloads 随磁盘签名投影往返（缓存命中不丢派发面）	dup:harvest-dts 聚合矩阵	commit:13806366
A6：重载集进入 fn shape 的 overloads 承载位（声明序逐 arm）	dup:harvest-dts 聚合矩阵	commit:13806366
构造签名产出 fn 形状且带 ctor: true facet	dup:harvest-dts 聚合矩阵	commit:13806366
构造形参与实例面保留（new C(1) 的实例类型是声明的返回类型）	dup:harvest-dts 聚合矩阵	commit:13806366
构造形参是可选时带上 undefined（与普通形参同口径）	dup:harvest-dts 聚合矩阵	commit:13806366
与构造签名共存的具名成员不丢（静态槽）	dup:harvest-dts 聚合矩阵	commit:13806366
无构造签名的普通字面量不带 ctor facet	dup:harvest-dts 聚合矩阵	commit:13806366
调用签名产出 fn 形状（不是空 obj）	dup:harvest-dts 聚合矩阵	commit:13806366
形参与返回面保留（形参位是 number、返回位是 string）	dup:harvest-dts 聚合矩阵	commit:13806366
多形参 / 可选形参按普通签名同口径	dup:harvest-dts 聚合矩阵	commit:13806366
与调用签名共存的具名成员不丢（静态槽）	dup:harvest-dts 聚合矩阵	commit:13806366
无调用签名的普通字面量仍是 obj（不误投影成 fn）	dup:harvest-dts 聚合矩阵	commit:13806366
迭代协议成员进入实例模型（@@iterator 槽存在且可调用）	dup:harvest-dts 聚合矩阵	commit:13806366
具名成员不受影响（对照组：只有计算成员名被丢）	dup:harvest-dts 聚合矩阵	commit:13806366
异步迭代协议同样保留（@@asyncIterator）	dup:harvest-dts 聚合矩阵	commit:13806366
不可静态判定的计算成员名被跳过（不产出错误成员名，也不崩）	dup:harvest-dts 聚合矩阵	commit:13806366
计算成员名不影响具名成员的类型（不被覆盖成 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
带引号 / 连字符的键产出**合法**的 DSL（引号串形态）	dup:harvest-dts 聚合矩阵	commit:13806366
草稿产物真能过 `node --check`（改前：Unexpected token）	dup:harvest-dts 聚合矩阵	commit:13806366
`__proto__` 键走计算属性名（对象字面量的 __proto__ 会改原型）	dup:harvest-dts 聚合矩阵	commit:13806366
**抄进侧车后 `nudo check` 仍然绿**（改前：sidecar 加载失败 ⇒ exit 1）	dup:harvest-dts 聚合矩阵	commit:13806366
反向闸：语法非法的侧车**必定**加载失败（证明上一条不是永真断言）	dup:harvest-dts 聚合矩阵	commit:13806366
导出名撞 builder import ⇒ 走别名形态（草稿仍是合法 JS）	dup:harvest-dts 聚合矩阵	commit:13806366
草稿的返回位**不是** resolve 后的类型（外壳不被剥掉）	dup:harvest-dts 聚合矩阵	commit:13806366
该位的丢失**如实标注**（note + skipped 计数），不静默放宽	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同口径：Promise 外壳**保留**（promise<…>）	dup:harvest-dts 聚合矩阵	commit:13806366
方法成员进契约：`port: fn({}, number())`	dup:harvest-dts 聚合矩阵	commit:13806366
数字键成员也不被丢	dup:harvest-dts 聚合矩阵	commit:13806366
产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2345 同向）	dup:harvest-dts 聚合矩阵	commit:13806366
收割面同口径：方法成员在收割面也在（port: () => number）	dup:harvest-dts 聚合矩阵	commit:13806366
可选方法的槽位含 undefined（可能不存在，不是必定存在）	dup:harvest-dts 聚合矩阵	commit:13806366
可选方法与可选属性的可省性口径一致（两者都含 undefined）	dup:harvest-dts 聚合矩阵	commit:13806366
必选方法不被加上 undefined	dup:harvest-dts 聚合矩阵	commit:13806366
提升面同口径（可选方法提升出的模块成员也含 undefined）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：内联类型字面量的可选方法同口径（第二条成员收集路径）	dup:harvest-dts 聚合矩阵	commit:13806366
可选形参记进 optionalParams，必选元数 = TS minArgumentCount（1）	dup:harvest-dts 聚合矩阵	commit:13806366
rest 形参不是必选位（元数 0）	dup:harvest-dts 聚合矩阵	commit:13806366
对照：全必选签名不受影响（元数 2）	dup:harvest-dts 聚合矩阵	commit:13806366
磁盘投影往返保留 optionalParams（冷 / 热同元数）	dup:harvest-dts 聚合矩阵	commit:13806366
第二份声明的成员不丢（extra 在）	dup:harvest-dts 聚合矩阵	commit:13806366
声明顺序不影响成员集合	dup:harvest-dts 聚合矩阵	commit:13806366
具体 overload 在前：返回位保留具体类型（不是悬空 T / any）	dup:harvest-dts 聚合矩阵	commit:13806366
泛型 overload 在前：保留 α（可被实参绑定）	dup:harvest-dts 聚合矩阵	commit:13806366
两种声明顺序不被抹成静默 any（旧行为：(string) => T ⇒ any）	dup:harvest-dts 聚合矩阵	commit:13806366
数字 / 字符串 / const enum 都有成员面（不再是 unknown）	dup:harvest-dts 聚合矩阵	commit:13806366
无初始化器的成员按 TS 语义从 0 自增	dup:harvest-dts 聚合矩阵	commit:13806366
与契约草稿面同口径（两面不再矛盾）	dup:harvest-dts 聚合矩阵	commit:13806366
必选形态完成（基线）	dup:harvest-dts 聚合矩阵	commit:13806366
可选形态同样完成，且成员是 `L26 | undefined`	dup:harvest-dts 聚合矩阵	commit:13806366
导出名撞 builder import ⇒ 走别名形态（改前：export const number）	dup:harvest-dts 聚合矩阵	commit:13806366
草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）	dup:harvest-dts 聚合矩阵	commit:13806366
负控制：普通导出名仍是 export const <name>（不误改别名形态）	dup:harvest-dts 聚合矩阵	commit:13806366
```
