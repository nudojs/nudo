# packages/lsp/src/__tests__/lsp-hover.test.ts

模块套件：30 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"hover.contractSource equals CodeLens contract lens source"	"测试「hover.contractSource equals CodeLens contract lens source」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"implicit export: lens and hover both say implicit; display omitted"	"测试「implicit export: lens and hover both say implicit; display omitted」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"inlay.contractSource equals lens source"	"测试「inlay.contractSource equals lens source」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"autoBind:false collapses lens + hover to implicit together"	"测试「autoBind:false collapses lens + hover to implicit together」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"returns contractSource + contractLine matching CodeLens title"	"测试「returns contractSource + contractLine matching CodeLens title」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"implicit call-site file: contractSource=implicit, contractLine matches"	"测试「implicit call-site file: contractSource=implicit, contractLine matches」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"hover on identifier resolves via binding table (node table removed)"	"测试「hover on identifier resolves via binding table (node table removed)」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"can include inlays"	"测试「can include inlays」；原文件无独立根因注释，需按所在 describe 的契约人工复核。"	没测该层	keep	keep	—
"成员赋值后的成员读 → 求值态（修前回落声明形态面）"	"LSP hover 重放面：成员写回的**赋值目标**必须是可赋值绑定回归。 根因：core 的 memberPathOf 在 recordPositions 打开时把路径根包成 `$nodoPos(name, l, c)`（位置插桩**读**），写回点却把同一个 rootSrc 当 **赋值目标**用 ⇒ 产物 `$nodoPos(o, 2, 24) = …` 是非法 JS ⇒ 整模块 new Function 抛 SyntaxError ⇒ fail-closed ⇒ hover 重放拿不到求值态 （回落声明形"	没测该层	keep	keep	—
"有公理 ⇒ hover 返回位 `0 | number`；无公理 ⇒ `number`；两者不同"	"改前：hover 自算 generalize ⇒ 两版都是 `f(n: any) => number` 差异**精确地由公理那一行引起**（不是面固有精度差） 注释块（公理行）使两版文件的行号不同 ⇒ 必须动态定位。"	没测该层	keep	keep	—
"公理不影响参数渲染：两版形参仍同形（hover 自己的参数面）"	"注释块（公理行）使两版文件的行号不同 ⇒ 必须动态定位。"	没测该层	keep	keep	—
"两面对同一份源码给出同一份返回类型，且随公理变化"	"无公理 ⇒ `number` 差异**精确地由公理那一行引起**（不是面固有精度差） 3. 内部计数器 id 不上屏 注释块（公理行）使两版文件行号不同 ⇒ 必须动态定位。"	没测该层	keep	keep	—
"真实 server：hover 签名行 = check 契约域签名（无 throws）"	"契约域里 `s.toUpperCase()` 无强转 ⇒ 不得出现 throws 尾缀 `nudo check` 的签名行：契约域 ⇒ `s: string` 不可能触发强转 ⇒ 不抛"	没测该层	keep	keep	—
"纯装配面：hover 签名行同样不含 throws"	"column 0-based = 16 侧车契约靠 `loadModule` 装载（协议面由 server 传 `activeLoadModule`， 缺省回落 service 的 `defaultLoadModule` 读盘）——纯面显式给同一读盘装载器 `nudo check` 的签名行：契约域 ⇒ `s: string` 不可能触发强转 ⇒ 不抛"	没测该层	keep	keep	—
"注入生效：hover 签名给出推断类型（改前塌缩成 unknown）"	"（hover 半）—— hover 的签名面**从不传 `inject`** ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示 `number`/`string` ⇒ 跨产品面自相矛盾，且违反 lsp.md 明写的 “check-identical signature” 承诺。"	没测该层	keep	keep	—
"未注入（对照）：推导链塌缩成 unknown ⇒ inject 通道确实是分水岭"	"（hover 半）—— hover 的签名面**从不传 `inject`** ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示 `number`/`string` ⇒ 跨产品面自相矛盾，且违反 lsp.md 明写的 “check-identical signature” 承诺。"	没测该层	keep	keep	—
"buildLspInjection 采集 @nudo:replace 的覆盖表（replacements + targets）"	"`@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名"	没测该层	keep	keep	—
"buildLspInjection 采集 @nudo:as 的覆盖表（asOverrides + asOverrideTargets）"	"`@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名"	没测该层	keep	keep	—
"buildLspInjection 采集 @nudo:mock 的覆盖表（mocks）"	"`@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名"	没测该层	keep	keep	—
"agent hover 工具的 inlay 载荷：注入生效 ⇒ `: string`（未注入 ⇒ `: unknown`）"	"`@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名"	没测该层	keep	keep	—
"非法 line / column ⇒ 工具错误；缺省 column ⇒ 载荷带 column 键"	"① 非法 line（字符串）⇒ 失败，不再原样回显 ② line 缺失 ⇒ 失败 ③ 非法 column（负数）⇒ 失败 ④ column 缺省 ⇒ 成功面，载荷的 column 键恒在（缺省 0） `nudo/hover` 的位置入参**零校验**： 1. `line` 传字符串（`\"2\"`）等非法值时，工具**原样回显**并把分析字段全落 `null` —— 调用方分不清「此处没有 hover」与「我传的参数类型不对」。 ⇒ 非法位置参数 ⇒ 工具错误（`isError: true`）。"	夹具漏形态	keep	keep	—
"5 层嵌套：hover 签名给出完整返回类型（改前截成 `{ d: … }`）"	"改前：同一份源码、同一函数、同一次分析下，`nudo check` 签名行 / 同文档的 inlayHint / `nudo.hover` 载荷给出**三个互不相同的类型**， 并直接违反 `api/lsp.md` 明写的「check-identical signature」承诺。 原生 oracle：hover 签名块的返回类型与 `nudo check` 的签名行**逐字相同** （共享投影预算 PROJECTION_MAX_DEPTH，不是 hover 单方面的 maxDepth 4）。"	没测该层	keep	keep	—
"hover 签名行与 `nudo check` 签名行逐字相同"	"改前：同一份源码、同一函数、同一次分析下，`nudo check` 签名行 / 同文档的 inlayHint / `nudo.hover` 载荷给出**三个互不相同的类型**， 并直接违反 `api/lsp.md` 明写的「check-identical signature」承诺。 原生 oracle：hover 签名块的返回类型与 `nudo check` 的签名行**逐字相同** （共享投影预算 PROJECTION_MAX_DEPTH，不是 hover 单方面的 maxDepth 4）。"	没测该层	keep	keep	—
"更深的嵌套不再逐字节相同（深度 4 与深度 8 的 hover 输出不同）"	"改前：同一份源码、同一函数、同一次分析下，`nudo check` 签名行 / 同文档的 inlayHint / `nudo.hover` 载荷给出**三个互不相同的类型**， 并直接违反 `api/lsp.md` 明写的「check-identical signature」承诺。 原生 oracle：hover 签名块的返回类型与 `nudo check` 的签名行**逐字相同** （共享投影预算 PROJECTION_MAX_DEPTH，不是 hover 单方面的 maxDepth 4）。"	没测该层	keep	keep	—
"会抛的导出函数：hover 签名带 `throws TypeError`（改前静默省略）"	"LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽 `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」， 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。"	没测该层	keep	keep	—
"hover 签名行与 `nudo check` 签名行逐字相同（throws 段一致）"	"LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽 `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」， 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。"	没测该层	keep	keep	—
"不会抛的函数：无证据 ⇒ **省略** throws 段（不得写 `throws never`）"	"LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽 `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」， 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。"	没测该层	keep	keep	—
"非导出函数不带 throws（CLI 的 L2 throws 只对 entry 生效）"	"LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽 `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」， 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。"	没测该层	keep	keep	—
"选中 case 后 hover 首行翻成 ○ contract / imp（与 CodeLens 标题逐字相同）"	"初始：契约档激活 ⇒ ● 选中 case 后：CodeLens 翻 ○，hover 必须同步（改前 hover 仍恒 ●） 两个面逐字一致 改前：hover 首行恒 `● contract / <src>`，而同一文件的 CodeLens 在 选中 case 后已翻成 `○ contract / <src>` ⇒ 同一个 IDE 里两个面打架 （并与 `core/algebra/contract.ts` 写明的语义「○ = 当前观察的是 case」 直接矛盾）。 原生 oracle：hover 首行的 `●/○`"	没测该层	keep	keep	—
"取消 case 选择（selectContract）后 hover 首行回到 ●"	"改前：hover 首行恒 `● contract / <src>`，而同一文件的 CodeLens 在 选中 case 后已翻成 `○ contract / <src>` ⇒ 同一个 IDE 里两个面打架 （并与 `core/algebra/contract.ts` 写明的语义「○ = 当前观察的是 case」 直接矛盾）。 原生 oracle：hover 首行的 `●/○` 必须与 CodeLens 的契约选项标题**同源** （观察选择器互斥：激活 case ⇒ 契约档 ○）。"	没测该层	keep	keep	—
```
