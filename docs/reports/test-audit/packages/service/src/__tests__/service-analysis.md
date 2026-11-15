# packages/service/src/__tests__/service-analysis.test.ts

模块套件：138 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"ESM `import * as dep`：记录名带接收者限定，且归因到被调模块"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"CJS `const dep = require(...)`：同样带接收者限定且可归因"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"负控制：具名导入的记录名保持原样（不加前缀）"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"负控制：对象字面量方法调用不被误加接收者限定"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"产品面：注入后 nudo:contract-domain-exceeds 必须是 error（不再是假绿）"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"产品面：CJS 命名空间形态同样报 error"	"被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报）"	没测该层	keep	keep	—
"组内记录全部超限 ⇒ 整组跳过（不抛、不产出残缺分析）"	"回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` / `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后 静默假绿，`nudo test` / `export` 直接崩溃）。"	夹具漏形态	keep	keep	—
"对照组：正常记录照常合成（口径不变）"	"回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` / `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后 静默假绿，`nudo test` / `export` 直接崩溃）。"	夹具漏形态	keep	keep	—
"调用点字面量实参 ⇒ 投影成基类型（不是 lit(N)）"	"回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` / `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后 静默假绿，`nudo test` / `export` 直接崩溃）。"	夹具漏形态	keep	keep	—
"对照组：带断言的 @nudo:case 是域声明 ⇒ 字面量保留"	"回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` / `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后 静默假绿，`nudo test` / `export` 直接崩溃）。"	夹具漏形态	keep	keep	—
"被调方先定义：三个调用点全部留证（不再只剩第一条）"	"回归：被调方的**调用点域**不得被「首次 settle」截断。 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 —— 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接 产出假红。"	没测该层	keep	keep	—
"两种声明顺序的调用点域与 combinedAbs 完全一致"	"回归：被调方的**调用点域**不得被「首次 settle」截断。 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 —— 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接 产出假红。"	没测该层	keep	keep	—
"有调用点域的被调方不再误报 nudo:contract-entry-only"	"负控制：真的没有调用点的导出函数仍如实报 entry-only（不静默） 回归：被调方的**调用点域**不得被「首次 settle」截断。 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 —— 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接"	没测该层	keep	keep	—
"同一行两个调用点 ⇒ 名字不同（加列维度），且各自可核对到列"	"撞名的两条**都**带列维度（同一行 ⇒ 谁的「裸名」都不该独占） 回归：「见证名 = 调用点身份」必须在**同一行多个调用点**时仍成立。 改前本地调用点只有行号维度 ⇒ 同一行两个调用点都叫 `call@L6` ⇒ 一个现场的 见证凭空消失（声明了其中一个后另一个的观测真值被吞）。"	没测该层	keep	keep	—
"对照组：唯一调用点的名字格式不变（既有固化见证不漂移）"	"回归：「见证名 = 调用点身份」必须在**同一行多个调用点**时仍成立。 改前本地调用点只有行号维度 ⇒ 同一行两个调用点都叫 `call@L6` ⇒ 一个现场的 见证凭空消失（声明了其中一个后另一个的观测真值被吞）。"	没测该层	keep	keep	—
"三个及以上同行调用点：列缺失时退回序号（仍唯一）"	"回归：「见证名 = 调用点身份」必须在**同一行多个调用点**时仍成立。 改前本地调用点只有行号维度 ⇒ 同一行两个调用点都叫 `call@L6` ⇒ 一个现场的 见证凭空消失（声明了其中一个后另一个的观测真值被吞）。"	没测该层	keep	keep	—
"依赖模块里的调用不得带现场文件（行号落在注释行）"	"回归：调用记录的「调用现场文件」不得用**行数上界**猜。 改前 `rec.callLoc.line > lineCount` 是唯一判据：依赖模块里的调用 （`dep.js` 第 2 行）在「行号 ≤ 现场文件行数」时被误贴成现场文件 ⇒ 见证名 `call@usage.js:L2` 指向现场文件里根本不是该调用的行（甚至注释行）， 并与现场文件自己的调用**撞名**。"	没测该层	keep	keep	—
"同号不同列（collide）⇒ 现场调用保留现场文件，依赖调用不贴"	"依赖里那次调用（同 line 2，不同列）不得被贴成现场文件 回归：调用记录的「调用现场文件」不得用**行数上界**猜。 改前 `rec.callLoc.line > lineCount` 是唯一判据：依赖模块里的调用 （`dep.js` 第 2 行）在「行号 ≤ 现场文件行数」时被误贴成现场文件 ⇒ 见证名 `call@usage.js:L2` 指向现场文件里根本不是该调用的行（甚至注释行）， 并与现场文件自己的调用**撞名**。"	没测该层	keep	keep	—
"恒具体真的循环产出 nudo:loop-truncated（info，锚在函数声明处）"	"一个循环标签 ⇒ 一条诊断（分析内多次求值不重复） 锚点：循环截断事件**不绑函数**（collector 只给 `#loop-iterations` 标签， check 面对同一事件也不给位置/函数归因）⇒ 观测面落在文件起点（1 基行 1、列 0）， 不假装知道是哪一行循环。 不得冒充递归截断 预算归因：循环迭代上限不受 @nudo:budget 控制 ⇒ suggestion 不得指向它 其余截断码不得为同一事件冒名顶替 无循环 ⇒ 不得出现任何截断诊断"	没测该层	keep	keep	—
"无截断文件零误报"	"无循环 ⇒ 不得出现任何截断诊断"	没测该层	keep	keep	—
"自递归截断产出 nudo:recursion-truncated（info，锚在函数声明处）"	"一次事件 ⇒ 一条诊断（分析内多次求值不得重复出诊断） 锚点：函数名起始（1 基行号，0 列不是合法列是另一回事； 行号必须 ≥ 1） 归因措辞与 core check 面一致：cycle 不是预算，抬 @nudo:budget 无效 不得冒充 fork 预算 无递归、无预算压力 ⇒ 不得出现任何截断诊断"	没测该层	keep	keep	—
"无截断文件零误报"	"无递归、无预算压力 ⇒ 不得出现任何截断诊断"	没测该层	keep	keep	—
"假设落在被点名的声明**自己**的那一行（不是上一行）"	"注入行的**下一行**必须是被点名的声明 不得落在 alpha 头上（alpha 是被劫持的落点） 回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」， 不能被上一条语句的**行尾注释**劫持。 // 说明` 的行尾注释**同时**被挂成 下一条声明的 `leadingComments[0]` ⇒ 旧口径 `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;"	没测该层	keep	keep	—
"负控制：行尾注释不是指令 ⇒ 不得被当成行内指令消费"	"注入点不得插到 alpha 那行（行尾注释所在行） 回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」， 不能被上一条语句的**行尾注释**劫持。 // 说明` 的行尾注释**同时**被挂成 下一条声明的 `leadingComments[0]` ⇒ 旧口径 `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;"	没测该层	keep	keep	—
"负控制：不是顶层声明的名字仍进 unapplied"	"回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」， 不能被上一条语句的**行尾注释**劫持。 // 说明` 的行尾注释**同时**被挂成 下一条声明的 `leadingComments[0]` ⇒ 旧口径 `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;"	没测该层	keep	keep	—
"点名的声明落在**自己**的前面（不被同行的前一条声明吃掉）"	"注入点必须紧挨 epsilon（不是 delta） 注入点不得在 delta 之前（那会把假设落到 delta 上） 回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」， 不能被上一条语句的**行尾注释**劫持。 // 说明` 的行尾注释**同时**被挂成 下一条声明的 `leadingComments[0]` ⇒ 旧口径 `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;"	没测该层	keep	keep	—
"同行两条声明各自被点名 ⇒ 两条都 applied（不再有「丢弃 + 编造理由」）"	"回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」， 不能被上一条语句的**行尾注释**劫持。 // 说明` 的行尾注释**同时**被挂成 下一条声明的 `leadingComments[0]` ⇒ 旧口径 `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;"	没测该层	keep	keep	—
"② 重复声明 ⇒ 分析器诊断的码是 nudo:mock-invalid"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"② 重复声明 ⇒ 该诊断**不得**再被说成 nudo:module-missing"	"改前：这条诊断的码恒为 nudo:module-missing（归因错误） 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"② 重复声明 ⇒ warning 级（同码同级：mock-invalid = 指令写法有歧义）"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"① 单条声明 ⇒ 零该诊断（不许误报）"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"③ mock 文件缺失 ⇒ nudo:module-missing + error"	"该族**不得**被改成 mock-invalid 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"③ 门禁面（check 补充通道）同口径：nudo:module-missing + error"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"重复声明 ⇒ 提示「只保留一条声明」（不是通用表达式句）"	"旧通用句（对重复声明不贴切）不得再出现 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"导出名缺失 ⇒ 提示点名那个缺失的导出"	"旧通用句（说「建 mock 文件」⇒ 与事实不符：文件在，只是没导出它） 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"mock 文件缺失 ⇒ 仍是「建 mock 文件 / 改路径」那句（既有文案逐字保留）"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"param.trimLeft() ⇒ param: string()"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"param.trimRight() ⇒ param: string()"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"负控：param.includes(...) 仍推不出 string()（该表刻意排除 Array 同名方法）"	"分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。"	没测该层	keep	keep	—
"同形态但不同调用点 ⇒ 两条独立见证（顺序无关）"	"同一行不同列同样是两个调用点 回归：调用记录去重必须按**调用点身份**，不能按「形态」—— 两个不同现场的调用只要实参/结果/throws 形状相同就会被判成同一条 ⇒ 后到现场的见证被吞，`--from` 顺序决定谁活下来。"	夹具漏形态	keep	keep	—
"对照组：同一调用点被重复采集 ⇒ 仍去重成一条"	"回归：调用记录去重必须按**调用点身份**，不能按「形态」—— 两个不同现场的调用只要实参/结果/throws 形状相同就会被判成同一条 ⇒ 后到现场的见证被吞，`--from` 顺序决定谁活下来。"	夹具漏形态	keep	keep	—
"对象槽字面量不符（期望 { a: 2 }，实际 { a: 1 }）→ 报 nudo:case-expected"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"对象槽字面量类型不同（期望 { a: \"y\" }，实际 { a: \"x\" }）→ 报"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"嵌套对象槽字面量不符（期望 { a: { b: 2 } }，实际 { a: { b: 1 } }）→ 报"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：期望槽是**类型**（number()）→ 口径不变（不报）"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：顶层字面量不符（期望 2，实际 1）→ 口径不变（报）"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：数组元素字面量不符（期望 [\"y\"]，实际 [\"x\"]）→ 口径不变（报）"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"对象槽字面量不符 → 不满足"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"对象槽字面量相符 → 满足"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：期望槽是类型（number()）→ 满足（口径不变）"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"import { Svc }：调用点归因到类所在模块并合成 call@ case"	"归因到**类所在模块**（此前为 undefined → 记录被整条丢弃） 注入后合成 call@ case（不再回落 entry@） `nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认 **命名空间导入**（`exportName === \"*\"`）；"	夹具漏形态	keep	keep	—
"import { Svc as S }（本地名 ≠ 类名）：同样归因到类所在模块"	"`nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认 **命名空间导入**（`exportName === \"*\"`）；"	夹具漏形态	keep	keep	—
"负控制：命名空间导入形态仍按成员名归因（exportName = 成员名）"	"`nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认 **命名空间导入**（`exportName === \"*\"`）；"	夹具漏形态	keep	keep	—
"负控制：别的模块的调用点不得挂到本文件的函数域"	"注入到 t9.js：helper 的记录不得成为 t9.js 的调用点证据 `nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认 **命名空间导入**（`exportName === \"*\"`）；"	夹具漏形态	keep	keep	—
"两个现场文件同行的调用 → 见证名不同（改前都是 call@L2）"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`；"	夹具漏形态	keep	keep	—
"负控制：本地调用点的见证名保持 call@L<n>（与既有已固化名字兼容）"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`；"	夹具漏形态	keep	keep	—
"emitter：已有同名见证不重复写；新见证照写（不再整函数丢弃）"	"用带本地调用点的源码 ⇒ 合成 case 的实参是可序列化的字面量 手工造一个「已固化」的分析结果：同名见证 + 一个新见证 @nudo:case \"call@a.js:L2\" (7, 8) / 同名的 call@a.js:L2 不重复写； 固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `"	夹具漏形态	keep	keep	—
"接线：已固化函数的**新增外部调用点**也合成 call@ 见证"	"未接时该功能惰性 无副作用（新增外部调用点看不见 ⇒ 二次 freeze 丢新见证）。 固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`；"	夹具漏形态	keep	keep	—
"非法 entryThrows + adoption profile：文案说 warning（生效值也是 warning）"	"旧实现：文案写死 \"using error\"（与生效值 warning 矛盾） 根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"非法 entryThrows + strict profile：文案说 error（生效值也是 error）"	"根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"非法 entryThrows + 无 profile：回默认 error，文案说 error"	"根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"合法 entryThrows：不告警，且显式值压过 profile"	"── 负控制：合法值不得被本修复波及 ────────────────────────────── 根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"无 check 段 / 无 entryThrows：不告警，默认 error"	"根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"profile 预设本身仍生效（adoption→warning / strict→error），无告警"	"根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被 profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。 修法：先算出最终生效档位，再按**生效值**拼告警文案 （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 → 落到 config profile 预设）。"	夹具漏形态	keep	keep	—
"满足谓词：期望 number().gt(0)，实际 2 → 无 nudo:case-expected"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：违反谓词（期望 number().gt(5)，实际 2）→ 仍报 nudo:case-expected"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：无谓词的期望（number()）口径不变 → 无诊断"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"负控制：类型不匹配的期望（string()）→ 仍报 nudo:case-expected"	"找出 nudo:case-expected 诊断（期望不满足）。"	没测该层	keep	keep	—
"非导出辅助函数改写模块级状态后，导出函数的入口用例仍从初值起算"	"改前：f → 1（复用了 inc 调用后的实例） 合成入口用例（entry@）之间的**模块级状态串味**。 改前：`tryRunEval` 的 memo 按「文件 × mode」命中时直接返回缓存里的 `out`，而 `out.exports` 是**活模块实例**（导出函数的闭包捕获着模块级 `let` 绑定）⇒ 后一个合成用例看到前一个用例改写过的模块级状态。"	没测该层	keep	keep	—
"多个导出函数的入口用例互不串味（各自独立实例）"	"改前：a → 2 / b → 3 / c → 4（同一个实例累加） 合成入口用例（entry@）之间的**模块级状态串味**。 改前：`tryRunEval` 的 memo 按「文件 × mode」命中时直接返回缓存里的 `out`，而 `out.exports` 是**活模块实例**（导出函数的闭包捕获着模块级 `let` 绑定）⇒ 后一个合成用例看到前一个用例改写过的模块级状态。"	没测该层	keep	keep	—
"声明式 @nudo:case 的求值结果不变"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"无模块级状态的模块，入口用例结果不变"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"模块级状态未被改写时，读到的就是初值"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"include: [\"src\"] 命中 src 下的文件（改前：永不命中 → 白名单作废）"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include: [\"src\"] 不命中 src-other / lib（字面量不是子串搜索）"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include: [\"src/a.js\"] 只命中这一个文件"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include: [\"src/**\"] 命中整个子树，不命中 lib"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include: [\"src/*.js\"] 不跨 /（段内通配）"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include: [\"**/*.js\"] 命中任意目录的 .js"	"改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定 全等正则 `^literal$`（相对项目根），`include: [\"src\"]` 对 `src/a.js` **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。 本次定的语义（写在 analysis-scope.includeHit 的注释里）： - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索： `src` 命中 `src/**`，不命中 `src-other/c."	夹具漏形态	keep	keep	—
"include 多条：任一命中即纳入"	"\\\"] 命中整个子树，不命中 lib\", () => { const dir = project([\"src/**\"]); it(\"include: [\\\"src/*.js\\\"] 不跨 /（段内通配）\", () => { const dir = project([\"src/*.js\"]);"	没测该层	keep	keep	—
"负控制：include 为空 → 不过滤（mode=all 全纳入）"	"\\\"] 命中整个子树，不命中 lib\", () => { const dir = project([\"src/**\"]); it(\"include: [\\\"src/*.js\\\"] 不跨 /（段内通配）\", () => { const dir = project([\"src/*.js\"]);"	没测该层	keep	keep	—
"负控制：exclude 的字面量子串语义不变（src/vendored 命中子树）"	"\\\"] 命中整个子树，不命中 lib\", () => { const dir = project([\"src/**\"]); it(\"include: [\\\"src/*.js\\\"] 不跨 /（段内通配）\", () => { const dir = project([\"src/*.js\"]);"	没测该层	keep	keep	—
"A → B → A（memo 命中）：预算回到 A 的值（不是 B 的最后写入者）"	"旧实现：memo 命中直接返回、不重写 → 仍是 B 的 22 `nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒ 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 / session-cac"	没测该层	keep	keep	—
"A → B → A：会话 LRU 上限同样随本次解析回到 A"	"`nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒ 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 / session-cache-limits 的 fromProject 单槽），而写入只"	没测该层	keep	keep	—
"无 nudo 键的目录：预算回落默认（不是上一个项目的值）"	"旧实现：memo 命中不重写 → 仍是 11（上一个项目的预算泄漏） `nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒ 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 / session-"	没测该层	keep	keep	—
"同一项目重复解析：预算稳定"	"── 负控制：单项目重复解析不得改变结论 ────────────────────────── `nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒ 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算"	没测该层	keep	keep	—
"env NUDO_MAX_FORKS 仍压过项目配置（优先级不变）"	"`nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒ 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 / session-cache-limits 的 fromProject 单槽），而写入只"	没测该层	keep	keep	—
"实例方法：见证求值出确切值 1（改前恒 unknown）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`；"	没测该层	keep	keep	—
"实例方法：见证实参参与运算（(1) => 2）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`；"	没测该层	keep	keep	—
"负控制：顶层函数同款 case 口径不变（结果 1）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`；"	没测该层	keep	keep	—
"负控制：判不出来时如实回落 unknown（不编造值）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`；"	没测该层	keep	keep	—
"模块状态不同：见证值 = 现场观测值 6（改前被重算成 1）"	"合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出 的调用点真值与实际调用结果矛盾（错误的确切值）。 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension` 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值） 被目标语境（被分析文件语境）的值顶掉。"	没测该层	keep	keep	—
"负控制：无状态差异的调用点值不变（3）"	"合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出 的调用点真值与实际调用结果矛盾（错误的确切值）。 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension` 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值） 被目标语境（被分析文件语境）的值顶掉。"	没测该层	keep	keep	—
"export * barrel：记录归因到定义文件，domain-exceeds 门禁照报"	"归因到**定义文件**（此前是中间 barrel → 门禁证据蒸发） `export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；"	没测该层	keep	keep	—
"改名再导出 barrel（export { area as area2 }）：记录名跟到定义侧导出名"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；"	没测该层	keep	keep	—
"负控制：直接 import（无 barrel）行为不变——门禁照报"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；"	没测该层	keep	keep	—
"负控制：别处的记录不得在本文件报门禁（跨文件污染守卫）"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；"	没测该层	keep	keep	—
"负控制：模块未导出该名 → 回落 import 目标（不猜、不崩）"	"解析不出定义位点 → 保持 import 目标（不静默丢弃记录） `export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；"	没测该层	keep	keep	—
"anchors the dual-entry issue on line 1 (not the line-0 placeholder)"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"anchors the node face on line 1 too (both variants)"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"keeps the legacy browser-field package shape anchored"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"negative control: single-entry package still yields no issue at all"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"negative control: non-entry helper inside a dual package yields no issue"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"analyzeFile 的 dual-entry 诊断落在第 1 行（不是 line 0 占位）"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。"	没测该层	keep	keep	—
"跨模块：display 由求值面合成，与 resultAbs / nudo check 签名一致"	"求值面：确切的 7 人读摘要：不得宣称推断失败 与 nudo check 的签名同口径（run() => 7） 根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。"	没测该层	keep	keep	—
"负控制：同模块（符号面有效）display 保持符号面形态"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。"	没测该层	keep	keep	—
"负控制：真推断失败时 display 仍如实说 unknown（与 payload 一致）"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。"	没测该层	keep	keep	—
"不变量：任何 case 的 display 不得与同一条 payload 的 abs 矛盾"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。"	没测该层	keep	keep	—
"does not launder an unrecognized name into any()"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达"	没测该层	keep	keep	—
"does not launder a TS type reference (T.*) into any()"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达"	没测该层	keep	keep	—
"echoes the actual injection instead of the user text when degraded"	"注入的是 unknown（不是 any()，也不是用户原文 Date） 回显不再声称「按 Date 应用」 what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是"	没测该层	keep	keep	—
"degrades a union with one unrecognized member as a whole"	"union(number(), unknown) 不是合法的约束构建器实参 → 整条降级 what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs**"	没测该层	keep	keep	—
"negative control: expressible expressions keep their mapping and echo"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达"	没测该层	keep	keep	—
"negative control: explicit unknown / any stay expressible (no degradation note)"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达"	没测该层	keep	keep	—
"negative control: bindings with no top-level declaration stay unapplied"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达"	没测该层	keep	keep	—
"函数体内调用：被调方有 call@ 见证（改前只有 entry@）"	"调用点域恢复 ⇒ 被调方不再误报 entry-only（调用方 run 仍无调用点域，仍报） 调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records；"	没测该层	keep	keep	—
"负控制：顶层调用点口径不变（call@ 见证仍在）"	"调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records；"	没测该层	keep	keep	—
"负控制：非导出函数口径不变（保留 entry@ 见证）"	"调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records；"	没测该层	keep	keep	—
"同一非法值在多次 checkConfig 调用里只告警一次"	"`NudoConfig[\"check\"][\"entryThrows\"]` 的静态类型是 `\"error\" | \"warning\" | \"off\"`， 而运行时**必须**容错（`checkConfig` 对非法值告警并回落可用档位）⇒ 这里用一次**测试专用**的类型断言表达「我要喂一个类型之外的字面量」， **断言语义不变**：被测的仍是运行时行为，不是类型。"	夹具漏形态	keep	keep	—
"负控制：不同非法值各告警一次（去重键含值）"	"`NudoConfig[\"check\"][\"entryThrows\"]` 的静态类型是 `\"error\" | \"warning\" | \"off\"`， 而运行时**必须**容错（`checkConfig` 对非法值告警并回落可用档位）⇒ 这里用一次**测试专用**的类型断言表达「我要喂一个类型之外的字面量」， **断言语义不变**：被测的仍是运行时行为，不是类型。"	夹具漏形态	keep	keep	—
"负控制：合法值不告警"	"`NudoConfig[\"check\"][\"entryThrows\"]` 的静态类型是 `\"error\" | \"warning\" | \"off\"`， 而运行时**必须**容错（`checkConfig` 对非法值告警并回落可用档位）⇒ 这里用一次**测试专用**的类型断言表达「我要喂一个类型之外的字面量」， **断言语义不变**：被测的仍是运行时行为，不是类型。"	夹具漏形态	keep	keep	—
"非法值仍回落可用档位（告警文案里的 using 段与生效档一致）"	"`NudoConfig[\"check\"][\"entryThrows\"]` 的静态类型是 `\"error\" | \"warning\" | \"off\"`， 而运行时**必须**容错（`checkConfig` 对非法值告警并回落可用档位）⇒ 这里用一次**测试专用**的类型断言表达「我要喂一个类型之外的字面量」， **断言语义不变**：被测的仍是运行时行为，不是类型。"	夹具漏形态	keep	keep	—
"case 上的 `!! throws TypeError` ⇒ 不发 nudo:may-throw"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"函数级 `@nudo:throws TypeError` ⇒ 不发 nudo:may-throw"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"侧车 `fn(…, { throws: \"TypeError\" })` ⇒ 不发 nudo:may-throw"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"负控制：未申报 ⇒ 仍发 nudo:may-throw（口径不变）"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"负控制：申报的 kind 不覆盖实测 kind（RangeError vs TypeError）⇒ 仍发"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"负控制：申报 Error（族）覆盖实测 TypeError ⇒ 不发"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"负控制：坏侧车 ⇒ nudo:contract-load 仍报（memo 化不得吞掉加载失败）"	"`nudo:may-throw` 诊断条数（case 级「未处理的抛」）。"	没测该层	keep	keep	—
"推导失败 + 期望 number() ⇒ 只有 nudo:opaque-result，且严重度是 info"	"分析一个带声明期望的 case 文件，返回全部诊断。"	没测该层	keep	keep	—
"推导失败 + 期望 any() ⇒ 同上（不放宽的期望不得空洞通过）"	"分析一个带声明期望的 case 文件，返回全部诊断。"	没测该层	keep	keep	—
"负控制：推导成功 + 期望不符 ⇒ 仍是 nudo:case-expected（error）"	"分析一个带声明期望的 case 文件，返回全部诊断。"	没测该层	keep	keep	—
"负控制：推导成功 + 期望相符 ⇒ 两者都不产出"	"分析一个带声明期望的 case 文件，返回全部诊断。"	没测该层	keep	keep	—
"推导失败 + 期望 number() ⇒ unchecked（不是 failed）"	"跑一个带声明期望的 case 文件，返回报告面结果。"	没测该层	keep	keep	—
"推导失败 + 期望 any() ⇒ 同样 unchecked（不是空洞 passed）"	"跑一个带声明期望的 case 文件，返回报告面结果。"	没测该层	keep	keep	—
"负控制：推导成功 + 期望不符 ⇒ 仍是 failed（既有行为不变）"	"跑一个带声明期望的 case 文件，返回报告面结果。"	没测该层	keep	keep	—
"负控制：声明了但没写期望 ⇒ no-expectation 口径不变"	"跑一个带声明期望的 case 文件，返回报告面结果。"	没测该层	keep	keep	—
"负控制：抛错（实测 never）⇒ 仍是 failed（never 不是「推导失败」）"	"跑一个带声明期望的 case 文件，返回报告面结果。"	没测该层	keep	keep	—
```
