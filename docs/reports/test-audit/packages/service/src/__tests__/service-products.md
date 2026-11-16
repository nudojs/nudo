```audit
title	rootCause	gap	action	status	evidence
六种违约各一条诊断点名 env 文件；结构违约装载期即报；契约满足/语法错负控	产品面尾部表	没测该层	keep	keep	—
契约/声明级可选接受 undefined；Input 槽可缺席；未申报可选拒收	产品面尾部表	没测该层	keep	keep	—
契约/观测/并存都恒为 <fn>Output；导出名集合相同；契约优先	产品面尾部表	没测该层	keep	keep	—
同 used 集合去重；不同名不受影响；不传 used 只清洗；字符清洗生效	产品面尾部表	没测该层	keep	keep	—
指令路径继承 noDeclaration；dts 清洗点号；防御门同样清洗	产品面尾部表	没测该层	keep	keep	—
js 无注解仍 any；dts unknown；ts 未标注仍 any；契约优先于注解；无契约注解生效	产品面中段表	没测该层	keep	keep	—
string / string[] / 多形参 / rest / JSDoc 注解保留	产品面中段表	没测该层	keep	keep	—
TS 注解映射 entry@ 实参；不可映射回落 any	产品面中段表	没测该层	keep	keep	—
extractFormals/ParamNames 不含 this 且 index 重排；dts 无 this；普通表原样	产品面中段表	没测该层	keep	keep	—
数组解构契约聚合成元组；对象解构仍是对象；无契约仍是观测面	产品面中段表	没测该层	keep	keep	—
字段名 lit/lam 都不会把 lit 拖进 import	产品面中段表	没测该层	keep	keep	—
已有 import { lit } 仍补 litC 声明（别名）；无该 import 时直接声明 lit	产品面中段表	没测该层	keep	keep	—
guard 产物过 tsc --strict 且运行时语义不变	产品面中段表	没测该层	keep	keep	—
纯调用点观测剥到基类型；无调用点入口泛化保留嵌套精度	产品面契约表	没测该层	keep	keep	—
strMin/strMax 用 refine；无界仍 z.string()	产品面契约表	没测该层	keep	keep	—
不支持形态诊断且不登记；变量/return/export/解构照常生效	产品面契约表	没测该层	keep	keep	—
zod 方言保 z.bigint 并记 dropped；schema 节点 prim bigint	产品面契约表	没测该层	keep	keep	—
非同 prim 字面量 union / 同 prim / nullish 保形；非字面量与带界成员回落 widen	产品面契约表	没测该层	keep	keep	—
非 Promise 拒绝；真 Promise 放行；unknown 仍放行一切	产品面契约表	没测该层	keep	keep	—
生成器 brand 不引用 GeneratorFunction；模块可求值；非全局降级 unknown；全局仍 instanceof；standard 不受影响	产品面契约表	没测该层	keep	keep	—
数据属性 / 显式 undefined / setter-only / 空对象	产品面契约表	没测该层	keep	keep	—
getter 读域：数字/字符串/this/嵌套/抛 unknown；不出现 exact undefined	产品面契约表	没测该层	keep	keep	—
"mock-<name>.<ext> / <name>.mock.<ext> 对族内全部扩展名都判 true"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(isEnvTemplatePath(`"	没测该层	keep	keep	—
".env.<ext> 分支（族内另一支）判定的扩展名不变"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(isEnvTemplatePath(`"	没测该层	keep	keep	—
"mock 前缀支锚在 basename 起点（相对路径形态同样成立）"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(isEnvTemplatePath(\""	没测该层	keep	keep	—
"负控：非 env 模板路径逐字不变（仍为 false）"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(isEnvTemplatePath(p"	没测该层	keep	keep	—
"有调用点见证：函数级 throws 证据落在**函数级承载位**（见证数与推断域不变）"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(fn.cases.map((c) =>"	没测该层	keep	keep	—
"有调用点见证（模块级调用点路径）：函数级承载位带函数级 throws 证据"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(fn.cases.map((c) =>"	没测该层	keep	keep	—
"选中 case：被选函数不产 entry@ 见证，函数级承载位带函数级 throws 证据"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(fn.cases.map((c) =>"	没测该层	keep	keep	—
"负控：无调用点见证时 entry@ 见证的 throws 证据与推断域不变"	"族 54 · service **协议面**（3 条缺口）的钉。 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）： env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`， **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch 门禁 ⇒ 不触发依赖源文件复分析）。 断言：expect(fn.cases.map((c) =>"	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
getter 返数字：dts 取读域 number（原生读 1）	dup:产品面契约表	commit:52dbd878
getter 返字符串：dts 取读域（原生读 "s"）	dup:产品面契约表	commit:52dbd878
getter 以 this 为接收者读域（原生 this.n = 41）	dup:产品面契约表	commit:52dbd878
嵌套对象的 getter 槽同样按读域渲染	dup:产品面契约表	commit:52dbd878
getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined	dup:产品面契约表	commit:52dbd878
dts 不得出现 exact undefined 的访问器槽	dup:产品面契约表	commit:52dbd878
普通数据属性仍渲染成它的值类型	dup:产品面契约表	commit:52dbd878
显式 undefined 数据属性仍渲染成 undefined	dup:产品面契约表	commit:52dbd878
仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确	dup:产品面契约表	commit:52dbd878
空对象渲染成 Record<string, never>（不是 TS 的 {}，Bug 565）	dup:产品面契约表	commit:52dbd878
生成器的 constructor brand 不再渲染成 z.instanceof(GeneratorFunction)	dup:产品面契约表	commit:52dbd878
生成的 zod 模块可以求值（改前：ReferenceError: GeneratorFunction is not defined）	dup:产品面契约表	commit:52dbd878
负控制：求值夹具确实能抓到 ReferenceError（改前形态会红）	dup:产品面契约表	commit:52dbd878
非全局 brand 降级 z.unknown() 并记 dropped	dup:产品面契约表	commit:52dbd878
负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）	dup:产品面契约表	commit:52dbd878
产物里的 z.instanceof 实参都是运行时全局构造器	dup:产品面契约表	commit:52dbd878
standard 面不受影响（brand 走 JSON 节点，不引用类名）	dup:产品面契约表	commit:52dbd878
非 Promise 值被拒绝（42 / 'str' / {}）	dup:产品面契约表	commit:52dbd878
Promise 与 thenable 的判据与 zod 面同口径（真 Promise 放行）	dup:产品面契约表	commit:52dbd878
负控制：unknown 节点仍放行一切（不把 promise 的收窄扩散）	dup:产品面契约表	commit:52dbd878
非同 prim 字面量 union ⇒ `1 | "x"`（改前 `number | string`）	dup:产品面契约表	commit:52dbd878
同 prim 字面量 union 仍保形（回归钉）	dup:产品面契约表	commit:52dbd878
含 nullish 字面量的混合 union 也保形（字面量在 term 里也要读）	dup:产品面契约表	commit:52dbd878
负控制：成员不是字面量域（union(number(), string())）仍按 widen 口径	dup:产品面契约表	commit:52dbd878
负控制：带界成员（union(number().gt(0), lit(0))）不整体当字面量域	dup:产品面契约表	commit:52dbd878
zod 方言：z.bigint()（不是 z.unknown()）	dup:产品面契约表	commit:52dbd878
schema 节点：prim bigint（standard 方言据此渲染 prim 校验）	dup:产品面契约表	commit:52dbd878
for 头（for-of 解构）：诊断一条，覆盖不生效	dup:产品面契约表	commit:52dbd878
表达式语句：诊断一条	dup:产品面契约表	commit:52dbd878
函数声明：诊断一条	dup:产品面契约表	commit:52dbd878
负控制：变量声明 / return / export 声明 ⇒ 零诊断，覆盖照常生效	dup:产品面契约表	commit:52dbd878
负控制：解构声明上的 @nudo:as 仍生效（BUG-080 主修复不退化）	dup:产品面契约表	commit:52dbd878
strMin / strMax 用 refine 写 .length（不是 .min()/.max()）	dup:产品面契约表	commit:52dbd878
对照：无长度界时仍是纯 z.string()	dup:产品面契约表	commit:52dbd878
纯调用点观测：返回位对象槽字面量 → 基类型	dup:产品面契约表	commit:52dbd878
无调用点的入口泛化仍保留嵌套精度（对照组，Bug 565 口径）	dup:产品面契约表	commit:52dbd878
产物真跑 tsc --noEmit --strict（改前 TS7053 ×2）	dup:产品面中段表	commit:c64c7632
运行时语义不变：接受合法 Uint8Array，拒绝普通对象	dup:产品面中段表	commit:c64c7632
侧车已有 `import { lit }` ⇒ 仍补 litC 声明（别名，不撞名）	dup:产品面中段表	commit:c64c7632
对照组：侧车不含 `import { lit }` ⇒ 直接声明 `lit`（无需别名）	dup:产品面中段表	commit:c64c7632
字段名叫 `lit` 不得把 `lit` 拖进 import（DSL 从未调用 lit(）	dup:产品面中段表	commit:c64c7632
对照组：字段名改成 `lam` ⇒ 同一个 import 列表（唯一变量是字段名）	dup:产品面中段表	commit:c64c7632
部分覆盖（契约只写 a）⇒ 形参类型是元组（改前是 { a: number }）	dup:产品面中段表	commit:c64c7632
全覆盖（契约写 a 与 b）⇒ 形参类型是元组、声明名是数组形态	dup:产品面中段表	commit:c64c7632
负控制：对象解构的字段级契约仍聚合成对象（既有口径不变）	dup:产品面中段表	commit:c64c7632
负控制：无契约时仍是观测面（number[]），不被本次改动波及	dup:产品面中段表	commit:c64c7632
extractFormals 不返回 `this` 形参	dup:产品面中段表	commit:c64c7632
过滤后 index 重排（`this` 不占实参位 ⇒ 后续形参前移）	dup:产品面中段表	commit:c64c7632
extractParamNames（产物面的槽名来源）不含 `this`	dup:产品面中段表	commit:c64c7632
dts 产物面没有 `this` 形参（消费方不该吃 TS2554 假红）	dup:产品面中段表	commit:c64c7632
负控制：没有 `this` 标注时形参表原样（index 连续、名字不变）	dup:产品面中段表	commit:c64c7632
`.ts` 的 string 形参：entry@ 实参是 string（改前是 any）	dup:产品面中段表	commit:c64c7632
`.ts` 的多个形参：各自按声明类型（number / number）	dup:产品面中段表	commit:c64c7632
`.ts` 的 boolean 形参：entry@ 实参是 boolean	dup:产品面中段表	commit:c64c7632
合法 TypeScript 不再因「参数无约束」在 entry@ 抛 TypeError（改前抛）	dup:产品面中段表	commit:c64c7632
不可映射的声明类型（string[]）：实参仍回落 any（不猜）	dup:产品面中段表	commit:c64c7632
dts 形参保留 string 注解（改前是 unknown）	dup:产品面中段表	commit:c64c7632
dts 形参保留不可映射的 string[] 注解（产物不得比源更弱）	dup:产品面中段表	commit:c64c7632
dts 多个形参各自保留注解	dup:产品面中段表	commit:c64c7632
dts rest 形参保留数组注解（...rest: string[]）	dup:产品面中段表	commit:c64c7632
dts 的 JSDoc @param 与声明位一致（string，不是 unknown）	dup:产品面中段表	commit:c64c7632
同形 `.js` 源（无注解）：entry@ 实参仍是 any、仍抛 TypeError	dup:产品面中段表	commit:c64c7632
同形 `.js` 源（无注解）：dts 形参是 unknown（TS 投影面归一）	dup:产品面中段表	commit:c64c7632
`.ts` 源里未标注的形参：仍是 any（无注解 = 无约束）	dup:产品面中段表	commit:c64c7632
手写契约仍优先于 TS 注解（既有口径「声明位取侧车契约」）	dup:产品面中段表	commit:c64c7632
无契约时 TS 注解生效（同一函数，去掉契约面后是 string）	dup:产品面中段表	commit:c64c7632
directive path inherits the noDeclaration classification	dup:产品面尾部表	commit:9a85ec09
dts projection never emits a dotted function name	dup:产品面尾部表	commit:9a85ec09
defensive gate: an illegal name is cleaned even without the noDeclaration flag	dup:产品面尾部表	commit:9a85ec09
同一个 used 集合 ⇒ 清洗后同名的两个守卫拿到不同导出名	dup:产品面尾部表	commit:9a85ec09
used 集合跨守卫共享 ⇒ 去重只影响同名者（不同名不受影响）	dup:产品面尾部表	commit:9a85ec09
负控制：不传 used ⇒ 只清洗、不去重（旧调用方行为不变）	dup:产品面尾部表	commit:9a85ec09
字符清洗仍然生效（A.b → isA_bOutput）	dup:产品面尾部表	commit:9a85ec09
契约返回 ⇒ 恒叫 <fn>Output（不再叫 <fn>Return）	dup:产品面尾部表	commit:9a85ec09
观测返回 ⇒ 同样叫 <fn>Output（两面同名同义）	dup:产品面尾部表	commit:9a85ec09
同一函数的两种来源 ⇒ 导出名集合相同（名字与来源解耦）	dup:产品面尾部表	commit:9a85ec09
契约返回优先于观测返回（内容口径不变，只是名字恒定）	dup:产品面尾部表	commit:9a85ec09
契约级可选位：整参校验器接受 undefined（契约 number().optional()）	dup:产品面尾部表	commit:9a85ec09
契约级可选位：<fn>Input 的槽位可缺席（键可缺、显式 undefined 合法）	dup:产品面尾部表	commit:9a85ec09
声明级可选位（默认形参）同样保真	dup:产品面尾部表	commit:9a85ec09
负控制：未申报可选的位仍拒收 undefined	dup:产品面尾部表	commit:9a85ec09
结构违约（不导出 / 不是函数）在**装载期**即报（不待工厂调用）	dup:产品面尾部表	commit:9a85ec09
负控制：契约满足的 env 文件生效且零告警	dup:产品面尾部表	commit:9a85ec09
负控制：语法错的 env 文件仍走既有措辞（不与契约诊断混口径）	dup:产品面尾部表	commit:9a85ec09
```
