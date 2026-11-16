# packages/service/src/emit/__tests__/dts-projection.test.ts

模块套件：dts 投影面（声明形态 × 可编译性 × 负控制）。

审计：105 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
未声明的类 brand：降级为 unknown + 降级台账（改前：TS2304）；import 进来的类：类名保留 + 补 import type（不被误杀）；import 进来的类：产物可编译（消费方能按该类使用）；改前形态确实红（未声明的类型名 ⇒ TS2304）；负控制：本地声明的类不变（Bug 517 口径：声明 + 类名保留）；负控制：TS 全局类型名 brand 逐字不变（与 zod 白名单同名单）；负控制：纯投影面（无模块面）保持既有口径（类名原样）	dts-projection 聚合矩阵	没测该层	keep	keep	—
`class B extends A` 在产物里带超类；本类字段声明、继承字段不重复；消费方：子类可赋给父类类型；继承方法与字段可访问；类属性初始化器（`count = 3` / `label = "p"`）也进实例字段面；负控制：`extends` 一个未声明的名字 ⇒ 不发射 extends（消费方零 TS2304）；负控制：TS 全局构造器名（`extends Error`）照旧放行	dts-projection 聚合矩阵	没测该层	keep	keep	—
只声明 static only（没有同名实例方法）；同名 static + instance 同时存在时两者都保留（既有口径不回退）	dts-projection 聚合矩阵	没测该层	keep	keep	—
static 字段 / 访问器 / 实例字段都在；消费端读这些成员通过 tsc（改前 TS2339 ×2）	dts-projection 聚合矩阵	没测该层	keep	keep	—
类头带 abstract、抽象成员带源码返回注解；消费端可用继承来的抽象成员（改前 TS2339）；消费端 new Shape() 被拦下（改前可实例化抽象类）	dts-projection 聚合矩阵	没测该层	keep	keep	—
注解字段用源码声明类型（同类初始化器字段不受影响）；消费端字段读取通过 tsc（改前 TS2322 ×3）	dts-projection 聚合矩阵	没测该层	keep	keep	—
字段带源码类型 / 访问修饰符 / readonly，构造器形参类型也保真；消费端 `new Account(...).id` 通过 tsc（改前 TS2339）	dts-projection 聚合矩阵	没测该层	keep	keep	—
字段与方法都带访问修饰符；消费端读私有面被 tsc 拦下（改前假绿）	dts-projection 聚合矩阵	没测该层	keep	keep	—
两个含 # 私有字段的类都带 #private;；A / B 不可结构互赋（改前 exit 0，源码侧 TS2741）	dts-projection 聚合矩阵	没测该层	keep	keep	—
发射 `[key: string]: …;`；消费端索引访问通过 tsc（改前 TS7052 / TS2339）	dts-projection 聚合矩阵	没测该层	keep	keep	—
契约声明 optional 的**尾部**形参渲染成 `x?: T`；契约声明 optional 的**中间**形参渲染成 `T | undefined`（TS1016：`?` 不能跟在必填位后）；消费方按契约允许的调用（传 undefined / 省略）不再吃 TS2345；负控制：契约未申报可选的形参仍是必填；负控制：契约覆盖 ⇒ 观测元数不再把契约位标成可选（不裁剪契约义务）	dts-projection 聚合矩阵	没测该层	keep	keep	—
契约的字段级条目聚合成该形参的形状（不再是 unknown）；消费方错误调用不再静默放行（改前 exit 0）；负控制：契约缺该绑定时回落求值占位（不产出不可编译的模式形态）；负控制：具名形参的契约投影不受影响	dts-projection 聚合矩阵	没测该层	keep	keep	—
dts 不再把合法 Unicode 绑定名洗成 ASCII；消费端 `import { café }` 通过 tsc（改前 TS2305）	dts-projection 聚合矩阵	没测该层	keep	keep	—
不是 `declare class default`（保留字当类名）；产物过 tsc --noEmit --strict（改前 TS1005）	dts-projection 聚合矩阵	没测该层	keep	keep	—
用 `export * as ns from`，不是 `export { * as ns } from`；产物过 tsc（改前 TS1003/1005/1128/1434）	dts-projection 聚合矩阵	没测该层	keep	keep	—
发射 default 值绑定（改前整条消失）；消费端 `import v from` 通过 tsc（改前 TS1192）	dts-projection 聚合矩阵	没测该层	keep	keep	—
顶层类型声明原文镜像（namespace 内同名声明照旧保留）；消费端 type import 通过 tsc（改前 TS2305）	dts-projection 聚合矩阵	没测该层	keep	keep	—
发射 `export declare const enum`（改前丢 const ⇒ 运行时 import 报错）；消费端 tsc 通过且 const enum 成员可内联使用	dts-projection 聚合矩阵	没测该层	keep	keep	—
`as "a-b"` 不丢引号；产物过 tsc（改前 TS1005×3）	dts-projection 聚合矩阵	没测该层	keep	keep	—
保留 extends NS.Base 并补 import * as NS；消费端能访问继承来的 b()（改前 TS2339）	dts-projection 聚合矩阵	没测该层	keep	keep	—
函数声明带 <T> / <A, B>，类级 <T> 保留；消费端显式类型实参通过 tsc（改前 TS2558 ×2）；类方法自己的 <U> 也保留	dts-projection 聚合矩阵	没测该层	keep	keep	—
默认形参渲染成 `a?:`，不是 `a: … | undefined`；消费端 f() / c.m() 通过 tsc（改前 TS2555）	dts-projection 聚合矩阵	没测该层	keep	keep	—
构造器 / static 形参带 `?`（与实例位一致）；消费端 new C() / C.make() 通过 tsc（改前 TS2554）	dts-projection 聚合矩阵	没测该层	keep	keep	—
`extends Base<string>` 不是 `extends Base`；产物自身过 tsc（改前 TS2314）	dts-projection 聚合矩阵	没测该层	keep	keep	—
`class Box<T = string>` 不是 `class Box<T>`；裸泛型引用 `mk(): Box` 不再让产物 TS2314	dts-projection 聚合矩阵	没测该层	keep	keep	—
`export { foo as default, foo }` ⇒ 具名声明 + default 别名；`export default foo;`（具名函数 + 表达式式 default）⇒ default 可调用；类：具名 + default 双导出 ⇒ 两条导出都在（`new` 不报 TS2351）；负控制：只有 default 一个导出名时保持 `export default function`；负控制：别名导出仍按导出名声明（不额外发射内部名）	dts-projection 聚合矩阵	没测该层	keep	keep	—
契约声明 2 个形参、只有 1 个 case 实参 ⇒ 形参不被丢弃；声明形参比观测元数多 ⇒ 尾部形参保留（无契约时落观测 widen）；真分析面：声明 2 参 + 1 参 case ⇒ 两个形参都在产物里；负控制：契约里多出、形参表对不上的参数名仍不投影（不撒 arity 谎言）	dts-projection 聚合矩阵	没测该层	keep	keep	—
rest 形参类型提升为数组（TS2370）；rest 吞掉全部尾部实参：参数表不再追加 argN（TS1014）；产物真能过 tsc --noEmit --strict（改前：TS2370 / TS1014）；负控制：非 rest 形参仍是普通参数（不误提升为数组）	dts-projection 聚合矩阵	没测该层	keep	keep	—
泛型函数的类型形参不放行：`id<T>(x: T)` ⇒ `id(x: unknown)` + 台账；多类型形参：`pair<A, B>` ⇒ 两个形参都回落观测口径（TS 投影面为 unknown）；本地 interface 放行（原文镜像进产物）⇒ 注解保留、零台账；TS 全局类型名照旧放行（Date / Record / Promise 不产生台账）；本地类（未导出）被注解引用 ⇒ 补 `declare class`（产物必须能解析该名）；别的模块的 import ⇒	dts-projection 聚合矩阵	没测该层	keep	keep	—
`export const` / `export let` 有声明，类型来自分析面绑定；TS `enum` 按 enum 声明（成员 + 字面量初始化器都在）；数值 enum：无初始化器成员照常落地（消费方零参 import 可用）；无分析绑定 ⇒ 声明仍是 `unknown` + 台账（不静默消失）；负控制：非导出的模块级 const 不进 .d.ts	dts-projection 聚合矩阵	没测该层	keep	keep	—
对象槽 / 数组元素 / 元组按基类型投影，标量绑定照旧拓宽；消费端对合法写入不再报 TS2322 / TS2345	dts-projection 聚合矩阵	没测该层	keep	keep	—
私有 interface / type 别名补进产物（tsc --declaration 同口径）；产物自身过 tsc（改前 TS2304 ×3）	dts-projection 聚合矩阵	没测该层	keep	keep	—
类体带字段与方法（ambient 声明体合法）；消费端 new NS.C().v / .m() 通过 tsc（改前 TS2339 ×2）	dts-projection 聚合矩阵	没测该层	keep	keep	—
readonly 字段 / as const 对象槽都带修饰符，字面量精度保留；消费端对只读值的写入被 tsc 拦下（改前假绿）	dts-projection 聚合矩阵	没测该层	keep	keep	—
元素域 / 回调入参共享同一变元；返回位复用回调返回变元（<a, b>）；未被签名引用的变元不发射（ghost 位不产生悬空类型参数）；契约可读注记：Contract: 行存在，且不参与类型面	dts-projection 聚合矩阵	没测该层	keep	keep	—
"逐 arm 发射（声明序）且保留形参↔返回相关性"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面； 断言：expect(ts).toBe(\"{ (a0: string): number; (a0: number): string }\");"	夹具漏形态	keep	keep	—
可表达的 gt/ge 下界与 le/lt 上界生成检查；不可表达的关系（x > y）诚实省略界（不回退成假精确）	dts-projection 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
未声明的类 brand：降级为 unknown + 降级台账（改前：TS2304）	dup:dts-projection 聚合矩阵	commit:8fa85177
import 进来的类：类名保留 + 补 import type（不被误杀）	dup:dts-projection 聚合矩阵	commit:8fa85177
import 进来的类：产物可编译（消费方能按该类使用）	dup:dts-projection 聚合矩阵	commit:8fa85177
改前形态确实红（未声明的类型名 ⇒ TS2304）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：本地声明的类不变（Bug 517 口径：声明 + 类名保留）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：TS 全局类型名 brand 逐字不变（与 zod 白名单同名单）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：纯投影面（无模块面）保持既有口径（类名原样）	dup:dts-projection 聚合矩阵	commit:8fa85177
`class B extends A` 在产物里带超类；本类字段声明、继承字段不重复	dup:dts-projection 聚合矩阵	commit:8fa85177
消费方：子类可赋给父类类型；继承方法与字段可访问	dup:dts-projection 聚合矩阵	commit:8fa85177
类属性初始化器（`count = 3` / `label = "p"`）也进实例字段面	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：`extends` 一个未声明的名字 ⇒ 不发射 extends（消费方零 TS2304）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：TS 全局构造器名（`extends Error`）照旧放行	dup:dts-projection 聚合矩阵	commit:8fa85177
只声明 static only（没有同名实例方法）	dup:dts-projection 聚合矩阵	commit:8fa85177
同名 static + instance 同时存在时两者都保留（既有口径不回退）	dup:dts-projection 聚合矩阵	commit:8fa85177
static 字段 / 访问器 / 实例字段都在	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端读这些成员通过 tsc（改前 TS2339 ×2）	dup:dts-projection 聚合矩阵	commit:8fa85177
类头带 abstract、抽象成员带源码返回注解	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端可用继承来的抽象成员（改前 TS2339）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 new Shape() 被拦下（改前可实例化抽象类）	dup:dts-projection 聚合矩阵	commit:8fa85177
注解字段用源码声明类型（同类初始化器字段不受影响）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端字段读取通过 tsc（改前 TS2322 ×3）	dup:dts-projection 聚合矩阵	commit:8fa85177
字段带源码类型 / 访问修饰符 / readonly，构造器形参类型也保真	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 `new Account(...).id` 通过 tsc（改前 TS2339）	dup:dts-projection 聚合矩阵	commit:8fa85177
字段与方法都带访问修饰符	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端读私有面被 tsc 拦下（改前假绿）	dup:dts-projection 聚合矩阵	commit:8fa85177
两个含 # 私有字段的类都带 #private;	dup:dts-projection 聚合矩阵	commit:8fa85177
A / B 不可结构互赋（改前 exit 0，源码侧 TS2741）	dup:dts-projection 聚合矩阵	commit:8fa85177
发射 `[key: string]: …;`	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端索引访问通过 tsc（改前 TS7052 / TS2339）	dup:dts-projection 聚合矩阵	commit:8fa85177
契约声明 optional 的**尾部**形参渲染成 `x?: T`	dup:dts-projection 聚合矩阵	commit:8fa85177
契约声明 optional 的**中间**形参渲染成 `T | undefined`（TS1016：`?` 不能跟在必填位后）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费方按契约允许的调用（传 undefined / 省略）不再吃 TS2345	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：契约未申报可选的形参仍是必填	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：契约覆盖 ⇒ 观测元数不再把契约位标成可选（不裁剪契约义务）	dup:dts-projection 聚合矩阵	commit:8fa85177
契约的字段级条目聚合成该形参的形状（不再是 unknown）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费方错误调用不再静默放行（改前 exit 0）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：契约缺该绑定时回落求值占位（不产出不可编译的模式形态）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：具名形参的契约投影不受影响	dup:dts-projection 聚合矩阵	commit:8fa85177
dts 不再把合法 Unicode 绑定名洗成 ASCII	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 `import { café }` 通过 tsc（改前 TS2305）	dup:dts-projection 聚合矩阵	commit:8fa85177
不是 `declare class default`（保留字当类名）	dup:dts-projection 聚合矩阵	commit:8fa85177
产物过 tsc --noEmit --strict（改前 TS1005）	dup:dts-projection 聚合矩阵	commit:8fa85177
用 `export * as ns from`，不是 `export { * as ns } from`	dup:dts-projection 聚合矩阵	commit:8fa85177
产物过 tsc（改前 TS1003/1005/1128/1434）	dup:dts-projection 聚合矩阵	commit:8fa85177
发射 default 值绑定（改前整条消失）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 `import v from` 通过 tsc（改前 TS1192）	dup:dts-projection 聚合矩阵	commit:8fa85177
顶层类型声明原文镜像（namespace 内同名声明照旧保留）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 type import 通过 tsc（改前 TS2305）	dup:dts-projection 聚合矩阵	commit:8fa85177
发射 `export declare const enum`（改前丢 const ⇒ 运行时 import 报错）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 tsc 通过且 const enum 成员可内联使用	dup:dts-projection 聚合矩阵	commit:8fa85177
`as "a-b"` 不丢引号	dup:dts-projection 聚合矩阵	commit:8fa85177
产物过 tsc（改前 TS1005×3）	dup:dts-projection 聚合矩阵	commit:8fa85177
保留 extends NS.Base 并补 import * as NS	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端能访问继承来的 b()（改前 TS2339）	dup:dts-projection 聚合矩阵	commit:8fa85177
函数声明带 <T> / <A, B>，类级 <T> 保留	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端显式类型实参通过 tsc（改前 TS2558 ×2）	dup:dts-projection 聚合矩阵	commit:8fa85177
类方法自己的 <U> 也保留	dup:dts-projection 聚合矩阵	commit:8fa85177
默认形参渲染成 `a?:`，不是 `a: … | undefined`	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 f() / c.m() 通过 tsc（改前 TS2555）	dup:dts-projection 聚合矩阵	commit:8fa85177
构造器 / static 形参带 `?`（与实例位一致）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 new C() / C.make() 通过 tsc（改前 TS2554）	dup:dts-projection 聚合矩阵	commit:8fa85177
`extends Base<string>` 不是 `extends Base`	dup:dts-projection 聚合矩阵	commit:8fa85177
产物自身过 tsc（改前 TS2314）	dup:dts-projection 聚合矩阵	commit:8fa85177
`class Box<T = string>` 不是 `class Box<T>`	dup:dts-projection 聚合矩阵	commit:8fa85177
裸泛型引用 `mk(): Box` 不再让产物 TS2314	dup:dts-projection 聚合矩阵	commit:8fa85177
`export { foo as default, foo }` ⇒ 具名声明 + default 别名	dup:dts-projection 聚合矩阵	commit:8fa85177
`export default foo;`（具名函数 + 表达式式 default）⇒ default 可调用	dup:dts-projection 聚合矩阵	commit:8fa85177
类：具名 + default 双导出 ⇒ 两条导出都在（`new` 不报 TS2351）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：只有 default 一个导出名时保持 `export default function`	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：别名导出仍按导出名声明（不额外发射内部名）	dup:dts-projection 聚合矩阵	commit:8fa85177
契约声明 2 个形参、只有 1 个 case 实参 ⇒ 形参不被丢弃	dup:dts-projection 聚合矩阵	commit:8fa85177
声明形参比观测元数多 ⇒ 尾部形参保留（无契约时落观测 widen）	dup:dts-projection 聚合矩阵	commit:8fa85177
真分析面：声明 2 参 + 1 参 case ⇒ 两个形参都在产物里	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：契约里多出、形参表对不上的参数名仍不投影（不撒 arity 谎言）	dup:dts-projection 聚合矩阵	commit:8fa85177
rest 形参类型提升为数组（TS2370）	dup:dts-projection 聚合矩阵	commit:8fa85177
rest 吞掉全部尾部实参：参数表不再追加 argN（TS1014）	dup:dts-projection 聚合矩阵	commit:8fa85177
产物真能过 tsc --noEmit --strict（改前：TS2370 / TS1014）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：非 rest 形参仍是普通参数（不误提升为数组）	dup:dts-projection 聚合矩阵	commit:8fa85177
泛型函数的类型形参不放行：`id<T>(x: T)` ⇒ `id(x: unknown)` + 台账	dup:dts-projection 聚合矩阵	commit:8fa85177
多类型形参：`pair<A, B>` ⇒ 两个形参都回落观测口径（TS 投影面为 unknown）	dup:dts-projection 聚合矩阵	commit:8fa85177
本地 interface 放行（原文镜像进产物）⇒ 注解保留、零台账	dup:dts-projection 聚合矩阵	commit:8fa85177
TS 全局类型名照旧放行（Date / Record / Promise 不产生台账）	dup:dts-projection 聚合矩阵	commit:8fa85177
本地类（未导出）被注解引用 ⇒ 补 `declare class`（产物必须能解析该名）	dup:dts-projection 聚合矩阵	commit:8fa85177
别的模块的 import ⇒ 补 `import type`（否则消费方 TS2304）	dup:dts-projection 聚合矩阵	commit:8fa85177
泛型类保留类型形参槽（消费端 `new Box<string>` 不再 TS2558）	dup:dts-projection 聚合矩阵	commit:8fa85177
产出的 .d.ts 真能过 tsc --noEmit --strict（BUG-168 的主症状是 TS2304）	dup:dts-projection 聚合矩阵	commit:8fa85177
`export const` / `export let` 有声明，类型来自分析面绑定	dup:dts-projection 聚合矩阵	commit:8fa85177
TS `enum` 按 enum 声明（成员 + 字面量初始化器都在）	dup:dts-projection 聚合矩阵	commit:8fa85177
数值 enum：无初始化器成员照常落地（消费方零参 import 可用）	dup:dts-projection 聚合矩阵	commit:8fa85177
无分析绑定 ⇒ 声明仍是 `unknown` + 台账（不静默消失）	dup:dts-projection 聚合矩阵	commit:8fa85177
负控制：非导出的模块级 const 不进 .d.ts	dup:dts-projection 聚合矩阵	commit:8fa85177
对象槽 / 数组元素 / 元组按基类型投影，标量绑定照旧拓宽	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端对合法写入不再报 TS2322 / TS2345	dup:dts-projection 聚合矩阵	commit:8fa85177
私有 interface / type 别名补进产物（tsc --declaration 同口径）	dup:dts-projection 聚合矩阵	commit:8fa85177
产物自身过 tsc（改前 TS2304 ×3）	dup:dts-projection 聚合矩阵	commit:8fa85177
类体带字段与方法（ambient 声明体合法）	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端 new NS.C().v / .m() 通过 tsc（改前 TS2339 ×2）	dup:dts-projection 聚合矩阵	commit:8fa85177
readonly 字段 / as const 对象槽都带修饰符，字面量精度保留	dup:dts-projection 聚合矩阵	commit:8fa85177
消费端对只读值的写入被 tsc 拦下（改前假绿）	dup:dts-projection 聚合矩阵	commit:8fa85177
元素域 / 回调入参共享同一变元；返回位复用回调返回变元（<a, b>）	dup:dts-projection 聚合矩阵	commit:8fa85177
未被签名引用的变元不发射（ghost 位不产生悬空类型参数）	dup:dts-projection 聚合矩阵	commit:8fa85177
契约可读注记：Contract: 行存在，且不参与类型面	dup:dts-projection 聚合矩阵	commit:8fa85177
可表达的 gt/ge 下界与 le/lt 上界生成检查	dup:dts-projection 聚合矩阵	commit:8fa85177
不可表达的关系（x > y）诚实省略界（不回退成假精确）	dup:dts-projection 聚合矩阵	commit:8fa85177
```
