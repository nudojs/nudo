# packages/lsp/src/__tests__/lsp-diagnostics.test.ts

模块套件：47 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"maps constraint violations to nudo-check diagnostics"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"validateText publishes check diags first"	"虚拟路径下无 std.nudo.js → 无 check diags 也可 至少不崩溃 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"filterCheckLspByLevel matches push/pull gate (shared helper)"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"checkToLspDiagnostics 并入指令文法诊断（FIX-RESIDUAL #1，显式通道）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"checkToLspDiagnostics 只含本文件的指令诊断（R2B-003：无共享缓冲可混入）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"checkToLspDiagnostics catch 不再静默 return []（R2B-003）"	"传入会让 checkSource 抛错的输入：用 Proxy 让 source 访问即抛 失败必须留错误面（Analysis/Check error），不得 [] 把门禁通道整段丢掉 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"缺失 env 文件 → 恰 1 条 warning，消息与 CLI 同源"	"LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。 契约： - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved， 消息与 CLI 同源（`path env failed to load: <path> — <error>`） - 好 env → 无该诊断；"	没测该层	keep	keep	—
"导入失败的 env 文件（存在但 defineEnv 不可达）同样告警"	"LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。 契约： - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved， 消息与 CLI 同源（`path env failed to load: <path> — <error>`） - 好 env → 无该诊断；"	没测该层	keep	keep	—
"好 env → 无该诊断"	"LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。 契约： - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved， 消息与 CLI 同源（`path env failed to load: <path> — <error>`） - 好 env → 无该诊断；"	没测该层	keep	keep	—
"缓存命中轮（源码未变再 validate）仍发布 live 告警"	"同源码同 version：analysisCache 命中（analyzeFileAsync 不再 preload）， env 告警是 live 瞬态——显式补 preload 后仍须恰 1 条 LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。 契约： - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved， 消息与 C"	没测该层	keep	keep	—
"env 项从配置移除后不再误报陈旧错误"	"进程级错误表仍有旧条目——本轮 env 名单不含它，不得继续发布 LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。 契约： - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved， 消息与 CLI 同源（`path env failed to load: <path> — <error>`） - 好 env → 无该诊断"	没测该层	keep	keep	—
"未知 env 名 ⇒ IDE 里出现 nudo:env-unresolved"	"回归（LSP 面） 注：env 名的指令文法只收「词字符」或「path 形态」（core parseEnvPayload） ⇒ 未知名用 `bogusenvname` 这类词字符形态（带连字符会被指令层过滤掉， 根本进不了 env 名单）。 ：service 侧新增的**按名字**发的 env 诊断 （未知 env 名 `bogus` / `nodejs`…、非字符串 env 项）记录的 path 是 **名字本身**，不是解析后的绝对路径 ⇒ LSP 侧原先只按 `resolvePath(baseDir, nam"	夹具漏形态	keep	keep	—
"同目录别的文件的无 path 诊断不误吸（本文件没有该 env 名）"	"另一个文件先用过「未知 env 名」——它的诊断记在同一个 baseDir 下 本文件用的是另一个 env 名 ⇒ 不该看到 otherunknownenv 的诊断 回归（LSP 面） 注：env 名的指令文法只收「词字符」或「path 形态」（core parseEnvPayload） ⇒ 未知名用 `bogusenvname` 这类词字符形态（带连字符会被指令层过滤掉， 根本进不了 env 名单）。 ：service 侧新增的**按名字**发的 env 诊断 （未知 env 名 `bogus` / `nodej"	夹具漏形态	keep	keep	—
"分析器先跑 ⇒ IDE 里仍有 error 级 nudo:contract-load"	"坏侧车：exec 失败 ⇒ core 报 contract-load 不得被降级成「无契约根」的误报（侧车在，只是加载失败） 结论（当前工作树）：**不复现**——core 的 checkSource 入口会 `resetSidecarLoadFailureCache()`，自己重新探测侧车并重新上报一份 contract-load error ⇒ 两条路径都拿得到（探针：tmp/probe/fix-r24-wcli/ chan-order-probe.ts，两个顺序下 checkSource 的 issues 都"	没测该层	keep	keep	—
"负控制：好侧车 ⇒ 无 contract-load error"	"结论（当前工作树）：**不复现**——core 的 checkSource 入口会 `resetSidecarLoadFailureCache()`，自己重新探测侧车并重新上报一份 contract-load error ⇒ 两条路径都拿得到（探针：tmp/probe/fix-r24-wcli/ chan-order-probe.ts，两个顺序下 checkSource 的 issues 都带 `nudo:contract-load`）。 本文件把该事实**钉住**：坏侧车 ⇒ IDE 里必须看得见 error 级"	没测该层	keep	keep	—
"push 通道：nudo:case-expected 的 range 不越过行尾"	"`@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected"	没测该层	keep	keep	—
"pull 通道：nudo:case-expected 的 range 不越过行尾（同 push 口径）"	"`@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected"	没测该层	keep	keep	—
"lspDiagnosticRange：整行哨兵夹到行尾，且同 line 时 end ≥ start"	"整行哨兵 999 ⇒ 行尾（6） 夹取后不得倒挂（start 在行尾之外 ⇒ start 也夹到行尾） 跨行：end 行按 end 行自己的长度夹 `@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected"	没测该层	keep	keep	—
"lspDiagnosticRange：行号 1 基 → 0 基（占位 line 0 → 0）"	"`@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected"	没测该层	keep	keep	—
"nudo.selectCase 之后发出 workspace/diagnostic/refresh"	"选择器变更从不广播 `workspace/diagnostic/refresh`。 改前：切 case 后 pull 诊断客户端永远拿不到切换后的新诊断（只有 codeLens refresh）。"	没测该层	keep	keep	—
"nudo.selectContract 之后发出 workspace/diagnostic/refresh"	"选择器变更从不广播 `workspace/diagnostic/refresh`。 改前：切 case 后 pull 诊断客户端永远拿不到切换后的新诊断（只有 codeLens refresh）。"	没测该层	keep	keep	—
"validateText 发布面：同一条指令文法诊断只出现 1 次（改前：2 次）"	"回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道 （service drain）各抽一次同一条指令诊断；"	没测该层	keep	keep	—
"check 通道与 eval 通道对同一条指令诊断渲染同一消息（去重键一致）"	"check 通道（显式 extract） eval 通道拿到的是同一条指令诊断的**原始**消息（service 侧不带提示文案） 两通道消息必须逐字相同 → `code + message` 去重键命中 → 只发布 1 条 回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道 （service drain）各抽一次同一条指令诊断；"	没测该层	keep	keep	—
"负控制：合法指令文件不得出现 directive-syntax"	"回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道 （service drain）各抽一次同一条指令诊断；"	没测该层	keep	keep	—
"负控制：非指令文法的诊断码不受影响（entry-may-throw 仍在）"	"回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道 （service drain）各抽一次同一条指令诊断；"	没测该层	keep	keep	—
"check 通道：表达式语句载体 ⇒ 一条 nudo:directive-syntax（warning，非硬错）"	"文案点名「这条指令没生效」（service 侧原文 + check 通道的修复提示） range 必须落在文档内（LSP Position 是 uinteger） 本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"check 通道：函数声明载体同样可见（同码同档）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"IDE push 面：该诊断随 publishDiagnostics 上屏（不只在 service/CLI 面）"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"负控制：合法载体（变量声明 / return）⇒ 零 nudo:directive-syntax"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"负控制：合法载体在 push 面同样零 nudo:directive-syntax"	"本产品始终写纯字符串。"	夹具漏形态	keep	keep	—
"④ 子目录文件：项目级 env 缺失 ⇒ 必须报 nudo:env-unresolved（路径在项目根）"	"路径 = **项目根**下解析出的真实路径 不得是「按文件目录解析」的臆造路径 env-unresolved 诊断（其它诊断不算）。"	没测该层	keep	keep	—
"⑤ 项目根下的文件：诊断仍可见（不得因修复而丢失）"	"env-unresolved 诊断（其它诊断不算）。"	没测该层	keep	keep	—
"⑥ 文件级 env（按文件目录解析）语义不受影响 + 项目级按项目根"	"文件级 env 缺失 ⇒ 路径在**文件目录**下 项目级 env 缺失 ⇒ 路径在**项目根**下 env-unresolved 诊断（其它诊断不算）。"	没测该层	keep	keep	—
"IDE push 面：项目级 env 可见 ⇒ 不得发布 builtin-unknown 假阳（Bug 1098 同源）"	"`MAGIC` 是 env 全局 ⇒ 不得报「内建 API 未覆盖」（修前 IDE 直接发布假阳） 注：LSP **check 通道**的项目级 env 绝对化已由 （`absolutizeEnvSpec`） 修好 ⇒ 项目级 env 在该通道同样可见，不再是 IDE 红 / CLI 绿的假红来源。 env-unresolved 诊断（其它诊断不算）。"	夹具漏形态	keep	keep	—
"模块求值失败 ⇒ 发布一条 error 级 nudo:module-throw（与 CLI exit ≠ 0 同结论）"	"无源位置：不得编造第 1 行（装载期失败定位不到某一行） 模块求值失败（顶层读未定义全局）⇒ 门禁判红。"	没测该层	keep	keep	—
"负控制：正常文件不报 nudo:module-throw"	"模块求值失败（顶层读未定义全局）⇒ 门禁判红。"	没测该层	keep	keep	—
"pull 通道对 a.js 报告 nudo:recursion-truncated + nudo:module-cycle"	"环图装载 + 有界求值 + 多轮 validate 都需要时间 环本身仍如实报告（修复不是靠「不报环」换来的） verbose 档下 CLI 同一文件的第三条码也必须在屏（档位未失效） 打开 verbose 档（info 级诊断必须上屏，否则「缺码」会与档位过滤混淆）。"	没测该层	keep	keep	—
"push 通道（didOpen → publishDiagnostics）与 pull 同码集"	"打开 verbose 档（info 级诊断必须上屏，否则「缺码」会与档位过滤混淆）。"	没测该层	keep	keep	—
"@nudo:env 指向缺失文件 ⇒ pull 里有 nudo:env-unresolved"	"pull 诊断面**没有** env 通道。 症状：`@nudo:env` 指向的 path env 加载失败时，**push** 面（validateText） 会发 `nudo:env-unresolved` 告警，**pull** 面（`textDocument/diagnostic`） 一条都没有 ⇒ 同一个文件两个诊断面互相打脸（IDE 与 CI 结论不一致）。"	没测该层	keep	keep	—
"push 与 pull 的诊断 code 集合一致"	"push 与 pull 两个诊断面**不一致**（env 通道缺失）。 症状：同一个文件，push 面（`publishDiagnostics`）有 `nudo:env-unresolved` 告警，pull 面（`textDocument/diagnostic`）没有 ⇒ IDE 里看到的诊断集合 取决于客户端用哪个面拉取 ⇒ 结论不可复现。"	没测该层	keep	keep	—
"nudo:constraint-violated 的 range 落在函数声明行"	"回归钉（LSP 面）—— 返回契约类诊断不带 `line` / `column` ⇒ LSP 把诊断 画在**第 1 行第 0 列**（`range {0,0}-{0,1}`），而函数其实在第 10 行。 钉：`nudo:constraint-violated` 的 LSP range 必须落在第 10 行 （0 基 line 9），不得是 0。"	没测该层	keep	keep	—
"落盘 = 推断面（any()），不是基类型（number()）；且诊断消失"	"诊断面先钉住：推断面是 any（不是 number） 标题承诺（service 产）与 CLI 机器面同源——修好后这句是真的 1. 落盘 = 推断面 `any()`（改前 = `number()`，基类型） 2. 可执行：落盘后目标诊断消失 3. 证据面：旧落盘（剥数值谓词 ⇒ number()）诊断原样还在 对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面）"	夹具漏形态	keep	keep	—
"正控制：推断面基类型（number）⇒ 落盘 number() 且诊断消失（门不是一刀切）"	"对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面）"	夹具漏形态	keep	keep	—
"推断面不可投影（obj 返回）⇒ 不下发（不承诺做不到的事）"	"推断面 = obj 形状（`{ a: any }`）⇒ `absToConstraint` 投影不出、也没有 基类型可退 ⇒ 写不出忠实的推断面 对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面）"	夹具漏形态	keep	keep	—
"CLI 机器面（actionsForIssue）与 LSP 标题是同一条（现在为真的）承诺"	"hint = 被放宽的**原**契约（不是推断面）：用户看得到「放宽了什么」 对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面）"	夹具漏形态	keep	keep	—
"validateText always publishes via sendDiagnostics (no pull required)"	"有诊断（entry may-throw / 未知）或空数组——关键是**有 publish 事件** LSP-G6：老客户端只消费 push（textDocument/publishDiagnostics）， 不用 pull diagnosticProvider。 打开/校验路径必须仍走 sendDiagnostics。"	夹具漏形态	keep	keep	—
"empty publish on clean file still fires (clears stale UI)"	"（wave 3）：any 形参算术不再 clean（may TypeError）——clean 样本 改用恒总 identity，本用例意图（clean 文件 → 空诊断 publish）不变。 LSP-G6：老客户端只消费 push（textDocument/publishDiagnostics）， 不用 pull diagnosticProvider。 打开/校验路径必须仍走 sendDiagnostics。"	没测该层	keep	keep	—
```
