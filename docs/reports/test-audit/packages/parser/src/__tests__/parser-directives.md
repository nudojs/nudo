```audit
title	rootCause	gap	action	status	evidence
指令携带同一组绑定语义	去重/期望/嵌套表	没测该层	keep	keep	—
解构 / 默认 / rest / 普通形参都保留源码形态与绑定名	去重/期望/嵌套表	没测该层	keep	keep	—
文件头合法位置与 runWithDirectiveDiags 域内消费一致	去重/期望/嵌套表	没测该层	keep	keep	—
文件头 / 语句之间 / export 行上的顶层指令仍放行	去重/期望/嵌套表	没测该层	keep	keep	—
函数体 env 诊断不提升；函数/类方法上的 case 绑定不变；顶层 env 仍放行	去重/期望/嵌套表	没测该层	keep	keep	—
class/对象/字段/数组/两种解构/嵌套数组都拦截；顶层与函数体口径对照	去重/期望/嵌套表	没测该层	keep	keep	—
失败 never+诊断；as/replace/skip 保 unknown；显式 unknown/any/any() 零诊断	去重/期望/嵌套表	没测该层	keep	keep	—
空 => 告警、无 => 静默、合法/续行静默、失败非 unknown、显式 unknown、严格 API	去重/期望/嵌套表	没测该层	keep	keep	—
显式位置/同位置/无位置/块内重复/跨函数/复扫的去重矩阵	去重/期望/嵌套表	没测该层	keep	keep	—
case 与 skip 带尾注释仍解析、与无注释一致、零诊断	文件级/as 表	没测该层	keep	keep	—
尾注释只报一条且类型保留；字符串内注释符不算	文件级/as 表	没测该层	keep	keep	—
括号/空格/嵌套都产出；裸标签与不可识别诊断；标签边界不吞邻近词	文件级/as 表	没测该层	keep	keep	—
mock-module/import/env 的合法与畸形载荷矩阵	文件级/as 表	没测该层	keep	keep	—
拼接见证落 unknown/never 且无错值；字面量见证不受影响	parser-directives 尾部契约表	没测该层	keep	keep	—
紧贴形态与空格形态同返回类型、零诊断；裸标签/ skipped 无返回	parser-directives 尾部契约表	没测该层	keep	keep	—
skip 返回 / mock 值 / sinon 返回值都不折错字符串；字面量不受影响	parser-directives 尾部契约表	没测该层	keep	keep	—
零诊断、零函数级泄漏，文件级指令仍被抽取；函数级 mock 正常	parser-directives 尾部契约表	没测该层	keep	keep	—
mockfetch 诊断不产 mock；空格形态静默且产 mock	parser-directives 尾部契约表	没测该层	keep	keep	—
空 inline / 空 from 告警且不产 mock；合法载荷静默且产 mock	parser-directives 尾部契约表	没测该层	keep	keep	—
箭头 / async 无参 / async function / 指令 / sinon callsFake 都保留 async	parser-directives 尾部契约表	没测该层	keep	keep	—
函数体 / 对象体 / 块注释同位置的 import 都告警且点名文件级	parser-directives 尾部契约表	没测该层	keep	keep	—
replaceFoo 告警不产指令；assume 不误伤；合法 as/replace 不回归	parser-directives 尾部契约表	没测该层	keep	keep	—
env / mock-module 在函数体内都拦截并告警	parser-directives 尾部契约表	没测该层	keep	keep	—
文件首 / class 上方 / 对象 / 数组 / 两种解构 / 数组后置都放行且两通道一致	文件级作用域嵌套体表	没测该层	keep	keep	—
粘连形态诊断且不产 case；空格形态正常且静默	指令解析面整表化	没测该层	keep	keep	—
内部 mock 不成为真指令；畸形名有诊断；合法 case 保持参数	指令解析面整表化	没测该层	keep	keep	—
env extraction matches on: %s	parser 通道对拍	没测该层	keep	keep	—
mock-module extraction matches on: %s	parser 通道对拍	没测该层	keep	keep	—
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
emits nudo:directive-syntax naming the missing space	dup:parser-directives 尾部契约表	commit:7b50ab18
`/// @nudo:env node` in a function body is not promoted + is diagnosed	dup:parser-directives 尾部契约表	commit:7b50ab18
@nudo:replaceFoo（粘连）→ nudo:directive-syntax，无指令	dup:parser-directives 尾部契约表	commit:7b50ab18
函数体内的 /// @nudo:import ⇒ 一条 nudo:directive-syntax（改前：零诊断）	dup:parser-directives 尾部契约表	commit:7b50ab18
`async (x) => x + 1` is scanned as async	dup:parser-directives 尾部契约表	commit:7b50ab18
`@nudo:mock fetch =` → nudo:directive-syntax (empty payload)	dup:parser-directives 尾部契约表	commit:7b50ab18
produces no nudo:directive-syntax warning	dup:parser-directives 尾部契约表	commit:7b50ab18
object destructuring keeps the pattern and exposes the bound names	dup:parser-directives 尾部契约表	commit:7b50ab18
@nudo:skip return type is unknown, not a wrong string	dup:parser-directives 尾部契约表	commit:7b50ab18
mock payload value is unknown, not a wrong string	dup:parser-directives 尾部契约表	commit:7b50ab18
sinon mock return value is unknown, not a wrong string	dup:parser-directives 尾部契约表	commit:7b50ab18
a literal mock payload is unaffected	dup:parser-directives 尾部契约表	commit:7b50ab18
tight form yields the declared return type	dup:parser-directives 尾部契约表	commit:7b50ab18
witness argument of a concatenation is unknown, not a wrong string	dup:parser-directives 尾部契约表	commit:7b50ab18
skip 返回类型带尾注释仍解析，且与无注释形态一致、零诊断	dup:文件级/as 表	commit:23c028c2
case 期望值带尾注释仍解析，且与无注释形态一致、零诊断	dup:文件级/as 表	commit:23c028c2
字符串内的注释符不是尾注释	dup:文件级/as 表	commit:23c028c2
无空格 / 有空格 / `)` 后注释：类型保留且只报尾注释一条	dup:文件级/as 表	commit:23c028c2
裸标签 / 无法识别载荷有诊断；标签边界不吞 assume/ascii/asXYZ	dup:文件级/as 表	commit:23c028c2
无空格 / 有空格 / 嵌套括号都产出类型且零诊断	dup:文件级/as 表	commit:23c028c2
空格分隔的 env 列表合法并产出	dup:文件级/as 表	commit:23c028c2
裸 / 尾随空白 / 不可读 env 列表都告警	dup:文件级/as 表	commit:23c028c2
块注释 / JSDoc 的 import 告警；行注释静默	dup:文件级/as 表	commit:23c028c2
畸形 mock-module 告警；单引号合法载荷静默并产出	dup:文件级/as 表	commit:23c028c2
class 体 / 对象字面量体 / 字段 / mock-module 均拦截并告警	dup:去重/期望/嵌套表	commit:417e0364
失败 ⇒ never + 诊断；as/replace/skip 上下文保持 unknown	dup:去重/期望/嵌套表	commit:417e0364
空 `=>` 尾告警；无 `=>` 保持静默	dup:去重/期望/嵌套表	commit:417e0364
显式 emit：不同位置两条、同位置一条、无位置沿用旧身份	dup:去重/期望/嵌套表	commit:417e0364
`@nudo:env` in a function body is still diagnosed + not promoted (Bug 847)	dup:去重/期望/嵌套表	commit:417e0364
env extraction matches on: %s	dup:去重/期望/嵌套表	commit:417e0364
```
