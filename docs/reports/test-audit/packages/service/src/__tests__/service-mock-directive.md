```audit
title	rootCause	gap	action	status	evidence
单孤儿一条；孤儿+生效仍一条且文案不变；生效指令入表；两孤儿各一条	内建 mock/孤儿表	没测该层	keep	keep	—
内建 mock 生效/产品面同值/负控；绑定图第二合并点同口径	内建 mock/孤儿表	没测该层	keep	keep	—
新四指令识别并纳入；既有指令不回退；无指令/字符串假命中仍排除	覆盖/模式契约表	没测该层	keep	keep	—
各函数取各自 mock（顺序无关）；单 mock 不泄漏；产物面同值	覆盖/模式契约表	没测该层	keep	keep	—
分析面覆盖生效；无指令邻句/非语句节点/空源负控	覆盖/模式契约表	没测该层	keep	keep	—
14 个容器都收集 @nudo:as；for 体 @nudo:replace 也收集	覆盖/模式契约表	没测该层	keep	keep	—
rejects 是 promise 面不是 never；string() 契约报 unproven；resolves/returns 不变	severity/ctor/rejects 表	没测该层	keep	keep	—
箭头不可构造；function 表达式可构造；from/本地箭头仍是 caught	severity/ctor/rejects 表	没测该层	keep	keep	—
表达式解析失败 = warning（两通道一致）；缺 mock 文件仍是 error	severity/ctor/rejects 表	没测该层	keep	keep	—
同名取最浅；E 不越界；pure 同裁决	skip 词法绑定表	没测该层	keep	keep	—
绑定位/对象键位不算命中且诊断；属性值命中生效；未命中告警	mock 中段契约表	没测该层	keep	keep	—
只在声明函数生效；同函数作为依赖/目标一致	mock 中段契约表	没测该层	keep	keep	—
重复点名两条来源且合并导出；单条零诊断；门禁 warning；局部形态并集	mock 中段契约表	没测该层	keep	keep	—
写错目标点名诊断；写对零诊断且命中区间；无指令零诊断；门禁 warning	mock 中段契约表	没测该层	keep	keep	—
skip 未声明返回仍声明 unknown；普通函数不受影响	mock 中段契约表	没测该层	keep	keep	—
as/replace 不泄漏进 if 块/嵌套函数/同行下一条；正例仍生效	mock 中段契约表	没测该层	keep	keep	—
throws/副作用保留；覆盖仍生效；相邻子表达式不受影响	mock 中段契约表	没测该层	keep	keep	—
点名缺失 fail-closed；提供者 overlay；未点名回落；多缺失/ default；check 面；全替换不受影响	mock/点名缺失契约表	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
@nudo:mock Number 生效（宿主 Number 不再应答）	dup:mock/点名缺失契约表	commit:439e7ca5
@nudo:mock Math 生效（宿主 Math.floor 不再应答）	dup:mock/点名缺失契约表	commit:439e7ca5
@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）	dup:mock/点名缺失契约表	commit:439e7ca5
@nudo:mock Date 生效（宿主 Date.now 不再应答）	dup:mock/点名缺失契约表	commit:439e7ca5
产品面（analyzeFileAsync / nudo test 的 case 值）同值	dup:mock/点名缺失契约表	commit:439e7ca5
a named export the mock does not provide is a fail-closed error, not a silent fall-through	dup:mock/点名缺失契约表	commit:439e7ca5
names the mock does provide still overlay, unnamed exports still fall through (regression guard)	dup:mock/点名缺失契约表	commit:439e7ca5
reports every missing named export	dup:mock/点名缺失契约表	commit:439e7ca5
a missing `default` named export is reported the same way	dup:mock/点名缺失契约表	commit:439e7ca5
surfaces on the check face as nudo:module-missing (error)	dup:mock/点名缺失契约表	commit:439e7ca5
full replacement (no names list) is unaffected	dup:mock/点名缺失契约表	commit:439e7ca5
被替换调用的 throws 域保留（L2 门禁不再假绿）	dup:mock 中段契约表	commit:9cf95a50
被替换调用的副作用保留（求值发生，结果取注入值）	dup:mock 中段契约表	commit:9cf95a50
负控制：未被标注的相邻子表达式照常求值	dup:mock 中段契约表	commit:9cf95a50
@nudo:as 挂在 if 上不泄漏进块内的 return	dup:mock 中段契约表	commit:9cf95a50
@nudo:replace 不泄漏进嵌套函数体	dup:mock 中段契约表	commit:9cf95a50
@nudo:replace 只作用于被标注的那条语句（同行下一条不受影响）	dup:mock 中段契约表	commit:9cf95a50
负控制：指令仍作用于它标注的那条语句	dup:mock 中段契约表	commit:9cf95a50
负控制：@nudo:as 仍覆盖紧随语句的 init	dup:mock 中段契约表	commit:9cf95a50
skip 且未声明返回 ⇒ 仍然声明成 unknown（与 check 同源、TS 投影面归一）	dup:mock 中段契约表	commit:9cf95a50
对照组：未 skip 的普通函数仍然走推断面（不受本修法影响）	dup:mock 中段契约表	commit:9cf95a50
② 目标写错 ⇒ 有一条点名目标文本的诊断	dup:mock 中段契约表	commit:9cf95a50
① 目标写对 ⇒ 零该诊断（且指令确实命中了节点）	dup:mock 中段契约表	commit:9cf95a50
③ 根本没有该指令 ⇒ 零该诊断（不许误报）	dup:mock 中段契约表	commit:9cf95a50
② 与 ③ 可区分（改前两者的诊断集逐字相同）	dup:mock 中段契约表	commit:9cf95a50
门禁面可见：warning 级（不挡 exit），且文案点名目标	dup:mock 中段契约表	commit:9cf95a50
② 重复声明 ⇒ 有一条点名两条来源的诊断	dup:mock 中段契约表	commit:9cf95a50
① 单条声明 ⇒ 零该诊断（不许误报）	dup:mock 中段契约表	commit:9cf95a50
② 重复后先声明者的导出名不得静默消失（不退化成 unknown）	dup:mock 中段契约表	commit:9cf95a50
门禁面可见：warning 级（不挡 exit）	dup:mock 中段契约表	commit:9cf95a50
重复声明不影响单条声明的既有口径（局部形态：未点名的名字回落原模块）	dup:mock 中段契约表	commit:9cf95a50
applies in the declaring function only (entry B)	dup:mock 中段契约表	commit:9cf95a50
same function keeps the same result as a direct target (entry A)	dup:mock 中段契约表	commit:9cf95a50
目标命中声明符 id（绑定位）⇒ 不算命中 + 显式诊断	dup:mock 中段契约表	commit:9cf95a50
目标命中对象属性键位 ⇒ 不算命中 + 显式诊断	dup:mock 中段契约表	commit:9cf95a50
对照组：目标命中属性值（表达式位）⇒ 命中有区间、零诊断、替换生效	dup:mock 中段契约表	commit:9cf95a50
对照组：目标全文未命中 ⇒ 仍然是「matched no expression」告警	dup:mock 中段契约表	commit:9cf95a50
C：内层同名函数的 skip 不再顶掉外层（C 的签名 == D 的签名）	dup:skip 词法绑定表	commit:0c774c7b
E：外层没有 skip ⇒ 内层同名 skip 不越界（该名不进 skip 表）	dup:skip 词法绑定表	commit:0c774c7b
E 与 F 的签名逐字相同（导出函数的 throws 标注不再被抹掉）	dup:skip 词法绑定表	commit:0c774c7b
内层函数自己的 skip 仍按最浅同名者裁决（不同名时照常绑定）	dup:skip 词法绑定表	commit:0c774c7b
同族 @nudo:pure 用同一裁决（内层同名 pure 不标记外层）	dup:skip 词法绑定表	commit:0c774c7b
mock expression parse failure is a warning, not an error	dup:severity/ctor/rejects 表	commit:fa5d4c96
both mock-invalid channels (static validation + mock seed) agree	dup:severity/ctor/rejects 表	commit:fa5d4c96
missing mock file stays an error (no fake green)	dup:severity/ctor/rejects 表	commit:fa5d4c96
内联箭头 mock：new 定抛 ⇒ 走 catch 分支（原生 caught，修复前 mocked）	dup:severity/ctor/rejects 表	commit:fa5d4c96
内联 mock 的种子带 ctor facet（箭头 ⇒ 不可构造）	dup:severity/ctor/rejects 表	commit:fa5d4c96
内联 function 表达式 mock：可构造（ctor:true），不走 catch 分支	dup:severity/ctor/rejects 表	commit:fa5d4c96
返回类型是 promise 面（eff/promise），不是 never	dup:severity/ctor/rejects 表	commit:fa5d4c96
返回契约不再被 never 空洞满足（string() 判为不满足 ⇒ 报 unproven-return）	dup:severity/ctor/rejects 表	commit:fa5d4c96
收集 for 循环体里的 @nudo:replace	dup:覆盖/模式契约表	commit:692ab090
先声明的函数不再被后声明的同名 mock 改写成错类型	dup:覆盖/模式契约表	commit:692ab090
声明顺序互换不改变各自的取值（不再纯源序 last-wins）	dup:覆盖/模式契约表	commit:692ab090
种子表保留每个作用域各自的那一份（scoped + 覆盖表）	dup:覆盖/模式契约表	commit:692ab090
hasNudoDirectives 认得 assume/invariant/throws/budget	dup:覆盖/模式契约表	commit:692ab090
shouldAnalyzeFile 纳入只含这四个指令的文件（改前：整份文件被跳过 → 假绿）	dup:覆盖/模式契约表	commit:692ab090
负控制：无指令 / 指令只在字符串里 → 仍不纳入	dup:覆盖/模式契约表	commit:692ab090
负控制：已在名单里的指令名不得回退	dup:覆盖/模式契约表	commit:692ab090
文件级指令形态（/// @nudo:env）也纳入	dup:覆盖/模式契约表	commit:692ab090
普通名 mock 仍生效（改前就生效，不得回退）	dup:已被矩阵吸收	commit:2f78285c
mock 覆盖 env 的优先级不变（同名时 mock 赢）	dup:已被矩阵吸收	commit:2f78285c
env 全局仍受跳过表约束（env 的 Math 不遮蔽宿主 Math）	dup:已被矩阵吸收	commit:2f78285c
没有 mock 时宿主应答不变	dup:已被矩阵吸收	commit:2f78285c
collectAbsBindingsFromGraph：宿主内建名的 mock 生效（顶层 const 求值面）	dup:已被矩阵吸收	commit:2f78285c
无指令的语句不受同函数内其它指令影响	dup:已被矩阵吸收	commit:2f78285c
指令挂在非语句节点上——不产生注入（无处可施），且发显式诊断	dup:已被矩阵吸收	commit:2f78285c
无任何行内指令的源码不产生诊断	dup:已被矩阵吸收	commit:2f78285c
声明函数取值一致；未声明函数看不到该 mock	dup:已被矩阵吸收	commit:2f78285c
无冲突时不产生作用域覆盖表（不留冗余状态）	dup:已被矩阵吸收	commit:2f78285c
readA / readB 各自取各自的 mock（接线前：先声明的也被后声明的改写）	dup:已被矩阵吸收	commit:2f78285c
from 形态（mock 文件导出箭头）仍是 caught	dup:已被矩阵吸收	commit:2f78285c
本地 const 箭头（不加 mock）仍是 caught	dup:已被矩阵吸收	commit:2f78285c
resolves 形态仍是 promise<42>	dup:已被矩阵吸收	commit:2f78285c
returns 形态仍是同步值 42	dup:已被矩阵吸收	commit:2f78285c
resolves 形态在同契约下同样报 unproven-return（口径一致）	dup:已被矩阵吸收	commit:2f78285c
第二合并点：collectAbsBindingsFromGraph 也尊重宿主内建 mock	dup:内建 mock/孤儿表	commit:86932bb1
宿主内建 mock 生效；产品面同值；负控制普通名/优先级/跳过表/无 mock	dup:内建 mock/孤儿表	commit:86932bb1
只有孤儿指令 ⇒ 有一条「无处可施」诊断（既有口径）	dup:内建 mock/孤儿表	commit:86932bb1
孤儿 + 一条生效的 @nudo:as ⇒ 孤儿诊断**仍然在场**（改前被抑制为 0）	dup:内建 mock/孤儿表	commit:86932bb1
生效的那条 @nudo:as 照旧进入收集表（抑制解除没有副作用）	dup:内建 mock/孤儿表	commit:86932bb1
两处孤儿各报一条（改前合并成一条）	dup:内建 mock/孤儿表	commit:86932bb1
```
