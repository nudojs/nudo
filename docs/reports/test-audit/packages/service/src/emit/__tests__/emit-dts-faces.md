# packages/service/src/emit/__tests__/emit-dts-faces.test.ts

模块套件：79 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"形态①：export default function named ⇒ 导出名是 default（不是具名导出）"	"不得凭空虚构运行时不存在的具名导出（改前的症状） `nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面*"	没测该层	keep	keep	—
"形态②：export default class K ⇒ 导出名是 default（类不被降成模块级函数）"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"形态③：匿名 default（export default function (x)）⇒ 导出名是 default"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"形态④：箭头 default（export default (x) => …）⇒ 导出名是 default"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"形态④′：const + export default arrow ⇒ 导出名是 default（本地名不作导出名）"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"模块面：default 的导出绑定（导出名 → 本地绑定名）"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"模块面：匿名 / 箭头 default 没有本地绑定名"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"负控制：非 default 的具名导出仍是 export declare function（导出面过滤不变）"	"── 负控制：本条修复不该波及的邻近形态 ────────────────────────── `nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projec"	夹具漏形态	keep	keep	—
"负控制：未导出的本地函数不进 dts"	"`nudo export --format dts` 把**具名 default 导出**投影成**具名导出** ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入 直接 **TS2349**。 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉： `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面** 取**导出名**（`export defaul"	没测该层	keep	keep	—
"普查面只有一条 C.m"	"core 侧的类方法普查名不再让**静态方法与实例方法同名**时共用一个名字 （`scan-top-functions.ts` 的 `collectClassMethods`； service 侧 `analyzer-ast.ts` 同口径）⇒ `analysis.functions` 里不再有两条 `C.m` ⇒ dts 类体里也不该再出现**重复的实例成员声明**。"	夹具漏形态	keep	keep	—
"dts 类体：实例方法一条 + 静态方法一条（无重复成员）"	"补齐类方法入口兜底后返回类型从 unknown 变精确值，故不钉返回类型。 core 侧的类方法普查名不再让**静态方法与实例方法同名**时共用一个名字 （`scan-top-functions.ts` 的 `collectClassMethods`； service 侧 `analyzer-ast.ts` 同口径）⇒ `analysis.functions` 里不再有两条 `C.m` ⇒ dts 类体里也不该再出现**重复的实例成员声明**。"	夹具漏形态	keep	keep	—
"dts 产物里不出现模块级的 C_m 声明（类成员不是模块级导出）"	"core 侧的类方法普查名不再让**静态方法与实例方法同名**时共用一个名字 （`scan-top-functions.ts` 的 `collectClassMethods`； service 侧 `analyzer-ast.ts` 同口径）⇒ `analysis.functions` 里不再有两条 `C.m` ⇒ dts 类体里也不该再出现**重复的实例成员声明**。"	夹具漏形态	keep	keep	—
"shape 里不再出现 __proto__ 键（zod v4 会跳过它 ⇒ 声明了也不校验）"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"用 .superRefine 校验自有数据属性（缺键 ⇒ required）"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"值校验走内层 schema 的 safeParse（不是整条放行）"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"optional 槽：缺席不报错，但值错了仍报错"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"台账留痕：__proto__ 的降级进 dropped（不得静默假绿）"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"standard 面（同一份 Abs）要求自有 __proto__：真值过、缺键/错值不过"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"负控制：普通对象不受影响（不生成 superRefine）"	"违约形态 ②：`__proto__` 值错"	夹具漏形态	keep	keep	—
"数据源：FormalParam.optional ≡ 源码（JS 默认值 ∪ TS `?`）"	"TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的 `kind:\"id\"` 位硬写 `optional: false`；"	没测该层	keep	keep	—
"dts 面：可省位印 `?`（消费端 `f(1)` 不再 TS2554）"	"TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的 `kind:\"id\"` 位硬写 `optional: false`；"	没测该层	keep	keep	—
"standard 面：`{ a }` 通过、缺 `a` 仍报 required"	"TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的 `kind:\"id\"` 位硬写 `optional: false`；"	没测该层	keep	keep	—
"zod 面：可选槽渲染 `.optional()`（槽可选性由同一 FormalParam 驱动）"	"TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的 `kind:\"id\"` 位硬写 `optional: false`；"	没测该层	keep	keep	—
"zod 面（入口角色表）：`unifiedParamFace` 把 `b?` 判为可省"	"唯一一条「一键实参」观测 ⇒ minArity = 1 ⇒ 下标 1 的可省性只能来自 TS `?` （契约面缺席、FormalParam 之外没有别的信息源）。 对照：无观测 ⇒ 既有的「按最少实参元数放宽」仍生效（不收紧） TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。"	没测该层	keep	keep	—
"导出面（check 入口表 / 侧车绑定 / dts 裁剪同源）含 NS 与其运行时成员键"	"interface 是纯类型 ⇒ 运行时不占键 负控制：普通导出面不受影响 `export namespace NS { … }` 在导出面 / dts 产物**完全不可见**， 而 nudo 自己的求值器把 namespace 物化成了运行时对象 ⇒ 引擎内部两套导出面 互相矛盾 ⇒ 消费端 `import { NS }` 报 **TS2305**。 根因（两处平行缺口）： - `packages/core/src/algebra/scan-named-exports.ts` 的 `ExportNamedDecl"	夹具漏形态	keep	keep	—
"dts 模块面登记 NS（导出名 → 本地绑定）"	"`export namespace NS { … }` 在导出面 / dts 产物**完全不可见**， 而 nudo 自己的求值器把 namespace 物化成了运行时对象 ⇒ 引擎内部两套导出面 互相矛盾 ⇒ 消费端 `import { NS }` 报 **TS2305**。 根因（两处平行缺口）： - `packages/core/src/algebra/scan-named-exports.ts` 的 `ExportNamedDeclaration` 声明分支只认 Function / Class / Var"	夹具漏形态	keep	keep	—
"`.d.ts` 发射 `export declare namespace NS { … }`（消费端 import 不再 TS2305）"	"成员：声明类型原样镜像（不是 any / unknown） 嵌套 namespace 递归落地 负控制：普通函数仍在（namespace 分支不得吞掉其它导出声明） `export namespace NS { … }` 在导出面 / dts 产物**完全不可见**， 而 nudo 自己的求值器把 namespace 物化成了运行时对象 ⇒ 引擎内部两套导出面 互相矛盾 ⇒ 消费端 `import { NS }` 报 **TS2305**。 根因（两处平行缺口）： - `packages/core/src/alge"	夹具漏形态	keep	keep	—
"dts 形参位：内部槽不进结构字段（改前：\"#priv\" / \"@@iterator\" 直出）"	"普通槽照旧 service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"dts 类字段：私有字段不进 declare class 类体"	"字段类型取**构造器形参域**（`this.v = v`，v 无约束 ⇒ unknown）——这是 的口径：单个构造点的 brand 观测（这里的 fake brand 说 number） 不得把公开字段钉成比构造器签名更窄的类型。 service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	夹具漏形态	keep	keep	—
"schema 单值面：内部槽不进 zod 对象"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"schema 模块面（zod）：内部槽不进产物"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"standard 模块面：内部槽不进产物"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"schema 形状兜底路径（open 对象）：内部槽不进产物"	"open 对象 ⇒ 约束投影放弃 ⇒ 走 service 的形状兜底（`absToSchemaShape`， 该路径原先不剔 internal 槽）； service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	夹具漏形态	keep	keep	—
"负控制：非 internal 槽逐字不变"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"固化后的无断言观测见证不得独占返回面（返回面由推断域承担）"	"固化后的源码：一条**无断言**的观测见证 @nudo:case \"call@F1usage.js:L2\" (1, 2) / 期望：观测见证只是下界证据，返回面仍由函数自身（entry@ 面）承担 ⇒ 与固化前、与 `nudo check` 的签名一致。 service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"负控制：手写断言（=> 3）合法地定义返回面（修 511 不得动这一条）"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"负控制：无指令的函数返回面不受影响（entry@ 面）"	"service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"emitter 侧：固化写出的见证是「观测」而非「断言」（指令里没有 => expected）"	"观测：只有实参，没有期望值 断言面由手写指令承担（`=> expected`）——与观测在文本上可区分 service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"emitter 侧：固化产物可被 parser 读回，且不带期望值"	"观测见证不带期望值 ⇒ 下游可据此把它与断言区分开 service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。 改前： export declare function f(x: { a: number;"	没测该层	keep	keep	—
"Bug 514：default（匿名 / 箭头）导出进 dts"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 514：CJS 绑定（exports.compute）进 dts"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 514：const + export list 绑定进 dts"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 515：default 具名导出写成 export default function"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 515：别名导出按导出名声明（internal 不是导出名）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 517：brand 引用的类被声明（不再 TS2304）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 518：类方法不是模块级导出（没有 C_m 顶层导出）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 550：类本身 + 构造器 + 静态方法进 dts"	"nudo 展示面仍显示 any（CLAUDE.md：入口无约束形参），两者作用域不同。 同上：实例方法返回类型精度随分析面提升，不钉死 unknown。 覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类"	夹具漏形态	keep	keep	—
"Bug 939：再导出面（export * from / export {x} from）进 dts"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"模块面：导出名表（导出名 → 本地绑定）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"模块面：类面（导出名 + 成员 + 构造器形参）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"Bug 550：default 类与别名类按导出名声明"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"负控制：非导出的顶层函数不进 dts（导出面过滤不变）"	"── 负控制：本条修复不该波及的邻近形态 ────────────────────────── 覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"负控制：未导出的类不进 dts（只有导出面进类声明）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"负控制：无模块面时类方法沿用历史 Class_method 投影（#494 口径）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"负控制：非法标识符名仍被清洗（#494 双保险不变）"	"覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级 `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。"	夹具漏形态	keep	keep	—
"带默认值的形参渲染成可选（无调用证据时也是）"	"类型词（unknown / any）是类型渲染面的口径（不在本分片职责内）—— 本钉只关心**可选性**标记。 553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒ `export declare function def(x: unknown): unknown;"	夹具漏形态	keep	keep	—
"有调用证据时形参表不缩水（观测元数不再裁剪声明形参表）"	"553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒ `export declare function def(x: unknown): unknown;"	夹具漏形态	keep	keep	—
"默认值为 undefined 的形参同样可选"	"553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒ `export declare function def(x: unknown): unknown;"	夹具漏形态	keep	keep	—
"Bug 553：消费方按实现允许的零参调用不再吃 TS2554"	"553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒ `export declare function def(x: unknown): unknown;"	夹具漏形态	keep	keep	—
"负控制：无默认值的形参仍是必填（不假造可选性）"	"553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒ `export declare function def(x: unknown): unknown;"	夹具漏形态	keep	keep	—
"optional 槽渲染成 TS 可选属性 `k?: T`（不再是 `k: T | undefined`）"	"tsc --noEmit --strict 实测（产物面必须真能编译）"	没测该层	keep	keep	—
"负控制：必填槽仍是必填（不误伤 `k: T`）"	"tsc --noEmit --strict 实测（产物面必须真能编译）"	没测该层	keep	keep	—
"两层嵌套的 optional 槽同样带 `?`（任意深度成立）"	"tsc --noEmit --strict 实测（产物面必须真能编译）"	没测该层	keep	keep	—
"消费方省略可选键不再吃 TS2345 / TS2741（改前：键被声明为必需）"	"tsc --noEmit --strict 实测（产物面必须真能编译）"	没测该层	keep	keep	—
"负控制：必填键缺失仍报 TS2345（可选性投影不得放宽必填键）"	"tsc --noEmit --strict 实测（产物面必须真能编译）"	没测该层	keep	keep	—
"库函数版：继承来的键算在场，真缺键报 required"	"继承来的 c（无自有 c）⇒ 在场（zod 面与 TS 结构类型都接受） 真缺键 ⇒ required standard 面「必填槽存在性」用**自有属性**判定（假红）。 修前：`Object.hasOwn(rec, key)` ⇒ 继承来的键被当成**缺键** ⇒ 运行时校验器 比 zod 面与 dts 面（TS 结构类型）**都严** ⇒ 对类型系统接受的值报红。"	没测该层	keep	keep	—
"生成产物版：与库函数版同口径"	"standard 面「必填槽存在性」用**自有属性**判定（假红）。 修前：`Object.hasOwn(rec, key)` ⇒ 继承来的键被当成**缺键** ⇒ 运行时校验器 比 zod 面与 dts 面（TS 结构类型）**都严** ⇒ 对类型系统接受的值报红。"	没测该层	keep	keep	—
"负控制：Object.prototype 污染键算缺键；显式 undefined 仍与缺键有别"	"槽名取 \"toString\"：原型污染键不算在场 ⇒ 报 required（不是「在场且值合法」） 显式 undefined 在场 ⇒ 走节点裁决（lit \"x\" 不匹配 ⇒ 类型错，不是 required） standard 面「必填槽存在性」用**自有属性**判定（假红）。 修前：`Object.hasOwn(rec, key)` ⇒ 继承来的键被当成**缺键** ⇒ 运行时校验器 比 zod 面与 dts 面（TS 结构类型）**都严** ⇒ 对类型系统接受的值报红。"	没测该层	keep	keep	—
"同步生成器 → Generator<T>（元素类型取数字下标元素槽）"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"异步生成器 → AsyncGenerator<T>"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"负控制：普通数据对象仍是结构体（不误判成迭代器）"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"内部槽不进结构字段（core format 面同口径：internal 槽不可见）"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"端到端：生成器函数的 dts 返回 Generator，for…of 消费方过 tsc"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"改前形态确实红（结构体 ⇒ TS2488）"	"改前： export declare function gen(x: unknown): { 0: unknown; ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。"	没测该层	keep	keep	—
"契约参数绑不上形参时：形参表照旧、契约参数另列并显式标注"	"形参表 = 声明形参表（不是契约里的 zzz） 契约里绑不上的参数另列一栏 旧病灶形态：契约参数名顶替形参名 - 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）； - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。"	夹具漏形态	keep	keep	—
"跨 verb 一致：契约面的形参表与 nudo check 签名面同源"	"check 面把绑不上的契约参数报成 nudo:contract-param-mismatch - 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）； - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。"	夹具漏形态	keep	keep	—
"负控制：契约参数与形参同名时行为不变（落在形参槽位、无另列）"	"- 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）； - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。"	夹具漏形态	keep	keep	—
"负控制：契约多出的参数同样另列，不顶替形参"	"- 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）； - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。"	夹具漏形态	keep	keep	—
"负控制：无契约（implicit 档）行为不变"	"- 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）； - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。"	夹具漏形态	keep	keep	—
```
