# packages/lsp/src/__tests__/lsp-signature-help.test.ts

模块套件：34 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"补全 detail 用源码真名与真个数（改前：(arg0) => ? / (arg0, arg1) => ?）"	"detail 不再用 `?` 占位返回值，改为与 hover / check 同口径的 签名渲染（`<name>(<param>: <T>, …) => <R>`）； 本用例仍钉「源码真名与 真个数」（不是 arg0/arg1 假名）。 ：IDE 面（补全 detail + 签名弹窗）的跨模块 fn 形参名—— 改前 `export function` 的形参显示成合成假名 `arg0/arg1`（源码里没有的名字）， 带默认值的形参整个丢失（`b = 2` → arg1），rest 形参连个数一起被吞。"	没测该层	keep	keep	—
"签名弹窗 label 用源码真名（改前：(arg0: any) => unknown）"	"裸标识符 callee 不再用 evaluator 的 arity-only fn Abs 冒充 签名（返回位是占位 `unknown`）⇒ 落到与 hover 同源的 poly-fn 解析， 返回位是真实推断（`x + y` ⇒ `number | string`）。 ：IDE 面（补全 detail + 签名弹窗）的跨模块 fn 形参名—— 改前 `export function` 的形参显示成合成假名 `arg0/arg1`（源码里没有的名字）， 带默认值的形参整个丢失（`b = 2` → arg1），res"	没测该层	keep	keep	—
"负控制：本地箭头函数的形参面不变"	"detail 改为完整签名（不再 `?` 占位）； 负控制仍钉「形参面 用源码真名 m/n 且个数为 2」（不是 arg0/arg1 假名）。 ：IDE 面（补全 detail + 签名弹窗）的跨模块 fn 形参名—— 改前 `export function` 的形参显示成合成假名 `arg0/arg1`（源码里没有的名字）， 带默认值的形参整个丢失（`b = 2` → arg1），rest 形参连个数一起被吞。"	没测该层	keep	keep	—
"纯函数面：buildSignatureHelp 把 activeParameter 夹进签名参数表内"	"越界输入（光标在末参之后 / 实参多于形参）⇒ 夹到最后一个形参 LSP `signatureHelp` 的 `activeParameter` **越界**—— 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内； 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。"	没测该层	keep	keep	—
"纯函数面：0 参签名 ⇒ 省略 activeParameter（不是填 0）"	"LSP `signatureHelp` 的 `activeParameter` **越界**—— 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内； 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。"	没测该层	keep	keep	—
"协议面（真 server）：末参之后 / 分号处的 activeParameter 都落在参数表内"	"`）不得再报 2（改前报 2 ⇒ 越界） 首参内 ⇒ 0 逗号上 ⇒ 第 2 个参数 LSP `signatureHelp` 的 `activeParameter` **越界**—— 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内； 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。"	没测该层	keep	keep	—
"协议面（真 server）：实参多于形参时也不得越界"	"LSP `signatureHelp` 的 `activeParameter` **越界**—— 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内； 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。"	没测该层	keep	keep	—
"协议面（真 server）：defFn(1, 2) 给出 2 参签名（改前 null）"	"改前：null（整面无响应） 根因（HEAD 实测）：`AnalysisResult.bindings` **只收具名导出** ⇒ 默认导出**连 \"default\" 键都没有**（既无 \"default\" 也无本地名 \"defFn\"） ⇒ 绑定面必然 miss。 签名面必须落到 **AST 定位回落**（与 hover 面同源的 `generalizeFromAst`）。"	夹具漏形态	keep	keep	—
"协议面（真 server）：光标落在被调者名 / 第 2 个实参处都给同一签名"	"根因（HEAD 实测）：`AnalysisResult.bindings` **只收具名导出** ⇒ 默认导出**连 \"default\" 键都没有**（既无 \"default\" 也无本地名 \"defFn\"） ⇒ 绑定面必然 miss。 签名面必须落到 **AST 定位回落**（与 hover 面同源的 `generalizeFromAst`）。"	夹具漏形态	keep	keep	—
"负控制：具名导出的 callee 仍走绑定面（参数名 / 数量一致）"	"返回类型部分随 **** 的修复变精确。 旧期望 `\"(a: any, b: any) => unknown\"` 钉的正是 判红的 **症状**：`tmp/bug-report/sections/.md` §期望 vs 实际 明写 signatureHelp 的 label 期望是**精确签名**、实际是 「`(user: any) => unknown`」（声明空壳：形参一律 any、返回一律 unknown）⇒ 与同一 LSP 面的 hover 及 CLI `nudo check` 互斥。 根因（HEAD 实测"	没测该层	keep	keep	—
"协议面（真 server）：局部函数声明 inner(1, 2) 给出 2 参签名（改前 null）"	"改前：null（整面无响应） LSP `signatureHelp` 对**函数体内的局部 callee** （局部函数声明 / 局部箭头常量）**完全没有签名弹窗**。 根因：局部绑定不在**模块级**绑定表（`AnalysisResult.bindings`）里 ⇒ 绑定面必然 miss ⇒ 签名面必须落到 **AST 定位回落** （与 hover 面同源的 `generalizeFromAst`）。"	没测该层	keep	keep	—
"协议面（真 server）：局部箭头常量 arrow(3, 4) 给出 2 参签名（改前 null）"	"LSP `signatureHelp` 对**函数体内的局部 callee** （局部函数声明 / 局部箭头常量）**完全没有签名弹窗**。 根因：局部绑定不在**模块级**绑定表（`AnalysisResult.bindings`）里 ⇒ 绑定面必然 miss ⇒ 签名面必须落到 **AST 定位回落** （与 hover 面同源的 `generalizeFromAst`）。"	没测该层	keep	keep	—
"协议面（真 server）：局部 callee 的第 2 个实参 ⇒ activeParameter = 1"	"LSP `signatureHelp` 对**函数体内的局部 callee** （局部函数声明 / 局部箭头常量）**完全没有签名弹窗**。 根因：局部绑定不在**模块级**绑定表（`AnalysisResult.bindings`）里 ⇒ 绑定面必然 miss ⇒ 签名面必须落到 **AST 定位回落** （与 hover 面同源的 `generalizeFromAst`）。"	没测该层	keep	keep	—
"负控制：模块级 callee 仍走绑定面（签名口径一致）"	"返回类型部分随 **** 的修复变精确。 旧期望 `\"(a: any, b: any) => unknown\"` 钉的正是 判红的 **症状**：`tmp/bug-report/sections/.md` §期望 vs 实际 明写 signatureHelp 的 label 期望是**精确签名**、实际是 「`(user: any) => unknown`」（声明空壳：形参一律 any、返回一律 unknown）⇒ 与同一 LSP 面的 hover 及 CLI `nudo check` 互斥。 LSP `signa"	没测该层	keep	keep	—
"协议面（真 server）：obj.method(1, 2) 给出方法的 2 参签名"	"改前：null（整面无响应） LSP `signatureHelp` 对**方法调用**（`obj.method(…)`） **完全没有签名弹窗**，尽管引擎解析得出该方法的签名（成员补全面能给出 `method` 的 2 个具名形参 x / y）。 原生 oracle：成员调用的被调者是**接收者的槽位**，不是模块级绑定 ⇒ 签名面必须沿 Abs 形状逐段下钻。"	夹具漏形态	keep	keep	—
"协议面（真 server）：光标在接收者 / 方法名 / 括号各处都给出同一签名"	"LSP `signatureHelp` 对**方法调用**（`obj.method(…)`） **完全没有签名弹窗**，尽管引擎解析得出该方法的签名（成员补全面能给出 `method` 的 2 个具名形参 x / y）。 原生 oracle：成员调用的被调者是**接收者的槽位**，不是模块级绑定 ⇒ 签名面必须沿 Abs 形状逐段下钻。"	夹具漏形态	keep	keep	—
"负控制：顶层函数调用仍给顶层签名（成员面不得吞掉裸标识符面）"	"LSP `signatureHelp` 对**方法调用**（`obj.method(…)`） **完全没有签名弹窗**，尽管引擎解析得出该方法的签名（成员补全面能给出 `method` 的 2 个具名形参 x / y）。 原生 oracle：成员调用的被调者是**接收者的槽位**，不是模块级绑定 ⇒ 签名面必须沿 Abs 形状逐段下钻。"	夹具漏形态	keep	keep	—
"纯函数面：光标在内层实参 ⇒ findEnclosingCall 命中内层调用"	"内层 `inner` 的 callee 起点（不是外层 `outer`） 外层 `outer` 的 callee 起点（改前弹的就是这个） 外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号）"	没测该层	keep	keep	—
"纯函数面：光标在外层第 2 个实参 ⇒ 仍命中外层调用"	"外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号）"	没测该层	keep	keep	—
"协议面（真 server）：内层实参处弹 inner 的 1 参签名（改前是 outer 的 3 参）"	"负控制：不得是外层的 3 参签名 外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号）"	没测该层	keep	keep	—
"协议面（真 server）：外层第 2 个实参处仍弹 outer 的 3 参签名"	"裸标识符 callee 落到与 hover 同源的 poly-fn 签名 ⇒ 返回位是 真实推断（`a + b + c` ⇒ `number | string`），不再是 arity-only 占位 `unknown`。 本用例的主断言（弹 outer 的 3 参签名 / activeParameter）不变。 外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号）"	没测该层	keep	keep	—
"裸标识符 callee 的签名含侧车契约的形参类型与返回类型"	"` 的 `add` 内 契约形参 / 返回（不是 `(user: any) => unknown`） documentation 与 hover 同源，不得是占位符签名 `(user) => ?` 同一面同口径：hover 在调用点给精确签名（`=> string`） 症状：`add({ id: 1 })` 的调用点，signatureHelp 给 `(user: any) => unknown` （documentation 亦为 `(user) => ?`），而同一位置的 hover 给 `(user: sha"	没测该层	keep	keep	—
"multi-line args: cursor inside arg i selects param i (old visitor said i+1)"	"旧实现按「start 在 cursor 前 → +1」 判成 1（跨行场景全错）； 旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"trailing comma: cursor after the last arg selects arity (not beyond)"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"cursor before first arg (right after '(') selects param 0"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"single line: between args (on comma) selects the next param"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"nested calls resolve to the innermost enclosing call (Bug 711)"	"旧实现「首个命中即停 + path.skip()」取外层， 内层调用永远不参与 ⇒ 弹的是完全无关的参数表。 旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"positions outside any call yield null; same-line-after-call no longer false-matches"	"旧实现只比行号：`call(11, 22); }` 尾部同行会误命中； 旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"projects paramTypes and returnType, not unknown placeholders"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"missing paramTypes fall back to any (unconstrained), not unknown"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"rest and optional labels keep markers"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"rejects non-fn Abs"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"documentation carries formatShape of the fn"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
"unconstrained display stays any, never unknown, for typed arity-only fns"	"旧手写 visitor 的两处缺陷： - 区间判定只比行号（同行调用尾误命中）； - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。"	没测该层	keep	keep	—
```
