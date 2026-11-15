# packages/service/src/emit/__tests__/dts-projection.test.ts

模块套件：105 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"未声明的类 brand：降级为 unknown + 降级台账（改前：TS2304）"	"返回位不再是「从未声明的类型名」 可诊断：台账点名被降级的类名 dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"import 进来的类：类名保留 + 补 import type（不被误杀）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"import 进来的类：产物可编译（消费方能按该类使用）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"改前形态确实红（未声明的类型名 ⇒ TS2304）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"负控制：本地声明的类不变（Bug 517 口径：声明 + 类名保留）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"负控制：TS 全局类型名 brand 逐字不变（与 zod 白名单同名单）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"负控制：纯投影面（无模块面）保持既有口径（类名原样）"	"dts 面不得产出「从未声明的类型名」（用户类 brand）。 改前：`absToTSType(brand(\"Counter\"))` = `Counter` ⇒ 产物里那个类名**从未 声明** ⇒ 消费方 tsc 报 **TS2304**（\"Cannot find name 'Counter'\"）。"	没测该层	keep	keep	—
"`class B extends A` 在产物里带超类；本类字段声明、继承字段不重复"	"继承来的字段不在子类里重复声明（语义重复 + 类型面自相矛盾） 类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器） ⇒ 产物里 `class B extends A` 变成 `class B`： - `const b: A = new B()` 报 TS2741（缺 A 的成员）； - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明** ⇒ `b.y` 也是 TS2339。"	夹具漏形态	keep	keep	—
"消费方：子类可赋给父类类型；继承方法与字段可访问"	"类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器） ⇒ 产物里 `class B extends A` 变成 `class B`： - `const b: A = new B()` 报 TS2741（缺 A 的成员）； - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明** ⇒ `b.y` 也是 TS2339。"	夹具漏形态	keep	keep	—
"类属性初始化器（`count = 3` / `label = \"p\"`）也进实例字段面"	"类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器） ⇒ 产物里 `class B extends A` 变成 `class B`： - `const b: A = new B()` 报 TS2741（缺 A 的成员）； - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明** ⇒ `b.y` 也是 TS2339。"	夹具漏形态	keep	keep	—
"负控制：`extends` 一个未声明的名字 ⇒ 不发射 extends（消费方零 TS2304）"	"── 负控制：不可解析的超类名不进产物（否则 TS2304）────────────── 类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器） ⇒ 产物里 `class B extends A` 变成 `class B`： - `const b: A = new B()` 报 TS2741（缺 A 的成员）； - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明** ⇒ `b.y` 也是 TS2339。"	夹具漏形态	keep	keep	—
"负控制：TS 全局构造器名（`extends Error`）照旧放行"	"类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器） ⇒ 产物里 `class B extends A` 变成 `class B`： - `const b: A = new B()` 报 TS2741（缺 A 的成员）； - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明** ⇒ `b.y` 也是 TS2339。"	夹具漏形态	keep	keep	—
"只声明 static only（没有同名实例方法）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"同名 static + instance 同时存在时两者都保留（既有口径不回退）"	"本断言的目标是「同名 static / instance 两条声明都在」，类型精度 跟随分析面（与 dts 单元面对齐），不再钉死 unknown。 缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	夹具漏形态	keep	keep	—
"static 字段 / 访问器 / 实例字段都在"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端读这些成员通过 tsc（改前 TS2339 ×2）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"类头带 abstract、抽象成员带源码返回注解"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端可用继承来的抽象成员（改前 TS2339）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端 new Shape() 被拦下（改前可实例化抽象类）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"注解字段用源码声明类型（同类初始化器字段不受影响）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端字段读取通过 tsc（改前 TS2322 ×3）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"字段带源码类型 / 访问修饰符 / readonly，构造器形参类型也保真"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端 `new Account(...).id` 通过 tsc（改前 TS2339）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"字段与方法都带访问修饰符"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端读私有面被 tsc 拦下（改前假绿）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"两个含 # 私有字段的类都带 #private;"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"A / B 不可结构互赋（改前 exit 0，源码侧 TS2741）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"发射 `[key: string]: …;`"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"消费端索引访问通过 tsc（改前 TS7052 / TS2339）"	"缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。"	没测该层	keep	keep	—
"契约声明 optional 的**尾部**形参渲染成 `x?: T`"	"契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的 `.d.ts` **拒绝契约允许的调用**（实测 TS2345）； 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源， **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。"	没测该层	keep	keep	—
"契约声明 optional 的**中间**形参渲染成 `T | undefined`（TS1016：`?` 不能跟在必填位后）"	"契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的 `.d.ts` **拒绝契约允许的调用**（实测 TS2345）； 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源， **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。"	没测该层	keep	keep	—
"消费方按契约允许的调用（传 undefined / 省略）不再吃 TS2345"	"契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的 `.d.ts` **拒绝契约允许的调用**（实测 TS2345）； 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源， **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。"	没测该层	keep	keep	—
"负控制：契约未申报可选的形参仍是必填"	"契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的 `.d.ts` **拒绝契约允许的调用**（实测 TS2345）； 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源， **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。"	没测该层	keep	keep	—
"负控制：契约覆盖 ⇒ 观测元数不再把契约位标成可选（不裁剪契约义务）"	"契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的 `.d.ts` **拒绝契约允许的调用**（实测 TS2345）； 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源， **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。"	没测该层	keep	keep	—
"契约的字段级条目聚合成该形参的形状（不再是 unknown）"	"**dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的 `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查** （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod / standard 三面**都保真**。 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join** （`contractByParam.get(bare)`）。"	没测该层	keep	keep	—
"消费方错误调用不再静默放行（改前 exit 0）"	"对象字面量内的类型不匹配 ⇒ TS2322（整体不匹配 ⇒ TS2345） **dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的 `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查** （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod / standard 三面**都保真**。 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join** （`contractByParam.g"	夹具漏形态	keep	keep	—
"负控制：契约缺该绑定时回落求值占位（不产出不可编译的模式形态）"	"契约只覆盖 a —— b 无契约证据 ⇒ 模式形态与类型不匹配 ⇒ 回落占位名 **dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的 `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查** （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod / standard 三面**都保真**。 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join** （`contractByParam"	夹具漏形态	keep	keep	—
"负控制：具名形参的契约投影不受影响"	"**dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的 `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查** （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod / standard 三面**都保真**。 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join** （`contractByParam.get(bare)`）。"	没测该层	keep	keep	—
"dts 不再把合法 Unicode 绑定名洗成 ASCII"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"消费端 `import { café }` 通过 tsc（改前 TS2305）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"不是 `declare class default`（保留字当类名）"	"本例钉的是匿名默认类的**类名合法性**，不钉返回类型。 缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"产物过 tsc --noEmit --strict（改前 TS1005）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"用 `export * as ns from`，不是 `export { * as ns } from`"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"产物过 tsc（改前 TS1003/1005/1128/1434）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"发射 default 值绑定（改前整条消失）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"消费端 `import v from` 通过 tsc（改前 TS1192）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"顶层类型声明原文镜像（namespace 内同名声明照旧保留）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"消费端 type import 通过 tsc（改前 TS2305）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"发射 `export declare const enum`（改前丢 const ⇒ 运行时 import 报错）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"消费端 tsc 通过且 const enum 成员可内联使用"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"`as \"a-b\"` 不丢引号"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"产物过 tsc（改前 TS1005×3）"	"缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。"	夹具漏形态	keep	keep	—
"保留 extends NS.Base 并补 import * as NS"	"同模块的 Identifier / default import 基类照旧保留 缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"消费端能访问继承来的 b()（改前 TS2339）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"函数声明带 <T> / <A, B>，类级 <T> 保留"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"消费端显式类型实参通过 tsc（改前 TS2558 ×2）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"类方法自己的 <U> 也保留"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"默认形参渲染成 `a?:`，不是 `a: … | undefined`"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"消费端 f() / c.m() 通过 tsc（改前 TS2555）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"构造器 / static 形参带 `?`（与实例位一致）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"消费端 new C() / C.make() 通过 tsc（改前 TS2554）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"`extends Base<string>` 不是 `extends Base`"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"产物自身过 tsc（改前 TS2314）"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"`class Box<T = string>` 不是 `class Box<T>`"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"裸泛型引用 `mk(): Box` 不再让产物 TS2314"	"缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。"	没测该层	keep	keep	—
"`export { foo as default, foo }` ⇒ 具名声明 + default 别名"	"同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现 （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的 `.d.ts` 里根本不存在： - default 名缺失 ⇒ 消费方 `import def from \"./m.js\"` 得到 `{}` ⇒ `error TS2349: This expression is not callable`； - 具名缺失 ⇒ `TS2305: has no exported member`。"	没测该层	keep	keep	—
"`export default foo;`（具名函数 + 表达式式 default）⇒ default 可调用"	"同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现 （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的 `.d.ts` 里根本不存在： - default 名缺失 ⇒ 消费方 `import def from \"./m.js\"` 得到 `{}` ⇒ `error TS2349: This expression is not callable`； - 具名缺失 ⇒ `TS2305: has no exported member`。"	没测该层	keep	keep	—
"类：具名 + default 双导出 ⇒ 两条导出都在（`new` 不报 TS2351）"	"同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现 （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的 `.d.ts` 里根本不存在： - default 名缺失 ⇒ 消费方 `import def from \"./m.js\"` 得到 `{}` ⇒ `error TS2349: This expression is not callable`； - 具名缺失 ⇒ `TS2305: has no exported member`。"	没测该层	keep	keep	—
"负控制：只有 default 一个导出名时保持 `export default function`"	"── 负控制：单导出的形态不该被改写 ────────────────────────────── 同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现 （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的 `.d.ts` 里根本不存在： - default 名缺失 ⇒ 消费方 `import def from \"./m.js\"` 得到 `{}` ⇒ `error TS2349: This expression is not callable`； -"	夹具漏形态	keep	keep	—
"负控制：别名导出仍按导出名声明（不额外发射内部名）"	"同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现 （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的 `.d.ts` 里根本不存在： - default 名缺失 ⇒ 消费方 `import def from \"./m.js\"` 得到 `{}` ⇒ `error TS2349: This expression is not callable`； - 具名缺失 ⇒ `TS2305: has no exported member`。"	没测该层	keep	keep	—
"契约声明 2 个形参、只有 1 个 case 实参 ⇒ 形参不被丢弃"	"dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默 丢弃**； 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒ `export declare function addAll(a: number): number;"	没测该层	keep	keep	—
"声明形参比观测元数多 ⇒ 尾部形参保留（无契约时落观测 widen）"	"类型词（number / any / unknown）随类型渲染面口径变化（无断言 case 指令 只是见证、不是域声明 ⇒ 产物面取推断域，）——本钉只关心**两个形参 都在产物里**（声明形参表的长度）。 dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默 丢弃**； 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒ `export declare function addAll(a: number): number;"	没测该层	keep	keep	—
"真分析面：声明 2 参 + 1 参 case ⇒ 两个形参都在产物里"	"dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默 丢弃**； 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒ `export declare function addAll(a: number): number;"	没测该层	keep	keep	—
"负控制：契约里多出、形参表对不上的参数名仍不投影（不撒 arity 谎言）"	"dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默 丢弃**； 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒ `export declare function addAll(a: number): number;"	没测该层	keep	keep	—
"rest 形参类型提升为数组（TS2370）"	"元素类型词（number / any）是 类型渲染面的口径：无断言的 case 指令只是见证、不是域声明 ⇒ 产物面取 推断域（）⇒ 元素落到 any。 tsc --noEmit --strict 实测（.d.ts 必须真能编译）"	没测该层	keep	keep	—
"rest 吞掉全部尾部实参：参数表不再追加 argN（TS1014）"	"tsc --noEmit --strict 实测（.d.ts 必须真能编译）"	没测该层	keep	keep	—
"产物真能过 tsc --noEmit --strict（改前：TS2370 / TS1014）"	"tsc --noEmit --strict 实测（.d.ts 必须真能编译）"	没测该层	keep	keep	—
"负控制：非 rest 形参仍是普通参数（不误提升为数组）"	"tsc --noEmit --strict 实测（.d.ts 必须真能编译）"	没测该层	keep	keep	—
"泛型函数的类型形参不放行：`id<T>(x: T)` ⇒ `id(x: unknown)` + 台账"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"多类型形参：`pair<A, B>` ⇒ 两个形参都回落观测口径（TS 投影面为 unknown）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"本地 interface 放行（原文镜像进产物）⇒ 注解保留、零台账"	"之后口径变更：模块级 `interface` / `type` 会被**原文镜像**进同一份 产物（见 dtsModuleSurface 的 typeDeclarations）⇒ 引用它是可解析的，不再回落。 真正的「不可解析」只剩类型形参与未声明 / 未导入的名字（上面两条已覆盖）。 dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类"	没测该层	keep	keep	—
"TS 全局类型名照旧放行（Date / Record / Promise 不产生台账）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"本地类（未导出）被注解引用 ⇒ 补 `declare class`（产物必须能解析该名）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"别的模块的 import ⇒ 补 `import type`（否则消费方 TS2304）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"泛型类保留类型形参槽（消费端 `new Box<string>` 不再 TS2558）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"产出的 .d.ts 真能过 tsc --noEmit --strict（BUG-168 的主症状是 TS2304）"	"dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析** ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export` exit 0、零台账； 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 —— 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 / TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；"	没测该层	keep	keep	—
"`export const` / `export let` 有声明，类型来自分析面绑定"	"模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒ 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时 确实有该导出（`.d.ts` 与运行时面相反）。"	没测该层	keep	keep	—
"TS `enum` 按 enum 声明（成员 + 字面量初始化器都在）"	"模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒ 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时 确实有该导出（`.d.ts` 与运行时面相反）。"	没测该层	keep	keep	—
"数值 enum：无初始化器成员照常落地（消费方零参 import 可用）"	"模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒ 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时 确实有该导出（`.d.ts` 与运行时面相反）。"	没测该层	keep	keep	—
"无分析绑定 ⇒ 声明仍是 `unknown` + 台账（不静默消失）"	"模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒ 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时 确实有该导出（`.d.ts` 与运行时面相反）。"	没测该层	keep	keep	—
"负控制：非导出的模块级 const 不进 .d.ts"	"── 负控制：非导出的模块值不进产物 ───────────────────────────── 模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒ 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时 确实有该导出（`.d.ts` 与运行时面相反）。"	没测该层	keep	keep	—
"对象槽 / 数组元素 / 元组按基类型投影，标量绑定照旧拓宽"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"消费端对合法写入不再报 TS2322 / TS2345"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"私有 interface / type 别名补进产物（tsc --declaration 同口径）"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"产物自身过 tsc（改前 TS2304 ×3）"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"类体带字段与方法（ambient 声明体合法）"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"消费端 new NS.C().v / .m() 通过 tsc（改前 TS2339 ×2）"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"readonly 字段 / as const 对象槽都带修饰符，字面量精度保留"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"消费端对只读值的写入被 tsc 拦下（改前假绿）"	"缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、 （readonly 类字段 / `as const`）。"	夹具漏形态	keep	keep	—
"元素域 / 回调入参共享同一变元；返回位复用回调返回变元（<a, b>）"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
"未被签名引用的变元不发射（ghost 位不产生悬空类型参数）"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
"契约可读注记：Contract: 行存在，且不参与类型面"	"注记不改变声明行的类型面 覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
"逐 arm 发射（声明序）且保留形参↔返回相关性"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
"可表达的 gt/ge 下界与 le/lt 上界生成检查"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
"不可表达的关系（x > y）诚实省略界（不回退成假精确）"	"覆盖： - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性** （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具； - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；"	夹具漏形态	keep	keep	—
```
