```audit
title	rootCause	gap	action	status	evidence
文件首 / class 上方 / 对象 / 数组 / 两种解构 / 数组后置都放行且两通道一致	文件级作用域嵌套体表	没测该层	keep	keep	—
class 体 / 对象字面量体 / 字段 / mock-module 均拦截并告警	文件级作用域嵌套体表	没测该层	keep	keep	—
失败 ⇒ never + 诊断；as/replace/skip 上下文保持 unknown	指令解析面整表化	没测该层	keep	keep	—
空 `=>` 尾告警；无 `=>` 保持静默	指令解析面整表化	没测该层	keep	keep	—
显式 emit：不同位置两条、同位置一条、无位置沿用旧身份	指令解析面整表化	没测该层	keep	keep	—
env extraction matches on: %s	文件级指令两通道一致	没测该层	keep	keep	—
粘连形态诊断且不产 case；空格形态正常且静默	指令解析面整表化	没测该层	keep	keep	—
skip 返回类型带尾注释仍解析，且与无注释形态一致、零诊断	指令解析面整表化	没测该层	keep	keep	—
case 期望值带尾注释仍解析，且与无注释形态一致、零诊断	指令解析面整表化	没测该层	keep	keep	—
内部 mock 不成为真指令；畸形名有诊断；合法 case 保持参数	指令解析面整表化	没测该层	keep	keep	—
字符串内的注释符不是尾注释	指令解析面整表化	没测该层	keep	keep	—
无空格 / 有空格 / `)` 后注释：类型保留且只报尾注释一条	指令解析面整表化	没测该层	keep	keep	—
裸标签 / 无法识别载荷有诊断；标签边界不吞 assume/ascii/asXYZ	指令解析面整表化	没测该层	keep	keep	—
无空格 / 有空格 / 嵌套括号都产出类型且零诊断	指令解析面整表化	没测该层	keep	keep	—
空格分隔的 env 列表合法并产出	指令解析面整表化	没测该层	keep	keep	—
裸 / 尾随空白 / 不可读 env 列表都告警	指令解析面整表化	没测该层	keep	keep	—
块注释 / JSDoc 的 import 告警；行注释静默	指令解析面整表化	没测该层	keep	keep	—
畸形 mock-module 告警；单引号合法载荷静默并产出	指令解析面整表化	没测该层	keep	keep	—
"emits nudo:directive-syntax naming the missing space"	"`@nudo:case\"c1\" (1, 2)`（标签与名字之间**无空白**）⇒ 抽取侧（严格 `[ \\t]+`）**不匹配** + 诊断侧（宽松 `[ \\t]*`）**判合法** ⇒ 整条 case **静默 蒸发** ⇒ `nudo test` 一个 case 都不跑、**零诊断**（假绿）。 断言：expect(diags).toHaveLength(1);；expect(diags[0]!.code).toBe(\"nudo:directive-syntax\");"	没测该层	keep	keep	—
"`@nudo:env` in a function body is still diagnosed + not promoted (Bug 847)"	"文件级指令的**位置闸门**漏掉 **ArrayExpression（数组字面量体）** 与 **ObjectPattern（解构模式体）** ⇒ 写在数组元素 / 解构键**上方**的 `/// @nudo:env` 被**静默提升**成**整文件** env（零诊断）。 根因：闸门区间只覆盖「函数体」（）+「类体 / 对象字面量体」 （）； 断言：expect(diags).toHaveLength(1);；expect(diags[0]!.code).toBe(\"nudo:directive-syntax\");"	夹具漏形态	keep	keep	—
"`/// @nudo:env node` in a function body is not promoted + is diagnosed"	"根因：文件级指令的**作用域 = 词法位置**这一约束只在**块注释**分支被检查； 行注释 分支**没有位置闸门**。 断言：expect(diags).toHaveLength(1);；expect(diags[0]!.code).toBe(\"nudo:directive-syntax\");"	没测该层	keep	keep	—
"@nudo:replaceFoo（粘连）→ nudo:directive-syntax，无指令"	"（parser 面）：行内指令的**粘连**形态此前对扫描器**完全不可见** ⇒ **零诊断**地蒸发。 - `@nudo:replaceFoo <target> <typeExpr>` ⇒ 既不匹配严格正则、也不匹配宽松 正则 ⇒ 整条行内指令消失（连同它本该替换的类型）。 断言：expect(dirs.filter((d) => d.kind === \"replace\")).toHaveLength(0);；expect("	夹具漏形态	keep	keep	—
"函数体内的 /// @nudo:import ⇒ 一条 nudo:directive-syntax（改前：零诊断）"	"`@nudo:import` 的**行注释**形态写在函数体 / 类体 / 对象体 / 数组体 / 解构模式体内 ⇒ **零诊断**地失效（core 文本路的位置闸门把它拦下， 引用它的 `@nudo:contract` 被静默丢弃 ⇒ 门禁假绿）； 根因：`packages/parser/src/directives/file-directives.ts` 的 misplaced 分支 只认 `@nudo:env` / `@nudo:mock-module`（`warnMisplacedFileTagLine` 的标签 联合类型里没有 `import`）⇒ `@nudo:import` 落在 `continue` 之前的 if 链"	夹具漏形态	keep	keep	—
"`async (x) => x + 1` is scanned as async"	"`@nudo:mock f = async (x) => x + 1` 的 **async 语义被静默丢弃** ⇒ mock 被建模成**同步**函数 ⇒ 调用点 `f(1).then(…)` 报「method 'then' missing on number receiver」⇒ **error 级** `nudo:entry-may-throw` **假红** （native 不抛：native 返回 Promise）。 根因（expr-scan.ts `parseArrowFunctionExpr`）：解析层只取箭头的**参数与体**， `init.async` **根本没有被读出来** ⇒ service 据此把 mock"	没测该层	keep	keep	—
"`@nudo:mock fetch =` → nudo:directive-syntax (empty payload)"	"`@nudo:mock` 的**载荷为空**（`@nudo:mock fetch =` / `@nudo:mock g from`） ⇒ 指令**静默蒸发**、零诊断 ⇒ mock 丢失 ⇒ 分析退化成 unknown / 假红。 根因：宽松标签正则（`@nudo:mock\\b[ \\t]*([^\\n]*)`）看得到标签，但两条严格文法 （inline `= <expr>` / from `from \"<path>\"`）都不命中 ⇒ 既不建 mock 也不告警。 断言：expect(diags).toHaveLength(1);；expect(diags[0]!.code).toBe(\"nudo:directive-syntax\");"	没测该层	keep	keep	—
"produces no nudo:directive-syntax warning"	"文件级 `/// @nudo:mock-module` 被**函数级** `@nudo:mock` 标签正则 误捕：正确写法产生**伪造的** nudo:directive-syntax 警告（\"Malformed @nudo:mock: cannot parse name … — got: -module …\"）。 根因：mock 标签正则用 `\\b` 收尾，`@nudo:mock` 后的 `-` 仍满足词边界 ⇒ 文件级 `@nudo:mock-module` 落进函数级 mock 扫描器。 断言：expect(fnDiags(FILE_LEVEL_MOCK_MODULE)).toEqual([]);；expect(fileDi"	没测该层	keep	keep	—
"object destructuring keeps the pattern and exposes the bound names"	"`@nudo:mock g = ({ a, b }) => a + b` 的**形参根本没被绑定** ⇒ mock 体读到未声明全局 ⇒ `ReferenceError` ⇒ **error 级**假红 + dts 产物写出 `caller(): never`（**错误类型声明**）。 根因（expr-scan.ts `parseArrowFunctionExpr` 的形参循环）：形参被降级成 「名字 / 占位名」而**无绑定语义**——解构形参退化成占位名 `__destructured_0`、 `AssignmentPattern`（默认值）**整条丢弃**（连同 `params` / `paramPatterns` 的 下标对"	没测该层	keep	keep	—
"@nudo:skip return type is unknown, not a wrong string"	"`@nudo:skip => \"a\" + \"b\"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值 都走同一套字符串分支 ⇒ 旧实现把 `a\" + \"b` 折成**声明的类型 / mock 值** ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。 修法：与 同源——字符串分支的词法边界判定单源在 `directives/string-literal.ts`； 断言：expect(d).toBeDefined();；expect(returns).toBeDefined();"	夹具漏形态	keep	keep	—
"mock payload value is unknown, not a wrong string"	"`@nudo:skip => \"a\" + \"b\"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值 都走同一套字符串分支 ⇒ 旧实现把 `a\" + \"b` 折成**声明的类型 / mock 值** ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。 修法：与 同源——字符串分支的词法边界判定单源在 `directives/string-literal.ts`； 断言：expect([\"unknown\", \"never\"]).toContain(abs.shape.k);；expect(litValue(abs).ok).toBe(false);"	夹具漏形态	keep	keep	—
"sinon mock return value is unknown, not a wrong string"	"`@nudo:skip => \"a\" + \"b\"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值 都走同一套字符串分支 ⇒ 旧实现把 `a\" + \"b` 折成**声明的类型 / mock 值** ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。 修法：与 同源——字符串分支的词法边界判定单源在 `directives/string-literal.ts`； 断言：expect(expr).not.toBeNull();；expect(lv.ok).toBe(false);"	夹具漏形态	keep	keep	—
"a literal mock payload is unaffected"	"`@nudo:skip => \"a\" + \"b\"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值 都走同一套字符串分支 ⇒ 旧实现把 `a\" + \"b` 折成**声明的类型 / mock 值** ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。 修法：与 同源——字符串分支的词法边界判定单源在 `directives/string-literal.ts`； 断言：expect(expr).not.toBeNull();；expect(litValue(expr.returnValue!)).toEqual({ ok: true, value: \"ab\" });"	夹具漏形态	keep	keep	—
"tight form yields the declared return type"	"文件级 `/// @nudo:mock-module` 被**函数级** `@nudo:mock` 标签正则 误捕：正确写法产生**伪造的** nudo:directive-syntax 警告（\"Malformed @nudo:mock: cannot parse name … — got: -module …\"）。 根因：mock 标签正则用 `\\b` 收尾，`@nudo:mock` 后的 `-` 仍满足词边界 ⇒ 文件级 `@nudo:mock-module` 落进函数级 mock 扫描器。 断言：expect(skipReturns(TIGHT)).toBe(\"number\");"	没测该层	keep	keep	—
"witness argument of a concatenation is unknown, not a wrong string"	"旧实现的字符串分支 只查首尾引号 ⇒ `(\"a\" + \"b\")` 折成 `a\" + \"b`（自信的错值）⇒ 见证 ⊭ 契约 ⇒ 契约门禁**假红**（用户写的见证恰好就是契约要求的值）。 修法：与 同源（字符串分支的词法边界判定）⇒ 非单个字面量落 unknown（诊断给出），不再折出错值。 断言：expect(args).toHaveLength(1);；expect([\"unknown\", \"never\"]).toContain(args[0]!.shape.k);"	旧断言钉错	keep	keep	—
```audit-deleted
title	reason	evidence
malformed mock-module payload → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
single-quoted mock-module payload is accepted and silent	dup:指令解析面整表化	commit:4b8e51ee
block comment form → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
JSDoc block form → warning too	dup:指令解析面整表化	commit:4b8e51ee
line comment form stays silent (control)	dup:指令解析面整表化	commit:4b8e51ee
bare tag → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
bare tag with trailing blank → warning too	dup:指令解析面整表化	commit:4b8e51ee
space-separated env list is accepted and silent	dup:指令解析面整表化	commit:4b8e51ee
unreadable env list → warning (no silent drop)	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as(string())` (no space) yields a type — not an evaporated directive	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as number()` (spaced form) still yields the same type	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as(shape({ port: number() }))` (nested parens) yields an object type	dup:指令解析面整表化	commit:4b8e51ee
bare `@nudo:as` is diagnosed explicitly (never silently ignored)	dup:指令解析面整表化	commit:4b8e51ee
unrecognised payload is diagnosed instead of evaporating	dup:指令解析面整表化	commit:4b8e51ee
tag boundary: `@nudo:asXYZ` / `@nudo:assume` are not `@nudo:as` directives	dup:指令解析面整表化	commit:4b8e51ee
`string()// why` (no space) keeps the type (no unknown downgrade)	dup:指令解析面整表化	commit:4b8e51ee
`string() // why` (spaced form) still behaves the same	dup:指令解析面整表化	commit:4b8e51ee
comment markers inside a string literal are not a trailing comment	dup:指令解析面整表化	commit:4b8e51ee
`//` right after `)` is a comment (not swallowed into the expression)	dup:指令解析面整表化	commit:4b8e51ee
the inner @nudo:mock does not become a real mock directive	dup:指令解析面整表化	commit:4b8e51ee
the malformed case name is still diagnosed	dup:指令解析面整表化	commit:4b8e51ee
a well-formed case keeps its arguments (no over-masking)	dup:指令解析面整表化	commit:4b8e51ee
the expected type is parsed (not degraded to unknown)	dup:指令解析面整表化	commit:4b8e51ee
the commented form equals the plain form	dup:指令解析面整表化	commit:4b8e51ee
no nudo:directive-syntax warning is emitted	dup:指令解析面整表化	commit:4b8e51ee
a `//` inside a string literal stays part of the expression	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:skip => number() // 注释` keeps the declared return type	dup:指令解析面整表化	commit:4b8e51ee
the commented form equals the plain form	dup:指令解析面整表化	commit:4b8e51ee
no nudo:directive-syntax warning is emitted	dup:指令解析面整表化	commit:4b8e51ee
the glued tag does not become a case directive	dup:指令解析面整表化	commit:4b8e51ee
emits nudo:directive-syntax naming the missing space	dup:指令解析面整表化	commit:4b8e51ee
the spaced form still works and stays silent	dup:指令解析面整表化	commit:4b8e51ee
title	dup:指令解析面整表化	commit:4b8e51ee
malformed mock-module payload → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
single-quoted mock-module payload is accepted and silent	dup:指令解析面整表化	commit:4b8e51ee
block comment form → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
JSDoc block form → warning too	dup:指令解析面整表化	commit:4b8e51ee
line comment form stays silent (control)	dup:指令解析面整表化	commit:4b8e51ee
bare tag → nudo:directive-syntax warning	dup:指令解析面整表化	commit:4b8e51ee
bare tag with trailing blank → warning too	dup:指令解析面整表化	commit:4b8e51ee
space-separated env list is accepted and silent	dup:指令解析面整表化	commit:4b8e51ee
unreadable env list → warning (no silent drop)	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as(string())` (no space) yields a type — not an evaporated directive	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as number()` (spaced form) still yields the same type	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:as(shape({ port: number() }))` (nested parens) yields an object type	dup:指令解析面整表化	commit:4b8e51ee
bare `@nudo:as` is diagnosed explicitly (never silently ignored)	dup:指令解析面整表化	commit:4b8e51ee
unrecognised payload is diagnosed instead of evaporating	dup:指令解析面整表化	commit:4b8e51ee
tag boundary: `@nudo:asXYZ` / `@nudo:assume` are not `@nudo:as` directives	dup:指令解析面整表化	commit:4b8e51ee
`string()// why` (no space) keeps the type (no unknown downgrade)	dup:指令解析面整表化	commit:4b8e51ee
`string() // why` (spaced form) still behaves the same	dup:指令解析面整表化	commit:4b8e51ee
comment markers inside a string literal are not a trailing comment	dup:指令解析面整表化	commit:4b8e51ee
`//` right after `)` is a comment (not swallowed into the expression)	dup:指令解析面整表化	commit:4b8e51ee
the inner @nudo:mock does not become a real mock directive	dup:指令解析面整表化	commit:4b8e51ee
the malformed case name is still diagnosed	dup:指令解析面整表化	commit:4b8e51ee
a well-formed case keeps its arguments (no over-masking)	dup:指令解析面整表化	commit:4b8e51ee
the expected type is parsed (not degraded to unknown)	dup:指令解析面整表化	commit:4b8e51ee
the commented form equals the plain form	dup:指令解析面整表化	commit:4b8e51ee
no nudo:directive-syntax warning is emitted	dup:指令解析面整表化	commit:4b8e51ee
a `//` inside a string literal stays part of the expression	dup:指令解析面整表化	commit:4b8e51ee
`@nudo:skip => number() // 注释` keeps the declared return type	dup:指令解析面整表化	commit:4b8e51ee
the commented form equals the plain form	dup:指令解析面整表化	commit:4b8e51ee
no nudo:directive-syntax warning is emitted	dup:指令解析面整表化	commit:4b8e51ee
the glued tag does not become a case directive	dup:指令解析面整表化	commit:4b8e51ee
the spaced form still works and stays silent	dup:指令解析面整表化	commit:064f93bf
same code+message at two positions → two diagnostics	dup:指令解析面整表化	commit:064f93bf
same code+message at the same position → one diagnostic (same defect)	dup:指令解析面整表化	commit:064f93bf
without a position the legacy identity (code+message) still dedups	dup:指令解析面整表化	commit:064f93bf
two identical `@nudo:as` trailing comments in one block → two diagnostics	dup:指令解析面整表化	commit:064f93bf
the same directive scanned twice at the same position → one diagnostic	dup:指令解析面整表化	commit:064f93bf
two identical malformed `@nudo:case` in different functions → two diagnostics	dup:指令解析面整表化	commit:064f93bf
emits nudo:directive-syntax for the empty `=>` tail	dup:指令解析面整表化	commit:064f93bf
negative control: a case without `=>` stays silent	dup:指令解析面整表化	commit:064f93bf
negative control: a well-formed expectation stays silent	dup:指令解析面整表化	commit:064f93bf
the expectation on the next line is picked up (no diagnostic)	dup:指令解析面整表化	commit:064f93bf
directive.expected：解析失败 ⇒ 失败表示；显式 unknown ⇒ unknown	dup:指令解析面整表化	commit:064f93bf
解析失败仍发 nudo:directive-syntax 诊断（不是静默）	dup:指令解析面整表化	commit:064f93bf
严格 API parseCaseExpectedAbs：失败 ⇒ undefined（可传递的失败表示）	dup:指令解析面整表化	commit:064f93bf
解析失败 ⇒ 失败表示（never），不是 unknown（顶类型）	dup:指令解析面整表化	commit:064f93bf
显式 unknown / any / any() 仍是 unknown（用户主动声明，不约束）	dup:指令解析面整表化	commit:064f93bf
解析失败发 nudo:directive-syntax 诊断（文案带 tag 位置）	dup:指令解析面整表化	commit:064f93bf
非断言面上下文（@nudo:as / @nudo:replace / @nudo:skip）保持 unknown	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above an object-literal method is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above a class field is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:mock-module` above a class method is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
control: the same directive above the class declaration still works	dup:指令解析面整表化	commit:064f93bf
control: the same directive above the object literal statement still works	dup:指令解析面整表化	commit:064f93bf
control: a directive inside a function body is still diagnosed (Bug 847 unchanged)	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above a destructuring key is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above an array-pattern element is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:mock-module` above an array element is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:mock-module` above a destructuring key is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
a nested array body is gated too (deeper nesting)	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above a class field is still blocked + diagnosed	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above an object-literal method is still blocked + diagnosed	dup:指令解析面整表化	commit:064f93bf
a directive above a class declaration still works	dup:指令解析面整表化	commit:064f93bf
a directive above an object literal statement still works	dup:指令解析面整表化	commit:064f93bf
a directive above an array literal statement still works	dup:指令解析面整表化	commit:064f93bf
a directive above a destructuring declaration still works	dup:指令解析面整表化	commit:064f93bf
a directive above an array-destructuring declaration still works	dup:指令解析面整表化	commit:064f93bf
a top-level directive after an array literal still works	dup:指令解析面整表化	commit:064f93bf
a function-level `@nudo:case` above a function declaration is still bound to it	dup:指令解析面整表化	commit:064f93bf
a function-level `@nudo:case` above a class method is still bound to it	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:mock-module` in a function body is not promoted + is diagnosed	dup:指令解析面整表化	commit:064f93bf
the same directive at the top of the file still works	dup:指令解析面整表化	commit:064f93bf
a top-level directive after other statements still works (top level is allowed)	dup:指令解析面整表化	commit:064f93bf
a directive on an export line still works	dup:指令解析面整表化	commit:064f93bf
@nudo:assume 不是 @nudo:as 的粘连形态（不误伤）	dup:指令解析面整表化	commit:064f93bf
合法形态不回归（@nudo:as number() / @nudo:replace x number()）	dup:指令解析面整表化	commit:064f93bf
文件头的 /// @nudo:import ⇒ 零该诊断（合法位置）	dup:指令解析面整表化	commit:064f93bf
两种注释形态在同一位置**口径一致**（块注释原本就告警）	dup:指令解析面整表化	commit:064f93bf
对象字面量体内的行注释形态同样告警（嵌套体闸门全族一致）	dup:指令解析面整表化	commit:064f93bf
显式 diags 通道与 runWithDirectiveDiags 域都能收到（消费面无分叉）	dup:指令解析面整表化	commit:064f93bf
sync arrow is scanned as sync (negative control)	dup:指令解析面整表化	commit:064f93bf
async arrow without params is still async	dup:指令解析面整表化	commit:064f93bf
`async function` expression is scanned as async	dup:指令解析面整表化	commit:064f93bf
the `@nudo:mock` directive carries the async flag	dup:指令解析面整表化	commit:064f93bf
a sync mock directive stays sync (negative control)	dup:指令解析面整表化	commit:064f93bf
the sinon `stub().callsFake(…)` path also keeps the async flag	dup:指令解析面整表化	commit:064f93bf
`@nudo:mock g from` → nudo:directive-syntax (missing path)	dup:指令解析面整表化	commit:064f93bf
no mock directive is produced for the empty payload	dup:指令解析面整表化	commit:064f93bf
valid payload forms stay silent	dup:指令解析面整表化	commit:064f93bf
the glued tag does not become a mock directive	dup:指令解析面整表化	commit:064f93bf
leaks no function-level mock directive	dup:指令解析面整表化	commit:064f93bf
still extracts the file-level mock-module directive	dup:指令解析面整表化	commit:064f93bf
function-level @nudo:mock still works (no over-blocking)	dup:指令解析面整表化	commit:064f93bf
array destructuring keeps the pattern and exposes the bound names	dup:指令解析面整表化	commit:064f93bf
default value params are kept (not dropped) and expose the bound name	dup:指令解析面整表化	commit:064f93bf
rest params keep the `...` in the signature and expose the bare bound name	dup:指令解析面整表化	commit:064f93bf
plain identifiers are unchanged	dup:指令解析面整表化	commit:064f93bf
params / paramPatterns / boundNames stay 1:1 aligned (no dropped slots)	dup:指令解析面整表化	commit:064f93bf
the `@nudo:mock` directive carries the binding semantics	dup:指令解析面整表化	commit:064f93bf
tight form equals the spaced form	dup:指令解析面整表化	commit:064f93bf
no diagnostic is emitted for the tight form	dup:指令解析面整表化	commit:064f93bf
bare @nudo:skip still declares nothing	dup:指令解析面整表化	commit:064f93bf
@nudo:skipped is still not a skip directive	dup:指令解析面整表化	commit:064f93bf
the wrong value "a\" + \"b" is never produced	dup:指令解析面整表化	commit:064f93bf
a literal witness is unaffected	dup:指令解析面整表化	commit:064f93bf
`/// @nudo:env node` above a class method is not promoted + is diagnosed	dup:文件级作用域嵌套体表	commit:94422142
`/// @nudo:env node` above an array element is not promoted + is diagnosed	dup:文件级作用域嵌套体表	commit:94422142
`/// @nudo:env node` above a class method is still blocked + diagnosed	dup:文件级作用域嵌套体表	commit:94422142
a top-of-file directive still works	dup:文件级作用域嵌套体表	commit:94422142
```
