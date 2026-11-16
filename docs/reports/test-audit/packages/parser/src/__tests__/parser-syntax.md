```audit
title	rootCause	gap	action	status	evidence
classInstanceMethods 只收实例方法；getClassMembers 能看见 static 并可取 key/函数体	字面量/语法整表化	没测该层	keep	keep	—
optional / partial 为可选；必选与混合字段保持各自标记	字面量/语法整表化	没测该层	keep	keep	—
含顶层冒号的属性正常解析且零诊断	字面量/语法整表化	没测该层	keep	keep	—
getter / 方法简写 / 简写属性：unknown + 点名诊断；整字面量 fail-closed	字面量/语法整表化	没测该层	keep	keep	—
case 见证保留数值且零诊断；非法写法仍 unknown	字面量/语法整表化	没测该层	keep	keep	—
指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 / Infinity / NaN	字面量/语法整表化	没测该层	keep	keep	—
case 见证与期望值按八进制取值	字面量/语法整表化	没测该层	keep	keep	—
前导 0 全八进制按八进制；含 8/9 按 sloppy 十进制；现代进制不变；分隔符非法	字面量/语法整表化	没测该层	keep	keep	—
非字面量表达式仍不认识	字面量/语法整表化	没测该层	keep	keep	—
case 见证与期望值都保留取值且零诊断	字面量/语法整表化	没测该层	keep	keep	—
括号 / 一元 / bigint / 模板 / 进制分隔符按 JS 语义取值	字面量/语法整表化	没测该层	keep	keep	—
拼接落 unknown/never，期望值同口径并告警；单字面量仍接受	字面量/语法整表化	没测该层	keep	keep	—
纯结构字面量与嵌套结构仍正常解析	字符串/结构字面量整段校验	没测该层	keep	keep	—
case 期望值尾随文本不折成 tuple/obj，并报 nudo:directive-syntax	字符串/结构字面量整段校验	没测该层	keep	keep	—
尾随成员访问 / 加法 / 尾部文本都不折进结构（落 unknown）	字符串/结构字面量整段校验	没测该层	keep	keep	—
case 见证携带 cooked 值，且值里不残留字面反斜杠	字符串/结构字面量整段校验	没测该层	keep	keep	—
转义按 JS 语义解释，普通单/双引号字符串不变	字符串/结构字面量整段校验	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
interprets \t as TAB	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \n as LF	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \\ as one backslash	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \" as a quote	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \uXXXX	dup:字符串/结构字面量整段校验	commit:2021c6af
keeps plain strings unchanged	dup:字符串/结构字面量整段校验	commit:2021c6af
case witness carries the cooked (escape-interpreted) value	dup:字符串/结构字面量整段校验	commit:2021c6af
no literal backslash survives in the witness value	dup:字符串/结构字面量整段校验	commit:2021c6af
trailing member access after an array literal is not folded into the tuple	dup:字符串/结构字面量整段校验	commit:2021c6af
two object literals joined by + is not folded into one object	dup:字符串/结构字面量整段校验	commit:2021c6af
member access / trailing text on a literal is not folded into a structure	dup:字符串/结构字面量整段校验	commit:2021c6af
plain structure literals keep parsing (no regression)	dup:字符串/结构字面量整段校验	commit:2021c6af
case expected with trailing text → not a folded structure + nudo:directive-syntax	dup:字符串/结构字面量整段校验	commit:2021c6af
does not fold "a" + "b" into a literal value	dup:字面量/语法整表化	commit:ef7469c4
does not fold longer concatenations either	dup:字面量/语法整表化	commit:ef7469c4
expected value of a case directive is unknown, not a wrong string	dup:字面量/语法整表化	commit:ef7469c4
emits nudo:directive-syntax for the unrecognized expected value	dup:字面量/语法整表化	commit:ef7469c4
a single literal is still accepted	dup:字面量/语法整表化	commit:ef7469c4
括号包裹与一元符号	dup:字面量/语法整表化	commit:ef7469c4
bigint 字面量（7n）保留 bigint 类型与值	dup:字面量/语法整表化	commit:ef7469c4
无插值模板字面量 ⇒ 字符串字面量	dup:字面量/语法整表化	commit:ef7469c4
进制内的数字分隔符	dup:字面量/语法整表化	commit:ef7469c4
case 见证 / 期望值不再落 unknown（空洞通过的根因）	dup:字面量/语法整表化	commit:ef7469c4
非字面量的表达式仍不认识（不折错值）	dup:字面量/语法整表化	commit:ef7469c4
0 开头 + 全八进制数字 ⇒ 八进制	dup:字面量/语法整表化	commit:ef7469c4
0 开头且含 8/9 ⇒ sloppy 十进制（与 native sloppy 一致）	dup:字面量/语法整表化	commit:ef7469c4
现代进制字面量不受影响（0o / 0b / 0x）	dup:字面量/语法整表化	commit:ef7469c4
分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识（不折错值）	dup:字面量/语法整表化	commit:ef7469c4
case 见证 / 期望值按八进制取值	dup:字面量/语法整表化	commit:ef7469c4
指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元正号	dup:字面量/语法整表化	commit:ef7469c4
Infinity / NaN 是数值常量形态（不再落 unknown）	dup:字面量/语法整表化	commit:ef7469c4
case 见证值不再是 unknown（假绿根因：见证满足任何契约）	dup:字面量/语法整表化	commit:ef7469c4
非法写法仍落 unknown（不折出自信的错值）	dup:字面量/语法整表化	commit:ef7469c4
getter property → unknown + named diagnostic	dup:字面量/语法整表化	commit:ef7469c4
method shorthand → unknown + named diagnostic	dup:字面量/语法整表化	commit:ef7469c4
shorthand property → unknown + named diagnostic	dup:字面量/语法整表化	commit:ef7469c4
a single unsupported property rejects the whole literal (fail-closed, no half-value)	dup:字面量/语法整表化	commit:ef7469c4
properties with a top-level colon still parse and stay diagnostic-free	dup:字面量/语法整表化	commit:ef7469c4
shape({ a: number().optional() }) → optional slot	dup:字面量/语法整表化	commit:ef7469c4
partial(shape({ a: number() })) → optional slot	dup:字面量/语法整表化	commit:ef7469c4
required field stays required (no over-widening)	dup:字面量/语法整表化	commit:ef7469c4
mixed shape keeps per-field optional flags	dup:字面量/语法整表化	commit:ef7469c4
parser contract unchanged: classInstanceMethods skips static members	dup:字面量/语法整表化	commit:ef7469c4
service-side precondition: getClassMembers sees the static member	dup:字面量/语法整表化	commit:ef7469c4
service-side precondition: instance member is visible too	dup:字面量/语法整表化	commit:ef7469c4
```
