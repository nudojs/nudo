# packages/service/src/__tests__/service-core-misc.test.ts

模块套件：97 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"引擎侧：实例 brand 名不是内部伪名"	"zod 桩：链式可调用（只为验证「模块求值期不炸」）"	没测该层	keep	keep	—
"dts 产物：不得出现内部伪名（改前：TS2304——伪名从未声明）"	"消费方 tsc 不得见到未声明的类型名 zod 桩：链式可调用（只为验证「模块求值期不炸」）"	没测该层	keep	keep	—
"schema 产物：不得 z.instanceof(内部伪名)（改前：import 即 ReferenceError）"	"zod 桩：链式可调用（只为验证「模块求值期不炸」）"	没测该层	keep	keep	—
"schema 产物可求值（import 即用——改前 ReferenceError）"	"zod 桩：链式可调用（只为验证「模块求值期不炸」）"	没测该层	keep	keep	—
"负控制：产物里的 z.instanceof 实参都是运行时全局构造器"	"zod 桩：链式可调用（只为验证「模块求值期不炸」）"	没测该层	keep	keep	—
"构造器形参 = unknown（nudo 展示面仍为 any，两个作用域不同）"	"三个丢信息点（`dtsClassDeclaration`）：① 构造器 / 静态方法形参无类型 证据； **TS 投影面**把无约束 any 映成 TS `unknown`（top）⇒ ① 回到 `unknown`， 但理由不是「推断失败」，而是「TS 侧的 top」。"	夹具漏形态	keep	keep	—
"裸块语句上的指令登记了**节点身份**区间（改前恒空）"	"对照组：指令挂在普通语句（`const`）上——改前改后都生效"	没测该层	keep	keep	—
"裸块语句 与 普通语句 的签名逐字相同（替换真的生效）"	"对照组：指令挂在普通语句（`const`）上——改前改后都生效"	没测该层	keep	keep	—
"裸块语句命中 ⇒ 零「未命中」诊断（不许谎报作用域内没有该表达式）"	"对照组：指令挂在普通语句（`const`）上——改前改后都生效"	没测该层	keep	keep	—
"目标确实只在**嵌套**块里 ⇒ 诊断明说「被嵌套作用域挡住」而不是「没有该表达式」"	"对照组：指令挂在普通语句（`const`）上——改前改后都生效"	没测该层	keep	keep	—
"两个不同 cwd 各跑一次 ⇒ 标签逐字相同且只有一条"	"派生段的溯源标签 `// derived-from: <root>:<fn>` 用 **cwd 相对** 路径 ⇒ 同一个 root 在不同 cwd 下重算得到两种拼写； 合并逻辑又取**并集** ⇒ 同一个 root 在一行里出现两次，且**永久留存**（再跑也不清理）。"	没测该层	keep	keep	—
"历史 cwd 相对拼写 + 新拼写 ⇒ 归一成一条（不再并集）"	"预置一段用旧拼写（cwd 相对）的派生段 派生段的溯源标签 `// derived-from: <root>:<fn>` 用 **cwd 相对** 路径 ⇒ 同一个 root 在不同 cwd 下重算得到两种拼写； 合并逻辑又取**并集** ⇒ 同一个 root 在一行里出现两次，且**永久留存**（再跑也不清理）。"	没测该层	keep	keep	—
"错误消息含侧车文件名（不是源文件名）"	"侧车不可解析时诊断点名**源文件**而不是侧车。 `collectGeneratedSections` 抛的是无路径的 `\"sidecar is not parseable\"` （注释说「由调用方补充路径上下文」，但调用方直接让异常冒泡）⇒ 紧随其后的 带路径分支（`tables === undefined`）**永远走不到** ⇒ 带路径的错误分支是 死代码，用户拿到的报错指向被分析的**源文件**。"	没测该层	keep	keep	—
"`{ x = 1, y = x + 1 } = {}` ⇒ 形参可省（不是必填）"	"根因：`declaredParams` 的 `case \"pattern\"` 硬编码 `hasDefault: false`， 而解析器已经如实给出 `FormalParam.optional`（`{ a } = {}` ⇒ true）。 解构位**未绑定展开**（渲染名是求值占位 `_p0`）时可省性 可以表达 ⇒ `f(_p0?: any)`。"	没测该层	keep	keep	—
"对照组：无默认值的解构形参仍必填"	"根因：`declaredParams` 的 `case \"pattern\"` 硬编码 `hasDefault: false`， 而解析器已经如实给出 `FormalParam.optional`（`{ a } = {}` ⇒ true）。 解构位**未绑定展开**（渲染名是求值占位 `_p0`）时可省性 可以表达 ⇒ `f(_p0?: any)`。"	没测该层	keep	keep	—
"模块级求值失败 ⇒ 观测面看见该文件的 module-throw 回落（装载期逃逸）"	"**重钉（§修复方向：用户代码抛出的原生异常归 `module-throw`， 不再算引擎缺陷； §修复方向：「模块未分析 ⇒ 不得给绿灯」）**： 模块体里的原生异常（这里 `undefined()` ⇒ TypeError）是**用户代码自身 抛**，标签由 `internal` 改为 `module-throw`（不是引擎缺陷 ⇒ 不该报 「engine bug」）。 程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。"	没测该层	keep	keep	—
"假红防线：unsupported:* 回落**不**进失败信号"	"程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。"	没测该层	keep	keep	—
"假红防线：module-throw（程序自身抛）**不**进失败信号"	"程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。"	没测该层	keep	keep	—
"干净文件 ⇒ 零回落（不得凭空造失败）"	"程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。"	没测该层	keep	keep	—
"静态方法进函数表，静态字段不进"	"回归：**类的静态字段**不得被当成方法收进函数表。 改前 kind 过滤写成 `m.kind !== undefined && m.kind !== \"method\"`，而 Babel 的 类字段节点是 `ClassProperty`（**没有** `kind` 字段）⇒ 过滤放行 ⇒ `K.s` 成为一个「函数」⇒ dts 面渲染成实例方法、check 面对不上、运行时不符。"	没测该层	keep	keep	—
"成员按导出槽名 `default` 登记（不再被整体丢弃）"	"回归：**匿名** `export default class { … }` 必须进导出表。 改前两个分支都落空（无 id ⇒ 不是 `ClassDeclaration && defaultClassName`；"	夹具漏形态	keep	keep	—
"对照组：具名 default class 仍按本地名登记（口径不变）"	"回归：**匿名** `export default class { … }` 必须进导出表。 改前两个分支都落空（无 id ⇒ 不是 `ClassDeclaration && defaultClassName`；"	夹具漏形态	keep	keep	—
"`=> lit(null)` 的精确结果被判定（不是 unchecked）"	"求值器不支持的表达式 ⇒ 实测 Abs 是真 unknown（对照组）。"	没测该层	keep	keep	—
"判据本体的对照组：真 unknown ⇒ 仍是推导失败"	"求值器不支持的表达式 ⇒ 实测 Abs 是真 unknown（对照组）。"	没测该层	keep	keep	—
"inferenceFailed：lit null/undefined ⇒ false；无 term 的 unknown ⇒ true"	"求值器不支持的表达式 ⇒ 实测 Abs 是真 unknown（对照组）。"	没测该层	keep	keep	—
"判定层：never 配 never ⇒ 满足（Bug 649 不回归：配 number() ⇒ 不满足）"	"回归：实测 `never` 配期望 `never` 时 `never ⊑ never` 成立 ⇒ 断言必须可判 **ok**。 改前守卫无条件拒绝（`if (actual.shape.k === \"never\") return false;"	没测该层	keep	keep	—
"分析面：抛错函数 + `=> never` ⇒ 不再发 nudo:case-expected（报告与判定不再自相矛盾）"	"回归：实测 `never` 配期望 `never` 时 `never ⊑ never` 成立 ⇒ 断言必须可判 **ok**。 改前守卫无条件拒绝（`if (actual.shape.k === \"never\") return false;"	没测该层	keep	keep	—
"分析面对照组：抛错函数 + `=> number()` ⇒ 仍报 nudo:case-expected（Bug 649 不回归）"	"回归：实测 `never` 配期望 `never` 时 `never ⊑ never` 成立 ⇒ 断言必须可判 **ok**。 改前守卫无条件拒绝（`if (actual.shape.k === \"never\") return false;"	没测该层	keep	keep	—
"槽谓词满足 ⇒ 判 ok（与顶层写法一致）"	"回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与 顶层写法（`number().gt(0)`）**同结论、同可读性**。 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`） 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。"	没测该层	keep	keep	—
"槽谓词不满足 ⇒ 判不满足（与顶层写法一致）"	"回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与 顶层写法（`number().gt(0)`）**同结论、同可读性**。 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`） 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。"	没测该层	keep	keep	—
"期望文本递归渲染槽谓词（不再是 `{ n: number }`）"	"回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与 顶层写法（`number().gt(0)`）**同结论、同可读性**。 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`） 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。"	没测该层	keep	keep	—
"无槽谓词时渲染逐字不变（不引入噪音）"	"回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与 顶层写法（`number().gt(0)`）**同结论、同可读性**。 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`） 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。"	没测该层	keep	keep	—
"下游是 .ts ⇒ 派生产物补 `declare const fn: …`"	"产物会被 tsc 编译 ⇒ builder 标识符必须已声明（否则 TS2304） `nudo contract --emit` 的**派生分支**写 `.nudo.ts` 侧车时 **不补 builder 类型声明** ⇒ 产物里 `fn` 是未声明标识符 ⇒ `tsc` **TS2304**； `.js` 侧车不加（裸注入已够）。"	没测该层	keep	keep	—
"对照组：.js 侧车不加 declare（裸注入已够）"	"`nudo contract --emit` 的**派生分支**写 `.nudo.ts` 侧车时 **不补 builder 类型声明** ⇒ 产物里 `fn` 是未声明标识符 ⇒ `tsc` **TS2304**； `.js` 侧车不加（裸注入已够）。"	没测该层	keep	keep	—
"两个星号导出同名 ⇒ 该名不导出（导入方报缺名），顺序无关"	"回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范 该名**不导出**，宿主的导入方在链接期 `SyntaxError: contains conflicting star exports for name 'x'`。 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量， 且只换两行 `export *` 顺序结论就翻转。"	夹具漏形态	keep	keep	—
"对照组：本地导出遮蔽星号导出 ⇒ x 存在且值取自本地（不是歧义）"	"回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范 该名**不导出**，宿主的导入方在链接期 `SyntaxError: contains conflicting star exports for name 'x'`。 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量， 且只换两行 `export *` 顺序结论就翻转。"	夹具漏形态	keep	keep	—
"定义位点解析同口径：歧义名解析不出（不得给一个确定定义模块）"	"回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范 该名**不导出**，宿主的导入方在链接期 `SyntaxError: contains conflicting star exports for name 'x'`。 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量， 且只换两行 `export *` 顺序结论就翻转。"	夹具漏形态	keep	keep	—
"定义位点对照：非歧义星号导出照常解析到定义模块"	"回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范 该名**不导出**，宿主的导入方在链接期 `SyntaxError: contains conflicting star exports for name 'x'`。 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量， 且只换两行 `export *` 顺序结论就翻转。"	夹具漏形态	keep	keep	—
"export function 的形参用源码真名（改前：arg0/arg1）"	"：跨模块导出的 fn 形参面—— - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）； - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。"	没测该层	keep	keep	—
"带默认值的形参：名字与个数都在（改前：arg0 一个 / arg1 假名）"	"plainDefault 是私有本地绑定（仅经别名 aliasedDefault 导出）——不得 作为独立导出名出现； ：跨模块导出的 fn 形参面—— - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）； - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。"	没测该层	keep	keep	—
"rest 形参计入声明形参数并保留 ... 形态（改前：只剩 1 个）"	"：跨模块导出的 fn 形参面—— - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）； - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。"	没测该层	keep	keep	—
"负控制：箭头 const 导出的形参面不变"	"：跨模块导出的 fn 形参面—— - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）； - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。"	没测该层	keep	keep	—
"export const 箭头 / 函数表达式都进普查（普查名 = 导出槽名）"	"出口普查此前只认 function 声明，漏掉 `export const` 箭头/函数表达式两种导出形态；原夹具只有 function 声明，签名/契约无法绑定。"	夹具漏形态	keep	keep	—
"多声明符逐个收（不只首个）"	"普查逐声明符收集，旧实现只取首个 declarator；原夹具没有 `const a=1,b=()=>…` 这类多声明符形态。"	夹具漏形态	keep	keep	—
"非函数初始化不进普查"	"普查必须排除非函数初始化器；旧测试没有 `const a=1` 这类负控，容易把值导出误收成函数入口。"	夹具漏形态	keep	keep	—
"分析面看得见该函数，且入口求值拿到返回值"	"箭头/函数表达式导出未被普查时，分析面看不到该函数且入口求值退化为 unknown；旧夹具只覆盖 function 形式的返回。"	夹具漏形态	keep	keep	—
"普查名 = 局部名，导出槽 = default"	"`export default function named` 的普查名应取局部名、导出槽为 default；旧夹具只测具名导出槽。"	夹具漏形态	keep	keep	—
"入口求值回退到 default 槽 ⇒ 返回值不再是 unknown"	"default 导出未在普查名与出口槽之间建立映射时，入口求值回退不到 default；旧测试只断言签名面。"	夹具漏形态	keep	keep	—
"匿名 default 导出形态不变（普查名 = default）"	"匿名 default 函数没有局部名，普查名必须回落 default；旧夹具只覆盖具名 default。"	夹具漏形态	keep	keep	—
"对象字面量的成员函数逐个收（key 名 = 导出槽名）"	"对象字面量导出的成员函数未被逐个收集，key 名没有映射到导出槽；原夹具只覆盖顶层声明。"	夹具漏形态	keep	keep	—
"对象方法简写（ObjectMethod）进普查"	"`{ m() {} }` 的对象方法简写与 function 属性形态不同，旧普查漏收；夹具只覆盖 `m: function`。"	夹具漏形态	keep	keep	—
"导出槽名优先于命名函数表达式的自有 id（Bug 997，与 core listTopFunctions 同口径）"	"普查名取**导出槽名**（greet）——内层函数 id（named）不是导出槽名， 取它会让侧车契约整个不绑定 + 签名表里导出符号消失。 无则空串）"	没测该层	keep	keep	—
"getter / setter 不是可调用入口，不进普查"	"普查必须排除 getter/setter，否则把访问器误当函数入口；旧测试没有访问器负控。"	夹具漏形态	keep	keep	—
"非函数成员不进普查"	"对象字面量的非函数值不得进普查；旧夹具只验证函数成员的正向收集。"	夹具漏形态	keep	keep	—
"分析面看得见该函数"	"普查漏收对象方法时分析面看不到该函数；旧测试只覆盖顶层函数入口。"	夹具漏形态	keep	keep	—
"getter 形态：两面都不收（Bug 996 已收口）"	"core scan-top-functions.ts 的 ObjectMethod 分支已按 kind 过滤 （getter/setter 不是可调用入口）⇒ 两面口径一致（无差异）。 无则空串）"	没测该层	keep	keep	—
"匿名 module.exports = fn：两面都按 default 登记（Bug 6 后 core 侧不再漏）"	"CJS 默认导出形态（`module.exports = fn`）此前不在 L2 入口表 ⇒ 假绿。 修复后 core 普查面与 service 面同口径登记 `default`。 无则空串）"	夹具漏形态	keep	keep	—
"带指令的源码解析出注入包（as 目标 + 覆盖值）"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。"	没测该层	keep	keep	—
"无指令的源码不产生注入包"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。"	没测该层	keep	keep	—
"注入包与收集器同源（目标区间一致）"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。"	没测该层	keep	keep	—
"作为根分析时，@nudo:as 覆盖承载语句的值"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。"	没测该层	keep	keep	—
"依赖模块里的 @nudo:as 生效（依赖侧接线后转绿）"	"期望：{ port: number }（依赖模块的指令生效） 注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。"	没测该层	keep	keep	—
"依赖模块内部改写导出值后，导入方读到当前值"	"改前：0（合并面把活 getter 求值成了快照） 改前：`mergeHarvestUnderEnv` 用对象展开搬运导出表（`{ ...exports.named }`） ⇒ **求值**了依赖模块导出槽上的活 getter ⇒ 冻结成快照 ⇒ 依赖模块的内部 变异对导入方不可见。 }` → \"hello\" 引擎改前给 0（快照）⇒ 类型面与原生不一致。"	夹具漏形态	keep	keep	—
"变异前的读取仍是精确初值（不被前一次调用的残留污染）"	"改前：`mergeHarvestUnderEnv` 用对象展开搬运导出表（`{ ...exports.named }`） ⇒ **求值**了依赖模块导出槽上的活 getter ⇒ 冻结成快照 ⇒ 依赖模块的内部 变异对导入方不可见。 }` → \"hello\" 引擎改前给 0（快照）⇒ 类型面与原生不一致。"	夹具漏形态	keep	keep	—
"依赖未改写导出值时，导入方读到初值"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"同文件内的模块级状态读写不受影响"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"原生：upper(a: string) 的 a 按 string 推断（形参注解进入推断）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"原生：.ts 的合法代码不再触发 nudo:entry-may-throw 假红（a 是 string，toUpperCase 不会抛）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"原生：dts 面保留源里的类型注解（export declare function upper(a: string)）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"负控制：.ts 源仍被正常分析（函数可见、body 仍求值）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"负控制：同形 .js 源的形参仍是无约束 any（无注解可读，行为不变）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"负控制：.js 源的 any 接收者成员访问仍报 may-throw（假红只对 .ts 成立）"	"`.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64` 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。"	没测该层	keep	keep	—
"坏侧车：报 nudo:contract-load（error），不发 nudo:contract-entry-only"	"侧车（`*.nudo.js`）**加载失败**被误报成「没有契约根」 （`nudo:contract-entry-only`）⇒ 事实陈述错误 + 修复建议误导。 根因（analyzer-orchestrate-uncached-cases.ts）：用 `effectiveContract(...)` 的返回值是否存在来判定「有没有契约根」——它对「根本没有侧车」与「侧车存在 但加载失败」返回**同一个 undefined**，两者不可区分 ⇒ 必然发「没有契约根」。"	没测该层	keep	keep	—
"负控制：没有侧车 → 仍报 nudo:contract-entry-only（口径不变）"	"侧车（`*.nudo.js`）**加载失败**被误报成「没有契约根」 （`nudo:contract-entry-only`）⇒ 事实陈述错误 + 修复建议误导。 根因（analyzer-orchestrate-uncached-cases.ts）：用 `effectiveContract(...)` 的返回值是否存在来判定「有没有契约根」——它对「根本没有侧车」与「侧车存在 但加载失败」返回**同一个 undefined**，两者不可区分 ⇒ 必然发「没有契约根」。"	没测该层	keep	keep	—
"负控制：好侧车 → 两者都无"	"侧车（`*.nudo.js`）**加载失败**被误报成「没有契约根」 （`nudo:contract-entry-only`）⇒ 事实陈述错误 + 修复建议误导。 根因（analyzer-orchestrate-uncached-cases.ts）：用 `effectiveContract(...)` 的返回值是否存在来判定「有没有契约根」——它对「根本没有侧车」与「侧车存在 但加载失败」返回**同一个 undefined**，两者不可区分 ⇒ 必然发「没有契约根」。"	没测该层	keep	keep	—
"不存在的依赖 → missing（不是 unreadable）"	"回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧， 见交付报告的「越界」段）： - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧 据此把「不可读」报成不可读，而不是「Module file not found」。"	没测该层	keep	keep	—
"可读依赖 → ok（路径 + 内容）"	"回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧， 见交付报告的「越界」段）： - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧 据此把「不可读」报成不可读，而不是「Module file not found」。"	没测该层	keep	keep	—
"guardedLoadModule：loader 抛错 → undefined + 一次性可见告警（不穿透）"	"回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧， 见交付报告的「越界」段）： - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧 据此把「不可读」报成不可读，而不是「Module file not found」。"	没测该层	keep	keep	—
"负控制：ENOENT 与正常返回不受 guarded 包装影响"	"回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧， 见交付报告的「越界」段）： - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧 据此把「不可读」报成不可读，而不是「Module file not found」。"	没测该层	keep	keep	—
"does not flag an import alias source name (imported)"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"does not flag an export alias name (exported)"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"does not flag a label name (labeled / break / continue)"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"does not flag a namespace-import binding local name"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"negative control: a real free global is still reported"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"negative control: export * as ns body reference is still reported, anchored at the reference"	"原生：`export * as ns from` 不创建模块作用域绑定 → 体内引用 ns 是自由全局 锚点落在真正的引用位（第 4 行 `return ns.alpha`），不是名字位（第 2 行） nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常"	没测该层	keep	keep	—
"negative control: export { y as renamed } body reference is still reported"	"原生：`renamed` 不是模块作用域绑定 → 体内引用是自由全局 nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑"	没测该层	keep	keep	—
"negative control: computed keys / members stay live references"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"negative control: non-computed property names stay name positions"	"nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成 「未被覆盖的内建 API」误报。 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）： - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不 是自由全局引用） - `outer:` / `break"	没测该层	keep	keep	—
"抛错 + 声明期望（=> 42）⇒ 报 nudo:case-expected（改前恒 0 条）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"抛错 + 声明期望 ⇒ 诊断文案如实报出「实测 never」"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"展示层不变：抛错 + 谓词期望 ⇒ 期望展示形态仍是「number (> 0)」"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"负控制：不抛错 + 期望满足 ⇒ 0 条 nudo:case-expected"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"负控制：不抛错 + 期望不满足 ⇒ 1 条 nudo:case-expected（口径不变）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"负控制：抛错 + 无期望 ⇒ 0 条 nudo:case-expected（unchecked 口径不变）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"实测 never ⇒ 不满足（底元素恒真被拦住）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"负控制：实测 1、期望 1 ⇒ 满足（口径不变）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
"负控制：实测 1、期望 2 ⇒ 不满足（口径不变）"	"`nudo:case-expected` 诊断条数（期望不满足）。"	没测该层	keep	keep	—
```
