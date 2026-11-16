# packages/lsp/src/__tests__/lsp-check-contract.test.ts

模块套件：check/contract/inject/relax 面。

审计：72 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件；references@imported 侧：不是空数组，且与无别名形态完全一致；definition@local 侧：仍然落到真正被导入的模块	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）；正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw；负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw；负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）；落盘后目标参数诊断消失（编辑真的可执行，不是假修复）；参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽；证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑；证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留；返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）；正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
"每条 lens 标题在 CLI 报告里是 ` <title>`；throws 分支为 3 空格"	"LSP codeLens 标题与 CLI `nudo test` 见证行**不同形**。 症状（同文件、同分析，两面并排）： - CLI `nudo test` 见证行：`\" entry@L1 (any) => unknown throws TypeError\"` （2 格容器缩进 + throws 前 **3** 空格）； 断言：expect(titles.length, `lenses 为空 ⇒ 无法对拍`).toBeGreaterThan(0);；expect("	没测该层	keep	keep	—
@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）；负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
collectBindingReferences：导出绑定不产生语句级伪引用；协议面：references 的每个位置只出现一次	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
default 导出的定义处能查到 default 导入方的 import 说明符与调用点；default 导入方一侧发起 references 也能覆盖定义文件	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
成员属性 helper 的 definition 不得跳到无关文件的同名导出；裸标识符仍能命中同名导出兜底（兜底本身没坏）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
collectBindingReferences：includeDeclaration=false 不含声明位；collectBindingReferences：默认仍含声明位（既有语义不变，负控制）；协议面：includeDeclaration=false 只返回用点	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
definition 落在 buffer 坐标（磁盘坐标会跳错行）；references 落在 buffer 坐标；rename 的编辑落在 buffer 坐标	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）；字段已在契约里 ⇒ 不给插入点（不写重复键）；目标形参的契约类型不是内联 shape ⇒ 不给插入点；LSP 面：契约缺字段时，补字段动作落在 shape 内部；LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
插入点落进对象字面量，字符串字面量原样保留；同一行既有字符串 `{` 又有对象字面量时也落进对象字面量	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）；dot 形式：同一条通道同样可见（协议别名不降级）；文本面：error 级通道上屏（不再是「0 error」判绿）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from；工具面：dry-run 只预览、不写下游侧车；协议面：nudo.contract.emit 同样产出下游侧车	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车；root 外的文件 ⇒ 仍然拒绝；指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）；nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case；普通 .js 目标不受闸门影响（仍能分析）；dot 形式同样过闸门	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）；对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）；形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）；union 契约参数保留声明形态（判别联合折叠不回归）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）；pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）；默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
指令文法诊断（nudo:directive-syntax）并入 issues + summary；path env 未解析（nudo:env-unresolved）并入 issues + summary；dot 形式同样接上（协议别名不降级）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
协议面 nudo/contract：带 from ⇒ 使用点证据参与求解；协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）；工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）；from 指向不存在的路径 ⇒ 显式报错（不静默给假面）	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
documentSymbol 出 CJS 成员导出（函数档，detail 带 export）；workspace/symbol 查得到 CJS 成员导出；semanticTokens 给 CJS 导出键 function 档 + contract 档 modifier；inlayHint 出 CJS 导出的返回 inlay + contract 档投影；codeLens 出 CJS 导出的 contract 档（契约身份 = 导出名）；hover 面解析出 CJS 导出名（族	lsp-check-contract 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
references@imported 侧：不是空数组，且与无别名形态完全一致	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
definition@local 侧：仍然落到真正被导入的模块	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
落盘后目标参数诊断消失（编辑真的可执行，不是假修复）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
collectBindingReferences：导出绑定不产生语句级伪引用	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
协议面：references 的每个位置只出现一次	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
default 导出的定义处能查到 default 导入方的 import 说明符与调用点	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
default 导入方一侧发起 references 也能覆盖定义文件	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
成员属性 helper 的 definition 不得跳到无关文件的同名导出	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
裸标识符仍能命中同名导出兜底（兜底本身没坏）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
collectBindingReferences：includeDeclaration=false 不含声明位	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
collectBindingReferences：默认仍含声明位（既有语义不变，负控制）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
协议面：includeDeclaration=false 只返回用点	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
definition 落在 buffer 坐标（磁盘坐标会跳错行）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
references 落在 buffer 坐标	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
rename 的编辑落在 buffer 坐标	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
字段已在契约里 ⇒ 不给插入点（不写重复键）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
目标形参的契约类型不是内联 shape ⇒ 不给插入点	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
LSP 面：契约缺字段时，补字段动作落在 shape 内部	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
插入点落进对象字面量，字符串字面量原样保留	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
同一行既有字符串 `{` 又有对象字面量时也落进对象字面量	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
dot 形式：同一条通道同样可见（协议别名不降级）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
文本面：error 级通道上屏（不再是「0 error」判绿）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
工具面：dry-run 只预览、不写下游侧车	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
协议面：nudo.contract.emit 同样产出下游侧车	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
root 外的文件 ⇒ 仍然拒绝	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
普通 .js 目标不受闸门影响（仍能分析）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
dot 形式同样过闸门	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
union 契约参数保留声明形态（判别联合折叠不回归）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
指令文法诊断（nudo:directive-syntax）并入 issues + summary	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
path env 未解析（nudo:env-unresolved）并入 issues + summary	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
dot 形式同样接上（协议别名不降级）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
协议面 nudo/contract：带 from ⇒ 使用点证据参与求解	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
from 指向不存在的路径 ⇒ 显式报错（不静默给假面）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
documentSymbol 出 CJS 成员导出（函数档，detail 带 export）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
workspace/symbol 查得到 CJS 成员导出	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
semanticTokens 给 CJS 导出键 function 档 + contract 档 modifier	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
inlayHint 出 CJS 导出的返回 inlay + contract 档投影	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
codeLens 出 CJS 导出的 contract 档（契约身份 = 导出名）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
hover 面解析出 CJS 导出名（族 25 收口接线：position.ts 补 MemberExpression property 分支）	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
回归护栏：ESM 具名导出的符号面不受影响	dup:lsp-check-contract 聚合矩阵	commit:d25e91ca
```
