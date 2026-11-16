# packages/core/src/algebra/__tests__/algebra-directives.test.ts

模块套件：directive/case/expected 解析与诊断面。

审计：146 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
@nudo:assumed → nudo:assume-invalid（error）；@nudo:invariantdp → nudo:invariant-invalid（warning）；@nudo:throwsTypeError → nudo:directive-syntax（warning）；合法形态零诊断（不误伤）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
env inside a class body is not file-wide；env inside an object literal body is not file-wide；mock-module inside a class body is not file-wide；@nudo:import inside a class body is not file-wide	algebra-directives 聚合矩阵	没测该层	keep	keep	—
class **声明上方**的 env 仍是文件级（合法顶层位置）；文件头的 env 仍是文件级；class 体**之后**的顶层 env 仍是文件级	algebra-directives 聚合矩阵	没测该层	keep	keep	—
env inside an array literal body is not file-wide；env inside a destructuring pattern body is not file-wide；env inside an array-destructuring pattern body is not file-wide；env inside a nested array body is not file-wide；mock-module inside an	algebra-directives 聚合矩阵	没测该层	keep	keep	—
数组**声明上方**的 env 仍是文件级；解构**声明上方**的 env 仍是文件级；数组解构**声明上方**的 env 仍是文件级；class **声明上方**的 env 仍是文件级（Bug 1088 口径不变）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
分组标签（case null + case "ab" 共享体）⇒ 不得把 null 重绑成 "ab"；含非字面量 case 测试的分组臂 ⇒ 同样不得按 prim 标签重绑；P2：`case 0:` 不得把 -0 谎报成 +0（1 / -0 = -Infinity）；负控制：单一 prim 标签的 hit 收窄**保留**（case "ab" ⇒ x.length = 2）；负控制：单一 nullish 标签的臂仍不产命中事实（case null ⇒ null.length	algebra-directives 聚合矩阵	没测该层	keep	keep	—
扫描层：多行实参的 case 后缀产出申报（修前：undefined）；消费层：extractDeclaredThrows 消费得到多行形态的申报；闸门层：已申报 ⇒ 不再假红（无声明 ⇒ 照常执法，对照组）；闸门层：多行形态 + 续行形态（`)` 行之后的下一行）都放行；护栏：单行写法行为逐字不变（`*` / kind / 续行）；护栏：位置锚不放宽（Bug 1033 口径）——散文 / case 名内部 / 期望侧都不产申报	algebra-directives 聚合矩阵	没测该层	keep	keep	—
后缀不在行尾（尾部有其它字符）⇒ 不剥除，且耗时线性；后缀在行尾（后接大段空白）⇒ 照常剥除，且耗时线性；语义护栏：普通形态的剥除结果与旧式一致	algebra-directives 聚合矩阵	没测该层	keep	keep	—
内层同名 function f() 的见证 ⇒ 不报 case-inconsistency；对照组 1：内层函数改名 g ⇒ 同样不报（单变量对照）；对照组 2：外层函数自己的违例见证仍报 error（不因修复而假绿）；对照组 3：外层函数自己的合规见证不报	algebra-directives 聚合矩阵	没测该层	keep	keep	—
含 $ 的导出函数名被回收；含非 ASCII 的导出函数名被回收；含 $ / 非 ASCII 的导出 const 名被回收；导出函数**被分析**（throws 面如实，不再从不被分析）；stripStaticExportDecls 文本口径也放宽（$ / 非 ASCII）；ASCII 同形口径不变（对照组）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
@nudo:assume 中文名 → 合法（不再是 malformed）；@nudo:assume `>=` 仍翻转为 le（中文名同样成立）；@nudo:invariant 中文名 → 合法；@nudo:invariant 中文路径段 → 合法；@nudo:contract 中文形参名 → 契约生效；@nudo:contract `$x` 形参名 → 合法（旧 ASCII 正则不收 `$`）；非法的形参名仍被判 malformed（不放宽成任意串）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
error: 对象见证 ⊭ 标量契约（number()）——改前机制②归一成 unknown 后静默跳过；error: shape 契约的字段类型不符——改前机制①把 fields 契约整条跳过；error: shape 契约缺字段 → missing field <path>；error: 嵌套 shape 的字段违例（路径逐段下钻）；error: shape 契约的字段数值界违例；ok: 满足 shape 契约的见证不报；ok: 满足标量契约的对象见证不报（any() 通	algebra-directives 聚合矩阵	没测该层	keep	keep	—
error: 多行实参的违例见证（改前整条见证被跳过 ⇒ 零诊断 / 假绿）；ok: 多行实参满足契约不报；负控制: 同一见证写成单行仍报同一条（改前只多行形态假绿）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
error: `"a\", -1` 切 2 个实参 ⇒ 第二个实参的违例见证被检出；负控制: 无转义引号的同形见证报同一条（改前两条都报 ⇒ 实参个数相同）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
warning: 契约位上的实参认不出 ⇒ nudo:directive-syntax；warning: 契约位上没有见证实参 ⇒ nudo:directive-syntax；负控制: 无契约位的认不出实参不产见证面诊断（parser 面自行诊断）；负控制: 约束构建器实参（number()）是合法形态 ⇒ 跳过但**不产诊断**	algebra-directives 聚合矩阵	没测该层	keep	keep	—
space-separated env list is recognized (was dropped as one token)；comma-separated env list still works (control)；mixed separators are accepted；trailing line comment is stripped；path-like env names survive whitespace splitting；bare tag yield	algebra-directives 聚合矩阵	没测该层	keep	keep	—
内联形态：见证落在 f 上；内联形态：不再产生 <anonymous> 影子 scope；内联形态：按名查找拿到 f 的注释行；语句级形态（对照）：见证同样落在 f 上；函数表达式初始化器的内联形态同样绑到绑定名	algebra-directives 聚合矩阵	没测该层	keep	keep	—
extractBalancedParens: 双引号串里的 `\"` 不结束字符串；extractBalancedParens: 对象 / 数组字面量里的转义引号同样配平；extractBalancedParens: 单引号串里的 `\'` 不结束字符串；scanCaseTags: 含转义引号的 case 被抽出（改前整条被丢弃）；负控制（Bug 1009 口径保留）: 串未闭合时回退宽松口径 ⇒ 实参个数不变；负控制: 无转义引号的普通实参不受影响	algebra-directives 聚合矩阵	没测该层	keep	keep	—
@nudo:assume 空载荷 → nudo:assume-invalid（error）；@nudo:invariant 空载荷 → nudo:invariant-invalid（warning）；空载荷（纯空白）与合法载荷不回归；合法 assume / invariant 零诊断（不误伤）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
bare tag is reported as a malformed import；bare tag with trailing blank is reported as a malformed import；empty payload produces no import record (only a diagnostic)；empty payload is malformed at the grammar level too；valid and other malfor	algebra-directives 聚合矩阵	没测该层	keep	keep	—
CRLF: 期望被抽出（改前整条期望消失）；LF（负控制）: 期望照旧被抽出；CRLF: 块注释续行形态的期望同样被抽出；CRLF: 无期望的 case 不受影响（expectedText 仍为 undefined）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
后缀在 `=>` 之前: 期望照旧被抽出（改前整条期望消失）；后缀在 `=>` 之后: 期望文本不被腐蚀（改前是 `1 !! throws`）；后缀带 kind: 期望文本只剩期望本身；文档化形态（只有后缀、没有 `=>`）: 没有期望（后缀是**申报**不是期望）；回归护栏: case 行本身不被改写 ⇒ `!! throws` 后缀申报仍在；回归护栏: 后缀在 `=>` 之后时**申报口径不变**（既有约定：后缀须紧跟实参括号）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
数字字面量: `=> (999)` ⇒ `999`；字符串字面量: `=> ("abc")` ⇒ `"abc"`；对象字面量: `=> ({ b: 1 })` ⇒ `{ b: 1 }`；元组字面量: `=> ([1, 2])` ⇒ `[1, 2]`；多层括号: 逐层剥到表达式本体；负控制: 无括号形态不受影响；负控制: 箭头函数不被误剥（`(x) => y` 的括号不是冗余层）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
无 filename 时 `<number>1` 解析成功（降级重试命中）；带 filename=x.ts 时同样解析成功；引擎端到端：`<number>1` 求值为字面量 1（剥除面已就绪）；泛型箭头 `<T>(x) => x`（无尾逗号）在硬失败路径下被重试救回；真 JSX 源不受降级影响（TS+JSX 本就解析成功 ⇒ 不触发重试）；模式分流仍在：`.ts` 收 TS 语法、`.js` 不收（缓存键含模式 ⇒ 不串味）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
the argument region of a malformed case is registered as a span；the tag itself is NOT masked (the malformed-name diagnostic still fires)；a well-formed case still masks its whole tag+arguments region；a case without an argument list registers	algebra-directives 聚合矩阵	没测该层	keep	keep	—
env inside a function body is not file-wide；mock-module inside a function body is not file-wide；@nudo:import inside a function body is not file-wide；the same directives at the top of the file are honored；a top-level directive after other st	algebra-directives 聚合矩阵	没测该层	keep	keep	—
形态 A: 期望值在下一行 ⇒ 期望被抽出；形态 A（无续行前缀）: 期望值在下一行 ⇒ 期望被抽出；形态 B: `=>` 后为空 ⇒ 没有期望，但**产出行首锚的语法错**（不再静默）；形态 B（续行也没有值）: 同样产出行首锚的语法错；负控制: 同行形态照旧（期望被抽出、无语法错）；负控制: 没有 `=>` 的 case（本就无期望）不产语法错	algebra-directives 聚合矩阵	没测该层	keep	keep	—
粘连写法: 不被抽成 case（抽取侧要求 `[ \t]+`）；粘连写法: 在诊断面**看得见**（畸形剩余文本非空）；负控制: 规范形态照旧被抽成 case、且不产畸形剩余；负控制: 其它畸形形态仍被诊断面看见	algebra-directives 聚合矩阵	没测该层	keep	keep	—
@nudo:contractx → nudo:contract-syntax（warning）；@nudo:contract 空载荷 → nudo:contract-syntax（warning）；合法 @nudo:contract 零 contract-syntax（不误伤）；散文里的 @nudo:contract（行中提及）不算指令（不误伤）	algebra-directives 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
文件头的 env 仍是文件级	dup:文件头的 env 仍是文件级（同文件两处逐字同体，保留首份）	commit:e73bbdb8
class 体**之后**的顶层 env 仍是文件级	dup:class 体**之后**的顶层 env 仍是文件级（同文件两处逐字同体，保留首份）	commit:e73bbdb8
@nudo:assumed → nudo:assume-invalid（error）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:invariantdp → nudo:invariant-invalid（warning）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:throwsTypeError → nudo:directive-syntax（warning）	dup:algebra-directives 聚合矩阵	commit:54f54850
合法形态零诊断（不误伤）	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside a class body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside an object literal body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
mock-module inside a class body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:import inside a class body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
class **声明上方**的 env 仍是文件级（合法顶层位置）	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside an array literal body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside a destructuring pattern body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside an array-destructuring pattern body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside a nested array body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
mock-module inside an array body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:import inside a destructuring pattern body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
数组**声明上方**的 env 仍是文件级	dup:algebra-directives 聚合矩阵	commit:54f54850
解构**声明上方**的 env 仍是文件级	dup:algebra-directives 聚合矩阵	commit:54f54850
数组解构**声明上方**的 env 仍是文件级	dup:algebra-directives 聚合矩阵	commit:54f54850
class **声明上方**的 env 仍是文件级（Bug 1088 口径不变）	dup:algebra-directives 聚合矩阵	commit:54f54850
文件头的 env 仍是文件级	dup:algebra-directives 聚合矩阵	commit:54f54850
class 体**之后**的顶层 env 仍是文件级	dup:algebra-directives 聚合矩阵	commit:54f54850
分组标签（case null + case "ab" 共享体）⇒ 不得把 null 重绑成 "ab"	dup:algebra-directives 聚合矩阵	commit:54f54850
含非字面量 case 测试的分组臂 ⇒ 同样不得按 prim 标签重绑	dup:algebra-directives 聚合矩阵	commit:54f54850
P2：`case 0:` 不得把 -0 谎报成 +0（1 / -0 = -Infinity）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制：单一 prim 标签的 hit 收窄**保留**（case "ab" ⇒ x.length = 2）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制：单一 nullish 标签的臂仍不产命中事实（case null ⇒ null.length 抛）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制：default 臂的 nullish 排除事实**保留**（x 非 null ⇒ 不抛）	dup:algebra-directives 聚合矩阵	commit:54f54850
扫描层：多行实参的 case 后缀产出申报（修前：undefined）	dup:algebra-directives 聚合矩阵	commit:54f54850
消费层：extractDeclaredThrows 消费得到多行形态的申报	dup:algebra-directives 聚合矩阵	commit:54f54850
闸门层：已申报 ⇒ 不再假红（无声明 ⇒ 照常执法，对照组）	dup:algebra-directives 聚合矩阵	commit:54f54850
闸门层：多行形态 + 续行形态（`)` 行之后的下一行）都放行	dup:algebra-directives 聚合矩阵	commit:54f54850
护栏：单行写法行为逐字不变（`*` / kind / 续行）	dup:algebra-directives 聚合矩阵	commit:54f54850
护栏：位置锚不放宽（Bug 1033 口径）——散文 / case 名内部 / 期望侧都不产申报	dup:algebra-directives 聚合矩阵	commit:54f54850
后缀不在行尾（尾部有其它字符）⇒ 不剥除，且耗时线性	dup:algebra-directives 聚合矩阵	commit:54f54850
后缀在行尾（后接大段空白）⇒ 照常剥除，且耗时线性	dup:algebra-directives 聚合矩阵	commit:54f54850
语义护栏：普通形态的剥除结果与旧式一致	dup:algebra-directives 聚合矩阵	commit:54f54850
内层同名 function f() 的见证 ⇒ 不报 case-inconsistency	dup:algebra-directives 聚合矩阵	commit:54f54850
对照组 1：内层函数改名 g ⇒ 同样不报（单变量对照）	dup:algebra-directives 聚合矩阵	commit:54f54850
对照组 2：外层函数自己的违例见证仍报 error（不因修复而假绿）	dup:algebra-directives 聚合矩阵	commit:54f54850
对照组 3：外层函数自己的合规见证不报	dup:algebra-directives 聚合矩阵	commit:54f54850
含 $ 的导出函数名被回收	dup:algebra-directives 聚合矩阵	commit:54f54850
含非 ASCII 的导出函数名被回收	dup:algebra-directives 聚合矩阵	commit:54f54850
含 $ / 非 ASCII 的导出 const 名被回收	dup:algebra-directives 聚合矩阵	commit:54f54850
导出函数**被分析**（throws 面如实，不再从不被分析）	dup:algebra-directives 聚合矩阵	commit:54f54850
stripStaticExportDecls 文本口径也放宽（$ / 非 ASCII）	dup:algebra-directives 聚合矩阵	commit:54f54850
ASCII 同形口径不变（对照组）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:assume 中文名 → 合法（不再是 malformed）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:assume `>=` 仍翻转为 le（中文名同样成立）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:invariant 中文名 → 合法	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:invariant 中文路径段 → 合法	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:contract 中文形参名 → 契约生效	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:contract `$x` 形参名 → 合法（旧 ASCII 正则不收 `$`）	dup:algebra-directives 聚合矩阵	commit:54f54850
非法的形参名仍被判 malformed（不放宽成任意串）	dup:algebra-directives 聚合矩阵	commit:54f54850
error: 对象见证 ⊭ 标量契约（number()）——改前机制②归一成 unknown 后静默跳过	dup:algebra-directives 聚合矩阵	commit:54f54850
error: shape 契约的字段类型不符——改前机制①把 fields 契约整条跳过	dup:algebra-directives 聚合矩阵	commit:54f54850
error: shape 契约缺字段 → missing field <path>	dup:algebra-directives 聚合矩阵	commit:54f54850
error: 嵌套 shape 的字段违例（路径逐段下钻）	dup:algebra-directives 聚合矩阵	commit:54f54850
error: shape 契约的字段数值界违例	dup:algebra-directives 聚合矩阵	commit:54f54850
ok: 满足 shape 契约的见证不报	dup:algebra-directives 聚合矩阵	commit:54f54850
ok: 满足标量契约的对象见证不报（any() 通吃结构）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 既有标量通道输出零改动（bounds 违例仍报 x > 0）	dup:algebra-directives 聚合矩阵	commit:54f54850
error: 多行实参的违例见证（改前整条见证被跳过 ⇒ 零诊断 / 假绿）	dup:algebra-directives 聚合矩阵	commit:54f54850
ok: 多行实参满足契约不报	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 同一见证写成单行仍报同一条（改前只多行形态假绿）	dup:algebra-directives 聚合矩阵	commit:54f54850
error: `"a\", -1` 切 2 个实参 ⇒ 第二个实参的违例见证被检出	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 无转义引号的同形见证报同一条（改前两条都报 ⇒ 实参个数相同）	dup:algebra-directives 聚合矩阵	commit:54f54850
warning: 契约位上的实参认不出 ⇒ nudo:directive-syntax	dup:algebra-directives 聚合矩阵	commit:54f54850
warning: 契约位上没有见证实参 ⇒ nudo:directive-syntax	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 无契约位的认不出实参不产见证面诊断（parser 面自行诊断）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 约束构建器实参（number()）是合法形态 ⇒ 跳过但**不产诊断**	dup:algebra-directives 聚合矩阵	commit:54f54850
space-separated env list is recognized (was dropped as one token)	dup:algebra-directives 聚合矩阵	commit:54f54850
comma-separated env list still works (control)	dup:algebra-directives 聚合矩阵	commit:54f54850
mixed separators are accepted	dup:algebra-directives 聚合矩阵	commit:54f54850
trailing line comment is stripped	dup:algebra-directives 聚合矩阵	commit:54f54850
path-like env names survive whitespace splitting	dup:algebra-directives 聚合矩阵	commit:54f54850
bare tag yields no env names (diagnostic lands on the AST channel)	dup:algebra-directives 聚合矩阵	commit:54f54850
truncated capture is still rejected (zero false positives)	dup:algebra-directives 聚合矩阵	commit:54f54850
内联形态：见证落在 f 上	dup:algebra-directives 聚合矩阵	commit:54f54850
内联形态：不再产生 <anonymous> 影子 scope	dup:algebra-directives 聚合矩阵	commit:54f54850
内联形态：按名查找拿到 f 的注释行	dup:algebra-directives 聚合矩阵	commit:54f54850
语句级形态（对照）：见证同样落在 f 上	dup:algebra-directives 聚合矩阵	commit:54f54850
函数表达式初始化器的内联形态同样绑到绑定名	dup:algebra-directives 聚合矩阵	commit:54f54850
extractBalancedParens: 双引号串里的 `\"` 不结束字符串	dup:algebra-directives 聚合矩阵	commit:54f54850
extractBalancedParens: 对象 / 数组字面量里的转义引号同样配平	dup:algebra-directives 聚合矩阵	commit:54f54850
extractBalancedParens: 单引号串里的 `\'` 不结束字符串	dup:algebra-directives 聚合矩阵	commit:54f54850
scanCaseTags: 含转义引号的 case 被抽出（改前整条被丢弃）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制（Bug 1009 口径保留）: 串未闭合时回退宽松口径 ⇒ 实参个数不变	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 无转义引号的普通实参不受影响	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:assume 空载荷 → nudo:assume-invalid（error）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:invariant 空载荷 → nudo:invariant-invalid（warning）	dup:algebra-directives 聚合矩阵	commit:54f54850
空载荷（纯空白）与合法载荷不回归	dup:algebra-directives 聚合矩阵	commit:54f54850
合法 assume / invariant 零诊断（不误伤）	dup:algebra-directives 聚合矩阵	commit:54f54850
bare tag is reported as a malformed import	dup:algebra-directives 聚合矩阵	commit:54f54850
bare tag with trailing blank is reported as a malformed import	dup:algebra-directives 聚合矩阵	commit:54f54850
empty payload produces no import record (only a diagnostic)	dup:algebra-directives 聚合矩阵	commit:54f54850
empty payload is malformed at the grammar level too	dup:algebra-directives 聚合矩阵	commit:54f54850
valid and other malformed forms keep their behaviour (control)	dup:algebra-directives 聚合矩阵	commit:54f54850
CRLF: 期望被抽出（改前整条期望消失）	dup:algebra-directives 聚合矩阵	commit:54f54850
LF（负控制）: 期望照旧被抽出	dup:algebra-directives 聚合矩阵	commit:54f54850
CRLF: 块注释续行形态的期望同样被抽出	dup:algebra-directives 聚合矩阵	commit:54f54850
CRLF: 无期望的 case 不受影响（expectedText 仍为 undefined）	dup:algebra-directives 聚合矩阵	commit:54f54850
后缀在 `=>` 之前: 期望照旧被抽出（改前整条期望消失）	dup:algebra-directives 聚合矩阵	commit:54f54850
后缀在 `=>` 之后: 期望文本不被腐蚀（改前是 `1 !! throws`）	dup:algebra-directives 聚合矩阵	commit:54f54850
后缀带 kind: 期望文本只剩期望本身	dup:algebra-directives 聚合矩阵	commit:54f54850
文档化形态（只有后缀、没有 `=>`）: 没有期望（后缀是**申报**不是期望）	dup:algebra-directives 聚合矩阵	commit:54f54850
回归护栏: case 行本身不被改写 ⇒ `!! throws` 后缀申报仍在	dup:algebra-directives 聚合矩阵	commit:54f54850
回归护栏: 后缀在 `=>` 之后时**申报口径不变**（既有约定：后缀须紧跟实参括号）	dup:algebra-directives 聚合矩阵	commit:54f54850
数字字面量: `=> (999)` ⇒ `999`	dup:algebra-directives 聚合矩阵	commit:54f54850
字符串字面量: `=> ("abc")` ⇒ `"abc"`	dup:algebra-directives 聚合矩阵	commit:54f54850
对象字面量: `=> ({ b: 1 })` ⇒ `{ b: 1 }`	dup:algebra-directives 聚合矩阵	commit:54f54850
元组字面量: `=> ([1, 2])` ⇒ `[1, 2]`	dup:algebra-directives 聚合矩阵	commit:54f54850
多层括号: 逐层剥到表达式本体	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 无括号形态不受影响	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 箭头函数不被误剥（`(x) => y` 的括号不是冗余层）	dup:algebra-directives 聚合矩阵	commit:54f54850
无 filename 时 `<number>1` 解析成功（降级重试命中）	dup:algebra-directives 聚合矩阵	commit:54f54850
带 filename=x.ts 时同样解析成功	dup:algebra-directives 聚合矩阵	commit:54f54850
引擎端到端：`<number>1` 求值为字面量 1（剥除面已就绪）	dup:algebra-directives 聚合矩阵	commit:54f54850
泛型箭头 `<T>(x) => x`（无尾逗号）在硬失败路径下被重试救回	dup:algebra-directives 聚合矩阵	commit:54f54850
真 JSX 源不受降级影响（TS+JSX 本就解析成功 ⇒ 不触发重试）	dup:algebra-directives 聚合矩阵	commit:54f54850
模式分流仍在：`.ts` 收 TS 语法、`.js` 不收（缓存键含模式 ⇒ 不串味）	dup:algebra-directives 聚合矩阵	commit:54f54850
the argument region of a malformed case is registered as a span	dup:algebra-directives 聚合矩阵	commit:54f54850
the tag itself is NOT masked (the malformed-name diagnostic still fires)	dup:algebra-directives 聚合矩阵	commit:54f54850
a well-formed case still masks its whole tag+arguments region	dup:algebra-directives 聚合矩阵	commit:54f54850
a case without an argument list registers no span	dup:algebra-directives 聚合矩阵	commit:54f54850
env inside a function body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
mock-module inside a function body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:import inside a function body is not file-wide	dup:algebra-directives 聚合矩阵	commit:54f54850
the same directives at the top of the file are honored	dup:algebra-directives 聚合矩阵	commit:54f54850
a top-level directive after other statements is still honored	dup:algebra-directives 聚合矩阵	commit:54f54850
a directive on an export line is still honored	dup:algebra-directives 聚合矩阵	commit:54f54850
形态 A: 期望值在下一行 ⇒ 期望被抽出	dup:algebra-directives 聚合矩阵	commit:54f54850
形态 A（无续行前缀）: 期望值在下一行 ⇒ 期望被抽出	dup:algebra-directives 聚合矩阵	commit:54f54850
形态 B: `=>` 后为空 ⇒ 没有期望，但**产出行首锚的语法错**（不再静默）	dup:algebra-directives 聚合矩阵	commit:54f54850
形态 B（续行也没有值）: 同样产出行首锚的语法错	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 同行形态照旧（期望被抽出、无语法错）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 没有 `=>` 的 case（本就无期望）不产语法错	dup:algebra-directives 聚合矩阵	commit:54f54850
粘连写法: 不被抽成 case（抽取侧要求 `[ \t]+`）	dup:algebra-directives 聚合矩阵	commit:54f54850
粘连写法: 在诊断面**看得见**（畸形剩余文本非空）	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 规范形态照旧被抽成 case、且不产畸形剩余	dup:algebra-directives 聚合矩阵	commit:54f54850
负控制: 其它畸形形态仍被诊断面看见	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:contractx → nudo:contract-syntax（warning）	dup:algebra-directives 聚合矩阵	commit:54f54850
@nudo:contract 空载荷 → nudo:contract-syntax（warning）	dup:algebra-directives 聚合矩阵	commit:54f54850
合法 @nudo:contract 零 contract-syntax（不误伤）	dup:algebra-directives 聚合矩阵	commit:54f54850
散文里的 @nudo:contract（行中提及）不算指令（不误伤）	dup:algebra-directives 聚合矩阵	commit:54f54850
```
