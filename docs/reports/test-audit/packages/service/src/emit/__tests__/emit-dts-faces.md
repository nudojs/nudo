# packages/service/src/emit/__tests__/emit-dts-faces.test.ts

模块套件：emit dts/声明槽位/可选性/迭代器投影面。

审计：79 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
形态①：export default function named ⇒ 导出名是 default（不是具名导出）；形态②：export default class K ⇒ 导出名是 default（类不被降成模块级函数）；形态③：匿名 default（export default function (x)）⇒ 导出名是 default；形态④：箭头 default（export default (x) => …）⇒ 导出名是 default；形态④′：const + expo	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
普查面只有一条 C.m；dts 类体：实例方法一条 + 静态方法一条（无重复成员）；dts 产物里不出现模块级的 C_m 声明（类成员不是模块级导出）	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
shape 里不再出现 __proto__ 键（zod v4 会跳过它 ⇒ 声明了也不校验）；用 .superRefine 校验自有数据属性（缺键 ⇒ required）；值校验走内层 schema 的 safeParse（不是整条放行）；optional 槽：缺席不报错，但值错了仍报错；台账留痕：__proto__ 的降级进 dropped（不得静默假绿）；standard 面（同一份 Abs）要求自有 __proto__：真值过、缺键/错值不过；负控制：普通对象不受影响（	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
数据源：FormalParam.optional ≡ 源码（JS 默认值 ∪ TS `?`）；dts 面：可省位印 `?`（消费端 `f(1)` 不再 TS2554）；standard 面：`{ a }` 通过、缺 `a` 仍报 required；zod 面：可选槽渲染 `.optional()`（槽可选性由同一 FormalParam 驱动）；zod 面（入口角色表）：`unifiedParamFace` 把 `b?` 判为可省	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
导出面（check 入口表 / 侧车绑定 / dts 裁剪同源）含 NS 与其运行时成员键；dts 模块面登记 NS（导出名 → 本地绑定）；`.d.ts` 发射 `export declare namespace NS { … }`（消费端 import 不再 TS2305）	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
dts 形参位：内部槽不进结构字段（改前："#priv" / "@@iterator" 直出）；dts 类字段：私有字段不进 declare class 类体；schema 单值面：内部槽不进 zod 对象；schema 模块面（zod）：内部槽不进产物；standard 模块面：内部槽不进产物；schema 形状兜底路径（open 对象）：内部槽不进产物；负控制：非 internal 槽逐字不变	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
固化后的无断言观测见证不得独占返回面（返回面由推断域承担）；负控制：手写断言（=> 3）合法地定义返回面（修 511 不得动这一条）；负控制：无指令的函数返回面不受影响（entry@ 面）；emitter 侧：固化写出的见证是「观测」而非「断言」（指令里没有 => expected）；emitter 侧：固化产物可被 parser 读回，且不带期望值	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
Bug 514：default（匿名 / 箭头）导出进 dts；Bug 514：CJS 绑定（exports.compute）进 dts；Bug 514：const + export list 绑定进 dts；Bug 515：default 具名导出写成 export default function；Bug 515：别名导出按导出名声明（internal 不是导出名）；Bug 517：brand 引用的类被声明（不再 TS2304）；Bug 518：类方法不是模块级导出（没	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
带默认值的形参渲染成可选（无调用证据时也是）；有调用证据时形参表不缩水（观测元数不再裁剪声明形参表）；默认值为 undefined 的形参同样可选；Bug 553：消费方按实现允许的零参调用不再吃 TS2554；负控制：无默认值的形参仍是必填（不假造可选性）	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
optional 槽渲染成 TS 可选属性 `k?: T`（不再是 `k: T | undefined`）；负控制：必填槽仍是必填（不误伤 `k: T`）；两层嵌套的 optional 槽同样带 `?`（任意深度成立）；消费方省略可选键不再吃 TS2345 / TS2741（改前：键被声明为必需）；负控制：必填键缺失仍报 TS2345（可选性投影不得放宽必填键）	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
库函数版：继承来的键算在场，真缺键报 required；生成产物版：与库函数版同口径；负控制：Object.prototype 污染键算缺键；显式 undefined 仍与缺键有别	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
同步生成器 → Generator<T>（元素类型取数字下标元素槽）；异步生成器 → AsyncGenerator<T>；负控制：普通数据对象仍是结构体（不误判成迭代器）；内部槽不进结构字段（core format 面同口径：internal 槽不可见）；端到端：生成器函数的 dts 返回 Generator，for…of 消费方过 tsc；改前形态确实红（结构体 ⇒ TS2488）	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
契约参数绑不上形参时：形参表照旧、契约参数另列并显式标注；跨 verb 一致：契约面的形参表与 nudo check 签名面同源；负控制：契约参数与形参同名时行为不变（落在形参槽位、无另列）；负控制：契约多出的参数同样另列，不顶替形参；负控制：无契约（implicit 档）行为不变	emit-dts-faces 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
形态①：export default function named ⇒ 导出名是 default（不是具名导出）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
形态②：export default class K ⇒ 导出名是 default（类不被降成模块级函数）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
形态③：匿名 default（export default function (x)）⇒ 导出名是 default	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
形态④：箭头 default（export default (x) => …）⇒ 导出名是 default	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
形态④′：const + export default arrow ⇒ 导出名是 default（本地名不作导出名）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
模块面：default 的导出绑定（导出名 → 本地绑定名）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
模块面：匿名 / 箭头 default 没有本地绑定名	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：非 default 的具名导出仍是 export declare function（导出面过滤不变）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：未导出的本地函数不进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
普查面只有一条 C.m	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 类体：实例方法一条 + 静态方法一条（无重复成员）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 产物里不出现模块级的 C_m 声明（类成员不是模块级导出）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
shape 里不再出现 __proto__ 键（zod v4 会跳过它 ⇒ 声明了也不校验）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
用 .superRefine 校验自有数据属性（缺键 ⇒ required）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
值校验走内层 schema 的 safeParse（不是整条放行）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
optional 槽：缺席不报错，但值错了仍报错	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
台账留痕：__proto__ 的降级进 dropped（不得静默假绿）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
standard 面（同一份 Abs）要求自有 __proto__：真值过、缺键/错值不过	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：普通对象不受影响（不生成 superRefine）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
数据源：FormalParam.optional ≡ 源码（JS 默认值 ∪ TS `?`）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 面：可省位印 `?`（消费端 `f(1)` 不再 TS2554）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
standard 面：`{ a }` 通过、缺 `a` 仍报 required	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
zod 面：可选槽渲染 `.optional()`（槽可选性由同一 FormalParam 驱动）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
zod 面（入口角色表）：`unifiedParamFace` 把 `b?` 判为可省	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
导出面（check 入口表 / 侧车绑定 / dts 裁剪同源）含 NS 与其运行时成员键	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 模块面登记 NS（导出名 → 本地绑定）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
`.d.ts` 发射 `export declare namespace NS { … }`（消费端 import 不再 TS2305）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 形参位：内部槽不进结构字段（改前："#priv" / "@@iterator" 直出）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
dts 类字段：私有字段不进 declare class 类体	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
schema 单值面：内部槽不进 zod 对象	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
schema 模块面（zod）：内部槽不进产物	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
standard 模块面：内部槽不进产物	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
schema 形状兜底路径（open 对象）：内部槽不进产物	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：非 internal 槽逐字不变	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
固化后的无断言观测见证不得独占返回面（返回面由推断域承担）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：手写断言（=> 3）合法地定义返回面（修 511 不得动这一条）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：无指令的函数返回面不受影响（entry@ 面）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
emitter 侧：固化写出的见证是「观测」而非「断言」（指令里没有 => expected）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
emitter 侧：固化产物可被 parser 读回，且不带期望值	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 514：default（匿名 / 箭头）导出进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 514：CJS 绑定（exports.compute）进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 514：const + export list 绑定进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 515：default 具名导出写成 export default function	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 515：别名导出按导出名声明（internal 不是导出名）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 517：brand 引用的类被声明（不再 TS2304）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 518：类方法不是模块级导出（没有 C_m 顶层导出）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 550：类本身 + 构造器 + 静态方法进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 939：再导出面（export * from / export {x} from）进 dts	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
模块面：导出名表（导出名 → 本地绑定）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
模块面：类面（导出名 + 成员 + 构造器形参）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 550：default 类与别名类按导出名声明	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：非导出的顶层函数不进 dts（导出面过滤不变）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：未导出的类不进 dts（只有导出面进类声明）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：无模块面时类方法沿用历史 Class_method 投影（#494 口径）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：非法标识符名仍被清洗（#494 双保险不变）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
带默认值的形参渲染成可选（无调用证据时也是）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
有调用证据时形参表不缩水（观测元数不再裁剪声明形参表）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
默认值为 undefined 的形参同样可选	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
Bug 553：消费方按实现允许的零参调用不再吃 TS2554	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：无默认值的形参仍是必填（不假造可选性）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
optional 槽渲染成 TS 可选属性 `k?: T`（不再是 `k: T | undefined`）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：必填槽仍是必填（不误伤 `k: T`）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
两层嵌套的 optional 槽同样带 `?`（任意深度成立）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
消费方省略可选键不再吃 TS2345 / TS2741（改前：键被声明为必需）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：必填键缺失仍报 TS2345（可选性投影不得放宽必填键）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
库函数版：继承来的键算在场，真缺键报 required	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
生成产物版：与库函数版同口径	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：Object.prototype 污染键算缺键；显式 undefined 仍与缺键有别	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
同步生成器 → Generator<T>（元素类型取数字下标元素槽）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
异步生成器 → AsyncGenerator<T>	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：普通数据对象仍是结构体（不误判成迭代器）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
内部槽不进结构字段（core format 面同口径：internal 槽不可见）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
端到端：生成器函数的 dts 返回 Generator，for…of 消费方过 tsc	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
改前形态确实红（结构体 ⇒ TS2488）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
契约参数绑不上形参时：形参表照旧、契约参数另列并显式标注	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
跨 verb 一致：契约面的形参表与 nudo check 签名面同源	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：契约参数与形参同名时行为不变（落在形参槽位、无另列）	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：契约多出的参数同样另列，不顶替形参	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
负控制：无契约（implicit 档）行为不变	dup:emit-dts-faces 聚合矩阵	commit:8fa85177
```
