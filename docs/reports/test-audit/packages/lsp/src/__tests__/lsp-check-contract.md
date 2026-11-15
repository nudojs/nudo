# packages/lsp/src/__tests__/lsp-check-contract.test.ts

模块套件：72 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件"	"import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧** 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿） ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。 报告说的症状（**假阳性 —— 两个症状都不复现**）： 夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；"	夹具漏形态	keep	keep	—
"references@imported 侧：不是空数组，且与无别名形态完全一致"	"唯一变量 = 有没有别名 ⇒ 两侧的引用集必须**完全一致** import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧** 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿） ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。 报告说的症状（**假阳性 —— 两个症状都不复现**）： 夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；"	夹具漏形态	keep	keep	—
"definition@local 侧：仍然落到真正被导入的模块"	"import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧** 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿） ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。 报告说的症状（**假阳性 —— 两个症状都不复现**）： 夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；"	夹具漏形态	keep	keep	—
"正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）"	"env 全局可见 ⇒ 也不该报「内建 API 未覆盖」 真违约：入口真的抛 ⇒ 必须报 L2（负控制）。"	夹具漏形态	keep	keep	—
"正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw"	"真违约：入口真的抛 ⇒ 必须报 L2（负控制）。"	没测该层	keep	keep	—
"负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw"	"真违约：入口真的抛 ⇒ 必须报 L2（负控制）。"	没测该层	keep	keep	—
"负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw"	"真违约：入口真的抛 ⇒ 必须报 L2（负控制）。"	没测该层	keep	keep	—
"参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）"	"标题必须指出目标槽：`greet` 后面带 `.u`（旧实现标题只有 `greet`） 落盘后：只放宽了 u，返回槽的 `.gt(40)` 一字未动 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"落盘后目标参数诊断消失（编辑真的可执行，不是假修复）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽"	"目标确实是参数违例（expected: missing field u.name） 旧实现会下发标题「Relax sidecar contract for greet」→ 改返回槽 ⇒ 参数诊断仍在 任何候选动作都不得削弱返回契约 参数违例本身仍引导用户改**调用点** 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）"	"旧 quickfix 的落盘结果：返回槽 number().gt(40) → number() 参数诊断原样保留 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑"	"旧实现下发「Relax sidecar contract for greet」⇒ 只剥 .gt(40) ⇒ 诊断还在 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失"	"返回槽（不是形参）⇒ 标题不带 `.u` 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"每条 lens 标题在 CLI 报告里是 ` <title>`；throws 分支为 3 空格"	"① LSP → CLI：每条 lens 标题在报告里逐字符命中（含 2 格容器缩进） ② CLI → LSP：报告里每条 call@ / entry@ 见证行都有同标题的 lens ③ throws 分支的绝对形态：`=> unknown` 与 `throws TypeError` 之间 3 空格 改前是 2 空格 ⇒ 这条断言把形态钉死（不靠两面互相自证） lens 标题不带容器缩进； LSP codeLens 标题与 CLI `nudo test` 见证行**不同形**。 症状（同文件、同分析，两面并排）： -"	夹具漏形态	keep	keep	—
"@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）"	"无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛"	没测该层	keep	keep	—
"负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）"	"无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛"	没测该层	keep	keep	—
"collectBindingReferences：导出绑定不产生语句级伪引用"	"不得出现覆盖整条声明的「引用」 回归钉：LSP `textDocument/references` 不得把**声明位点返回两次**， 也不得混入语句级伪引用。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： references on `score`（`export function score(row) {...}` 的声明位） → [0:16-0:21]（声明）、[0:16-0:21]（**同一个声明再来一次**）、 [0:0-2:1]（**整条 export 声明**"	没测该层	keep	keep	—
"协议面：references 的每个位置只出现一次"	"同一位置不得出现两次 声明位恰好一次 不得混入覆盖整条 export 声明的伪引用 回归钉：LSP `textDocument/references` 不得把**声明位点返回两次**， 也不得混入语句级伪引用。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： references on `score`（`export function score(row) {...}` 的声明位） → [0:16-0:21]（声明）、[0:16-0:21]（**同一个声明再来一次**）、"	没测该层	keep	keep	—
"default 导出的定义处能查到 default 导入方的 import 说明符与调用点"	"症状：definition 能跳到 default 导出的定义，references 却查不到任何调用方 （自相矛盾）。 根因：跨文件引用匹配用的是**导出名**，而 default 导入的 importedName 是 \"default\"、被查符号的本地名是 \"greet\" ⇒ 永远匹配不上。"	没测该层	keep	keep	—
"default 导入方一侧发起 references 也能覆盖定义文件"	"症状：definition 能跳到 default 导出的定义，references 却查不到任何调用方 （自相矛盾）。 根因：跨文件引用匹配用的是**导出名**，而 default 导入的 importedName 是 \"default\"、被查符号的本地名是 \"greet\" ⇒ 永远匹配不上。"	没测该层	keep	keep	—
"成员属性 helper 的 definition 不得跳到无关文件的同名导出"	"症状：`o.helper()` 的 helper 没有来源，却命中「同名导出兜底」跳到 另一个文件里毫不相干的 `export function helper`。"	夹具漏形态	keep	keep	—
"裸标识符仍能命中同名导出兜底（兜底本身没坏）"	"症状：`o.helper()` 的 helper 没有来源，却命中「同名导出兜底」跳到 另一个文件里毫不相干的 `export function helper`。"	夹具漏形态	keep	keep	—
"collectBindingReferences：includeDeclaration=false 不含声明位"	"改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： references on `v`（a 内），includeDeclaration=false → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌ （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组， 管不到引用集合里的声明位） 根因：`collectBindingReferences` 无条件把绑定声明位（`binding"	夹具漏形态	keep	keep	—
"collectBindingReferences：默认仍含声明位（既有语义不变，负控制）"	"改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： references on `v`（a 内），includeDeclaration=false → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌ （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组， 管不到引用集合里的声明位） 根因：`collectBindingReferences` 无条件把绑定声明位（`binding"	夹具漏形态	keep	keep	—
"协议面：includeDeclaration=false 只返回用点"	"负控制：includeDeclaration=true 时声明位必须在 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： references on `v`（a 内），includeDeclaration=false → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌ （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组， 管不到引用集合里的声明位） 根因：`collectB"	夹具漏形态	keep	keep	—
"definition 落在 buffer 坐标（磁盘坐标会跳错行）"	"未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基）"	没测该层	keep	keep	—
"references 落在 buffer 坐标"	"未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基）"	没测该层	keep	keep	—
"rename 的编辑落在 buffer 坐标"	"未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基）"	没测该层	keep	keep	—
"插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）"	"根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(` 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。 钉（插入点契约）： 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；"	没测该层	keep	keep	—
"字段已在契约里 ⇒ 不给插入点（不写重复键）"	"根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(` 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。 钉（插入点契约）： 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；"	没测该层	keep	keep	—
"目标形参的契约类型不是内联 shape ⇒ 不给插入点"	"共享 shape 标识符 标量形参 形参不存在 目标 fn 不存在 根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(` 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。 钉（插入点契约）： 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；"	没测该层	keep	keep	—
"LSP 面：契约缺字段时，补字段动作落在 shape 内部"	"形参表没被动过（不多出形参） 根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(` 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。 钉（插入点契约）： 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；"	没测该层	keep	keep	—
"LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作"	"根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(` 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。 钉（插入点契约）： 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；"	没测该层	keep	keep	—
"插入点落进对象字面量，字符串字面量原样保留"	"对象字面量的 `{` 在第 5 行第 2 列 ⇒ 插入点 = 第 5 行第 3 列 字符串字面量没被插字段 字段落进对象字面量 调用起始行只有一个 `{`，且它在字符串字面量里；"	夹具漏形态	keep	keep	—
"同一行既有字符串 `{` 又有对象字面量时也落进对象字面量"	"调用起始行只有一个 `{`，且它在字符串字面量里；"	夹具漏形态	keep	keep	—
"slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）"	"LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。 症状（改前）：夹具 `@nudo:mock helper from \"./no-such-mock.js\"`（mock 文件 不存在）⇒ CLI `nudo check --json` 报 **error 级 `nudo:module-missing`** （判红），agent 工具面**整条通道消失**（判绿）——同一文件两个面两种结论。"	夹具漏形态	keep	keep	—
"dot 形式：同一条通道同样可见（协议别名不降级）"	"LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。 症状（改前）：夹具 `@nudo:mock helper from \"./no-such-mock.js\"`（mock 文件 不存在）⇒ CLI `nudo check --json` 报 **error 级 `nudo:module-missing`** （判红），agent 工具面**整条通道消失**（判绿）——同一文件两个面两种结论。"	夹具漏形态	keep	keep	—
"文本面：error 级通道上屏（不再是「0 error」判绿）"	"LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。 症状（改前）：夹具 `@nudo:mock helper from \"./no-such-mock.js\"`（mock 文件 不存在）⇒ CLI `nudo check --json` 报 **error 级 `nudo:module-missing`** （判红），agent 工具面**整条通道消失**（判绿）——同一文件两个面两种结论。"	夹具漏形态	keep	keep	—
"工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from"	"结果文本必须有下游侧车这一行（CLI 口径：Updated <root> → <sidecar> (derived-from …)） 下游侧车真的落盘了 本地侧车（手写 name-clash）的诊断**仍在**（没被推导步吞掉） `nudo.contract.emit` 必须走 **root 驱动下行推导** （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒ - C"	没测该层	keep	keep	—
"工具面：dry-run 只预览、不写下游侧车"	"`nudo.contract.emit` 必须走 **root 驱动下行推导** （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒ - CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面**永远不产生**；"	没测该层	keep	keep	—
"协议面：nudo.contract.emit 同样产出下游侧车"	"`nudo.contract.emit` 必须走 **root 驱动下行推导** （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒ - CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面**永远不产生**；"	没测该层	keep	keep	—
"root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车"	"emit 写盘边界按**路径分量**判定，不按字符串前缀。 症状（改前）：`pathInsideRoot` 用 `rel.startsWith(\"..\")` 判逃逸 ⇒ `..dotted.js` / `...triple.js` / `..cfg/x.js` 这些**合法**的相对路径 （组件名以 `..` 开头）被误判成逃逸 ⇒ IDE 拒绝对**工作区内**的合法文件 写侧车，而 CLI（无 workspace root 闸门）接受。"	夹具漏形态	keep	keep	—
"root 外的文件 ⇒ 仍然拒绝"	"emit 写盘边界按**路径分量**判定，不按字符串前缀。 症状（改前）：`pathInsideRoot` 用 `rel.startsWith(\"..\")` 判逃逸 ⇒ `..dotted.js` / `...triple.js` / `..cfg/x.js` 这些**合法**的相对路径 （组件名以 `..` 开头）被误判成逃逸 ⇒ IDE 拒绝对**工作区内**的合法文件 写侧车，而 CLI（无 workspace root 闸门）接受。"	夹具漏形态	keep	keep	—
"指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）"	"emit 写盘边界按**路径分量**判定，不按字符串前缀。 症状（改前）：`pathInsideRoot` 用 `rel.startsWith(\"..\")` 判逃逸 ⇒ `..dotted.js` / `...triple.js` / `..cfg/x.js` 这些**合法**的相对路径 （组件名以 `..` 开头）被误判成逃逸 ⇒ IDE 拒绝对**工作区内**的合法文件 写侧车，而 CLI（无 workspace root 闸门）接受。"	夹具漏形态	keep	keep	—
"nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）"	"LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对 同一文件 exit 1「Not an analysis target」； 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target` 码 + 与 CLI"	没测该层	keep	keep	—
"nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case"	"LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对 同一文件 exit 1「Not an analysis target」； 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target` 码 + 与 CLI"	没测该层	keep	keep	—
"普通 .js 目标不受闸门影响（仍能分析）"	"LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对 同一文件 exit 1「Not an analysis target」； 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target` 码 + 与 CLI"	没测该层	keep	keep	—
"dot 形式同样过闸门"	"LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对 同一文件 exit 1「Not an analysis target」； 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target` 码 + 与 CLI"	没测该层	keep	keep	—
"带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）"	"`（第 7 行，列 9） 改前这里是 `p: number()`（else 分支被忽略 ⇒ 窄化不成立） hover 的「早退守卫去 nullish」**忽略 `else` 分支** ⇒ 窄化出**不成立**的类型（与 `nudo check` 自相矛盾）。 改前：`applyStmtFact` 只看 `if` 的 then 分支是否以 return/throw 结束 ⇒ `if (!p) { return 0;"	没测该层	keep	keep	—
"对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）"	"hover 的「早退守卫去 nullish」**忽略 `else` 分支** ⇒ 窄化出**不成立**的类型（与 `nudo check` 自相矛盾）。 改前：`applyStmtFact` 只看 `if` 的 then 分支是否以 return/throw 结束 ⇒ `if (!p) { return 0;"	没测该层	keep	keep	—
"签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）"	"union 契约参数 ⇒ 保留声明形态（判别联合的展开不可读）"	夹具漏形态	keep	keep	—
"形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）"	"union 契约参数 ⇒ 保留声明形态（判别联合的展开不可读）"	夹具漏形态	keep	keep	—
"union 契约参数保留声明形态（判别联合折叠不回归）"	"union 契约参数 ⇒ 保留声明形态（判别联合的展开不可读）"	夹具漏形态	keep	keep	—
"push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）"	"check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。 症状：`checkToLspDiagnostics` 在转换前就 `filter(severity === \"error\" || \"warning\")` ⇒ 下游的档位过滤器（`filterCheckLspByLevel`）永远看不到 info ⇒ `nudo.analysis.diagnostics: \"verbose\"` 对 check 诊断是**空操作**， `nudo:assume-relied` / `nudo:invariant"	没测该层	keep	keep	—
"pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）"	"check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。 症状：`checkToLspDiagnostics` 在转换前就 `filter(severity === \"error\" || \"warning\")` ⇒ 下游的档位过滤器（`filterCheckLspByLevel`）永远看不到 info ⇒ `nudo.analysis.diagnostics: \"verbose\"` 对 check 诊断是**空操作**， `nudo:assume-relied` / `nudo:invariant"	没测该层	keep	keep	—
"默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）"	"check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。 症状：`checkToLspDiagnostics` 在转换前就 `filter(severity === \"error\" || \"warning\")` ⇒ 下游的档位过滤器（`filterCheckLspByLevel`）永远看不到 info ⇒ `nudo.analysis.diagnostics: \"verbose\"` 对 check 诊断是**空操作**， `nudo:assume-relied` / `nudo:invariant"	没测该层	keep	keep	—
"指令文法诊断（nudo:directive-syntax）并入 issues + summary"	"本钉覆盖两条旁路通道： 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与 service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组， 不会流进 `checkSource` 的返回值； 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态 （`getPathEnvLoadErrors`），既不是 `checkSource`"	夹具漏形态	keep	keep	—
"path env 未解析（nudo:env-unresolved）并入 issues + summary"	"本钉覆盖两条旁路通道： 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与 service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组， 不会流进 `checkSource` 的返回值； 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态 （`getPathEnvLoadErrors`），既不是 `checkSource`"	夹具漏形态	keep	keep	—
"dot 形式同样接上（协议别名不降级）"	"本钉覆盖两条旁路通道： 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与 service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组， 不会流进 `checkSource` 的返回值； 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态 （`getPathEnvLoadErrors`），既不是 `checkSource`"	夹具漏形态	keep	keep	—
"协议面 nudo/contract：带 from ⇒ 使用点证据参与求解"	"对照组：不给 from ⇒ 宽一整级 症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit` 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**： ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；"	没测该层	keep	keep	—
"协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）"	"症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit` 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**： ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；"	没测该层	keep	keep	—
"工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）"	"症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit` 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**： ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；"	没测该层	keep	keep	—
"from 指向不存在的路径 ⇒ 显式报错（不静默给假面）"	"症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit` 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**： ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；"	没测该层	keep	keep	—
"documentSymbol 出 CJS 成员导出（函数档，detail 带 export）"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"workspace/symbol 查得到 CJS 成员导出"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"semanticTokens 给 CJS 导出键 function 档 + contract 档 modifier"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"inlayHint 出 CJS 导出的返回 inlay + contract 档投影"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"codeLens 出 CJS 导出的 contract 档（契约身份 = 导出名）"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"hover 面解析出 CJS 导出名（族 25 收口接线：position.ts 补 MemberExpression property 分支）"	"第 1 行（0-based）的 `alpha`（`module.exports.alpha = …`） 改前：无名 `(x) => ?`（名字解析不出来）⇒ 诊断面认得它、hover 面不认 症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
"回归护栏：ESM 具名导出的符号面不受影响"	"症状（真 server 协议面，改前）： - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）； - `workspace/symbol` 查 `alpha` → 查不到；"	没测该层	keep	keep	—
```
