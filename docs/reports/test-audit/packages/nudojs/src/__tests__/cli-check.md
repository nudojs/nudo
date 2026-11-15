# packages/nudojs/src/__tests__/cli-check.test.ts

模块套件：116 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"dts 面：有调试见证与无证据的投影相同（形参是 unknown，不是 number）"	"症状：`/** @nudo:case \"dom\" (number()) *\\/ export function f(x) { return x + 1; 而 `nudo check` 的签名是 `f(x: any) => number | string` （门禁面以 caseMode \"none\" 调分析器，**永不**产出指令见证）。"	没测该层	keep	keep	—
"zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）"	"症状：`/** @nudo:case \"dom\" (number()) *\\/ export function f(x) { return x + 1; 而 `nudo check` 的签名是 `f(x: any) => number | string` （门禁面以 caseMode \"none\" 调分析器，**永不**产出指令见证）。"	没测该层	keep	keep	—
"与 nudo check 的签名同口径（发布面 = 门禁面）"	"症状：`/** @nudo:case \"dom\" (number()) *\\/ export function f(x) { return x + 1; 而 `nudo check` 的签名是 `f(x: any) => number | string` （门禁面以 caseMode \"none\" 调分析器，**永不**产出指令见证）。"	没测该层	keep	keep	—
"dts：有 case 与无 case 逐字相同（均门禁口径 x: unknown）"	"有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。"	没测该层	keep	keep	—
"schema：入参是宽松域（z.unknown），不是 case 的 z.number"	"有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。"	没测该层	keep	keep	—
"guard：入参接受 string（实现允许 f(\"s\")）"	"有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。"	没测该层	keep	keep	—
"`nudo contract` 打印面与 check 同口径（x: any）"	"有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。"	没测该层	keep	keep	—
"计数器工厂：check 与 test 都给 1"	"回归：`nudo check` 的签名必须是**一次正常求值**的结果。 症状（报告时的形态）：check 通道先跑分析器再跑 core 闸门，两轮共享同一份 模块实例 ⇒ 模块级可变状态被双写，闸门打印的签名取自脏状态： - `let c = 0;"	夹具漏形态	keep	keep	—
"一次性抛：check 给 never（与 d.ts 一致），不是 1"	"回归：`nudo check` 的签名必须是**一次正常求值**的结果。 症状（报告时的形态）：check 通道先跑分析器再跑 core 闸门，两轮共享同一份 模块实例 ⇒ 模块级可变状态被双写，闸门打印的签名取自脏状态： - `let c = 0;"	夹具漏形态	keep	keep	—
"手写 lit(1) 生成段 ⇒ 不报 contract-drift（脏值会与生成段打架）"	"回归：`nudo check` 的签名必须是**一次正常求值**的结果。 症状（报告时的形态）：check 通道先跑分析器再跑 core 闸门，两轮共享同一份 模块实例 ⇒ 模块级可变状态被双写，闸门打印的签名取自脏状态： - `let c = 0;"	夹具漏形态	keep	keep	—
"clean 文件 ⇒ 恰好一行摘要（旧实现 3 行 OK 块 + 代数面）"	"根因：渲染分支里 `opts.abs` 排在 `opts.quiet` **之前**，且 abs 分支自己打 完整 report + 3 行 OK 块、完全不 consult quiet。 现在 `--quiet` 优先 （压 signatures / 代数面，只留摘要），`--abs --verbose` 也不再被吞。"	没测该层	keep	keep	—
"失败文件 ⇒ 不打 signatures 段（与单独 --quiet 同形）"	"诊断仍上屏（--quiet 只压签名，不吞错误） 根因：渲染分支里 `opts.abs` 排在 `opts.quiet` **之前**，且 abs 分支自己打 完整 report + 3 行 OK 块、完全不 consult quiet。 现在 `--quiet` 优先 （压 signatures / 代数面，只留摘要），`--abs --verbose` 也不再被吞。"	没测该层	keep	keep	—
"带 assume：--abs 与 --json 的 abs 面出现同一句 pred"	"每次调用独立的缓存目录：`nudo check` 有落盘缓存，串用会掩盖回归"	没测该层	keep	keep	—
"对照组（无 assume 行）：两面都不出现该 pred"	"观察面仍在算（term 可见），只是没有前提可折 ⇒ 无 pred 每次调用独立的缓存目录：`nudo check` 有落盘缓存，串用会掩盖回归"	没测该层	keep	keep	—
"`nudo test --abs` 走同一观察面 ⇒ 前提同样可见"	"每次调用独立的缓存目录：`nudo check` 有落盘缓存，串用会掩盖回归"	没测该层	keep	keep	—
"zod / standard / guard 三面都保留 union（同一 zod 文件内 Input 与 Output 同口径）"	"zod 返回面不再是 z.unknown() standard 节点是 union（不是 {\"k\":\"unknown\"}） guard 不是恒真 dts 面保留 union（四面同口径） 返回契约若是「**shape 的 union**」，zod / standard / guard **三个 运行时面全部塌缩**为「接受一切」⇒ 契约违约值被放行（假绿），而 dts / check 仍保留 union ⇒ 四面互斥。 根因：`constraintDisproved` 的 `constraint.fields` 分"	没测该层	keep	keep	—
"运行时：standard 面拒绝契约违约值、接受契约允许值"	"返回契约若是「**shape 的 union**」，zod / standard / guard **三个 运行时面全部塌缩**为「接受一切」⇒ 契约违约值被放行（假绿），而 dts / check 仍保留 union ⇒ 四面互斥。 根因：`constraintDisproved` 的 `constraint.fields` 分支缺 `sum` 判定（与 `constraint.prim` 分支的处理**不对称**）⇒ identity 函数把 union 原样返回时 逐个 shape 成员一律被判「已证否」⇒"	没测该层	keep	keep	—
"空目录 ⇒ path-empty-dir 进 sink，且不返回记录"	"回归：`--from <空目录>` 必须报路径错误（`nudo:path-empty-dir`）， 不能静默通过。 改前空目录展开成 `[]` ⇒ 循环体一次都不执行 ⇒ 既不产生 PathError 也不产生 调用记录 ⇒ 上层回落 `entry@` + exit 0（假绿）。"	没测该层	keep	keep	—
"对照组：非空目录现场照常采集（无路径错误）"	"回归：`--from <空目录>` 必须报路径错误（`nudo:path-empty-dir`）， 不能静默通过。 改前空目录展开成 `[]` ⇒ 循环体一次都不执行 ⇒ 既不产生 PathError 也不产生 调用记录 ⇒ 上层回落 `entry@` + exit 0（假绿）。"	没测该层	keep	keep	—
"已固化见证 + 另一现场 ⇒ 同名 case 只出现一次，summary.cases == 不同见证数"	"回归：`--from` 的调用点见证不得被**两条合成路径各合成一次**。 改前「已固化 directive 见证 + 主候选循环的 callsite 见证」会产出同名两条 ⇒ 台账里 `call@` 出现两次、人类面打印两遍、`summary.cases` 重复计数。"	夹具漏形态	keep	keep	—
"--gitlab 语法错文件 ⇒ stdout 是**可解析数组**且含该文件的条目"	"`.js` 里的 TS-only 语法 ⇒ 语法错通道"	没测该层	keep	keep	—
"--gitlab 路径不存在 ⇒ stdout 仍是可解析数组（不是 0 字节）"	"`.js` 里的 TS-only 语法 ⇒ 语法错通道"	没测该层	keep	keep	—
"--gha 语法错文件 ⇒ 至少一条 ::error 注解"	"`.js` 里的 TS-only 语法 ⇒ 语法错通道"	没测该层	keep	keep	—
"批量（坏 + 绿）⇒ 一份数组里同时有语法错行与绿文件无关行（不丢坏文件）"	"`.js` 里的 TS-only 语法 ⇒ 语法错通道"	没测该层	keep	keep	—
"三个同内容文件的载荷逐字相同（换序也不变）"	"抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`）"	没测该层	keep	keep	—
"载荷三字段不含内部 id"	"抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`）"	没测该层	keep	keep	—
"机器面 display 与人类面 signatures 行同源"	"抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`）"	没测该层	keep	keep	—
"--verbose 人类面不得含内部 id"	"抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`）"	没测该层	keep	keep	—
"zod 入参面：契约覆盖的位 + 未覆盖的形参位都在（不丢位）"	"契约覆盖的位：契约 Abs 未被契约覆盖的形参位：**不丢**（改前整个 `other` 位消失） **部分契约**（契约只覆盖部分形参）时，未被契约覆盖的形参位在 产物面里被**静默丢掉**：契约面与观测面二选一，不是合流。 症状（改前）：`@nudo:contract n pos` 只声明了 `n`，函数签名是 `f(n, other)` ⇒ zod 面产出 `z.object({ n: z.number().gt(0) })` —— `other` 位**消失**；"	没测该层	keep	keep	—
"dts 面与 zod 面同口径：未覆盖的形参位在 dts 里也在"	"**部分契约**（契约只覆盖部分形参）时，未被契约覆盖的形参位在 产物面里被**静默丢掉**：契约面与观测面二选一，不是合流。 症状（改前）：`@nudo:contract n pos` 只声明了 `n`，函数签名是 `f(n, other)` ⇒ zod 面产出 `z.object({ n: z.number().gt(0) })` —— `other` 位**消失**；"	没测该层	keep	keep	—
"zod 面：见证不进 Output 面，也不泄漏见证返回值"	"函数仍出现在产物里（Input 面照常产出）——与见证口径无关的真实行为 见证是调试见证，不进发布面 ⇒ 只带 `@nudo:case` 的 skip 函数 没有 Output 校验器（域证据为空 ⇒ 返回面无种子） 见证返回值（4 / 6）不泄漏进产物 `@nudo:skip` + 多条 case 见证时，**Output 面（返回面）不产出**： 兜底只取「第 0 条断言见证」，而无断言的 case 是见证不是断言 ⇒ 兜底落空。 症状（改前）：两条 `@nudo:case` 见证（返回 4 / 6）的 ski"	没测该层	keep	keep	—
"standard 面：同样没有 Output 校验器"	"函数仍出现在产物里（Input 面照常产出） 见证不进发布面 ⇒ 没有 Output 校验器 `@nudo:skip` + 多条 case 见证时，**Output 面（返回面）不产出**： 兜底只取「第 0 条断言见证」，而无断言的 case 是见证不是断言 ⇒ 兜底落空。 症状（改前）：两条 `@nudo:case` 见证（返回 4 / 6）的 skip 函数，zod 面只有 `<fn>Input`、**没有** `<fn>Output`；"	没测该层	keep	keep	—
"zod 入参面：点路径 ⇒ 嵌套 obj（不是字面量点号键）"	"症状（改前）：侧车 `fn({ \"card.grade\": string() }, string())` 声明了解构形参 `{ card: { grade } }` 的内层字段约束 ⇒ zod 面产出 `z.object({ \"card.grade\": z.string() })` —— 点号键成了对象属性名（调用面里根本没有这个属性），而 dts 面是 `nested({ card }: { card: { grade: string } })` ⇒ 两个产物面自相矛盾。 根因（族 17 · S1）：`expor"	夹具漏形态	keep	keep	—
"dts 面保持嵌套形状（两面的节点形状一致）"	"症状（改前）：侧车 `fn({ \"card.grade\": string() }, string())` 声明了解构形参 `{ card: { grade } }` 的内层字段约束 ⇒ zod 面产出 `z.object({ \"card.grade\": z.string() })` —— 点号键成了对象属性名（调用面里根本没有这个属性），而 dts 面是 `nested({ card }: { card: { grade: string } })` ⇒ 两个产物面自相矛盾。 根因（族 17 · S1）：`expor"	夹具漏形态	keep	keep	—
"call@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1"	"旧行为：被当成 synthetic ⇒ 无 [FAIL] 行、exit 0（报告自相矛盾） 声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是 **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。"	没测该层	keep	keep	—
"entry@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1"	"声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是 **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。"	没测该层	keep	keep	—
"--freeze 写回形态的名字（call@<file>:<line>）：仍是声明式见证 ⇒ 计入失败 + exit 1"	"声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是 **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。"	没测该层	keep	keep	—
"普通名字的声明式见证：与前缀变体同构（同样计入失败 + exit 1）"	"声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是 **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。"	没测该层	keep	keep	—
"call@ 前缀的声明式见证：期望相符 ⇒ 计入通过、exit 0（不是 unchecked / synthetic）"	"通过的行（不是 [unchecked] 行）⇒ 该 case 计入断言面且被判定通过 声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是 **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。"	没测该层	keep	keep	—
"无函数文件：--abs 与非 --abs 同为 exit 0 + 同一句报告"	"旧症状：--abs 面 exit 1 两面同一句「无函数可分析」结论 旧症状：--abs 面多打一行「Function not found」（与上面那句直接打架） `nudo test --abs` 在**一个函数都没有**的文件上 exit 1 + 打 「Function not found」； 同一命令**不带** `--abs` 却 exit 0 ⇒ 同一输入、 同一份报告，仅因多一个旗标就换了退出码，且两条文案互相打架。"	没测该层	keep	keep	—
"无函数文件：--json 面（另一条机器面）同样 exit 0"	"`nudo test --abs` 在**一个函数都没有**的文件上 exit 1 + 打 「Function not found」； 同一命令**不带** `--abs` 却 exit 0 ⇒ 同一输入、 同一份报告，仅因多一个旗标就换了退出码，且两条文案互相打架。"	没测该层	keep	keep	—
"对照：check --abs 的「无函数 ⇒ exit 1」是既有期望行为（Bug 669）不被本片改动"	"`nudo test --abs` 在**一个函数都没有**的文件上 exit 1 + 打 「Function not found」； 同一命令**不带** `--abs` 却 exit 0 ⇒ 同一输入、 同一份报告，仅因多一个旗标就换了退出码，且两条文案互相打架。"	没测该层	keep	keep	—
"拼错的函数名 → Function not found + exit 1（不再是 unknown/partial）"	"旧行为：把拼错的名字当「引擎推导失败」打印出来 `nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」 （unknown / conf: partial）而不是**用法错误**。 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`， 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒ 同一类错误两个口径）。"	没测该层	keep	keep	—
"真实函数名 → 正常观察面（不误伤）"	"`nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」 （unknown / conf: partial）而不是**用法错误**。 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`， 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒ 同一类错误两个口径）。"	没测该层	keep	keep	—
"文件本身没有函数 → 既有口径不变（Function not found + exit 1）"	"`nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」 （unknown / conf: partial）而不是**用法错误**。 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`， 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒ 同一类错误两个口径）。"	没测该层	keep	keep	—
"CLI 级：拼错的函数名 → 进程 exit 1（check 报告段不把 exitCode 复位）"	"`nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」 （unknown / conf: partial）而不是**用法错误**。 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`， 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒ 同一类错误两个口径）。"	没测该层	keep	keep	—
"`x=5` 这类坏值 → exit 1（旧行为 exit 0）"	"旧行为：坏值被吞掉后继续跑观察面 旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。"	没测该层	keep	keep	—
"好值仍然生效（不误伤）"	"旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。"	没测该层	keep	keep	—
"多个 --assume 里混一个坏值 → 仍然 exit 1（不得部分生效后假绿）"	"旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。"	没测该层	keep	keep	—
"CLI 级：坏值 → 进程 exit 1"	"旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。"	没测该层	keep	keep	—
"解析器：配置面裸字符串 / 数组元素内逗号都被切开"	"与 CLI 解析器逐字同结果（配置面不再走 service 的严格 string[] 过滤） 未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"CLI：配置写裸字符串 \"TypeError\" ⇒ L2 被忽略（门禁绿）"	"未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"CLI：配置写 [\"TypeError,RangeError\"] ⇒ 数组元素内逗号被切开（门禁绿）"	"未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"CLI：配置写 [\"TypeError\"]（旧口径，未回归）⇒ 门禁绿"	"未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"CLI：形状非法（42）⇒ 回落默认 + stderr 一行告警（不静默假红）"	"回落默认 = 不忽略任何 throw 类 ⇒ L2 仍红（诚实） 未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"CLI：CLI 旗标形态不变（--ignore-throws TypeError,RangeError 仍绿）"	"未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿）"	没测该层	keep	keep	—
"--abs 面：诊断段上屏（旧行为：整段消失 ⇒ 屏幕上零提示）"	"期望写错（`42x` 不是合法类型表达式）⇒ 至少一条指令语法诊断。"	没测该层	keep	keep	—
"三个面（默认 / --abs / --json）对同一文件的诊断条数一致"	"期望写错（`42x` 不是合法类型表达式）⇒ 至少一条指令语法诊断。"	没测该层	keep	keep	—
"对照：check --abs 的既有口径不动（report ok 时不打 issues 列表）"	"check 面是另一个 verb 的既有口径（）⇒ 本钉只保证 test --abs 的诊断可见，不把 check --abs 改成无条件打 issues。 期望写错（`42x` 不是合法类型表达式）⇒ 至少一条指令语法诊断。"	没测该层	keep	keep	—
"`x>=1` ⇒ 谓词是 (x + 1) ≥ 2（不是 > 1.999…）"	"`--assume` 的运算符被**一律按 `>` 构造** ⇒ 用户写 `x>=1` 实际得到 `x>1` ⇒ 引擎里的谓词与用户写的不一致 （`x+1 > 1.9999999999999998` 而不是 `x+1 ≥ 2`）。 修复：谓词构造按运算符分派（core 既有导出 `geNum` / `gtNum`）， 回显行打印**实际构造出来的谓词**。"	夹具漏形态	keep	keep	—
"`x>1` ⇒ 谓词是 (x + 1) > 1.999…（与 >= 不同）"	"`--assume` 的运算符被**一律按 `>` 构造** ⇒ 用户写 `x>=1` 实际得到 `x>1` ⇒ 引擎里的谓词与用户写的不一致 （`x+1 > 1.9999999999999998` 而不是 `x+1 ≥ 2`）。 修复：谓词构造按运算符分派（core 既有导出 `geNum` / `gtNum`）， 回显行打印**实际构造出来的谓词**。"	夹具漏形态	keep	keep	—
"x>100 且 y>200 ⇒ 谓词 (x + y) > 300（两条都在场）"	"合取 ⇒ 两条界都进结果谓词 旧行为：只剩最后一条 ⇒ (x + y) > 200 旧行为：`--assume x>100 --assume y>200` ⇒ φ = `y>200` ⇒ 结果谓词 `(x + y) > 200`（x 的界丢失）。 修复：多条假设**合取**（core 既有导出 `algebra.and`）⇒ `(x + y) > 300`。"	没测该层	keep	keep	—
"顺序无关（y 在前也一样合取）"	"旧行为：`--assume x>100 --assume y>200` ⇒ φ = `y>200` ⇒ 结果谓词 `(x + y) > 200`（x 的界丢失）。 修复：多条假设**合取**（core 既有导出 `algebra.and`）⇒ `(x + y) > 300`。"	没测该层	keep	keep	—
"组合 → 用法错误 + exit 1（且不回显 assume）"	"旧行为：打印 assume 回显（说谎），然后 generalize 照跑 `--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**， 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口） ⇒ 静默说谎：用户以为假设参与了符号推导。 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。"	没测该层	keep	keep	—
"单独 --generalize 仍然可用（不误伤）"	"`--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**， 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口） ⇒ 静默说谎：用户以为假设参与了符号推导。 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。"	没测该层	keep	keep	—
"单独 --assume 仍然可用（不误伤）"	"`--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**， 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口） ⇒ 静默说谎：用户以为假设参与了符号推导。 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。"	没测该层	keep	keep	—
"CLI 级：组合 → 进程 exit 1"	"`--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**， 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口） ⇒ 静默说谎：用户以为假设参与了符号推导。 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。"	没测该层	keep	keep	—
"--assume 'x>-5' ⇒ x=-1 可达 ⇒ 结果含 \"neg\""	"改前：只有 \"pos\"（写死的 x>0 剪掉了 x<0 分支） 根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把 形参自己的前提（pred）**写死**成 `x > 0`。 用户写 `--assume 'x>-5'` 时， 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝， `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `\"pos\"`。"	没测该层	keep	keep	—
"--assume 'x>=-5' ⇒ 同上（>= 运算符分派不被破坏）"	"根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把 形参自己的前提（pred）**写死**成 `x > 0`。 用户写 `--assume 'x>-5'` 时， 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝， `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `\"pos\"`。"	没测该层	keep	keep	—
"负控制：--assume 'x>0' ⇒ 仍只有 \"pos\"（用户界与写死界一致时口径不变）"	"根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把 形参自己的前提（pred）**写死**成 `x > 0`。 用户写 `--assume 'x>-5'` 时， 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝， `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `\"pos\"`。"	没测该层	keep	keep	—
"负控制：同一形参多条界取**合取**（x>-5 且 x>0 ⇒ 更强的 x>0 生效）"	"合取后是 x>0 ⇒ x<0 分支不可达（修复不得把界放宽成「取其中一条」） 根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把 形参自己的前提（pred）**写死**成 `x > 0`。 用户写 `--assume 'x>-5'` 时， 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝， `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `\"pos\"`。"	没测该层	keep	keep	—
"人类面：check 报 contract-load error + exit 1（旧行为：exit 0 假绿）"	"侧车写坏（import 了非构建器名）时，`nudo check` **门禁绿灯、 exit 0**（假绿），而 `nudo test` / `nudo health` 都报 error。 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在 `execSidecar` 内部产生 ⇒ exec 结果进缓存后，缓存命中不再跑 exec ⇒ 诊断 在后续分析里消失。"	没测该层	keep	keep	—
"--json 面：信封 ok:false + issues 含 nudo:contract-load（且只一条）"	"单文件无路径错误 ⇒ 直出 CheckJson； 多文件/路径错误 ⇒ multi 信封 侧车写坏（import 了非构建器名）时，`nudo check` **门禁绿灯、 exit 0**（假绿），而 `nudo test` / `nudo health` 都报 error。 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在 `execSidecar` 内部产生 ⇒ exec 结果进缓存后，缓存命中不再跑 exec ⇒ 诊断 在后续分析里消失。"	没测该层	keep	keep	—
"含 internal 回落的文件 ⇒ exit ≠ 0（修前是 0 = 假绿）+ 人类面明确失败行"	"之后模块级原生异常归类为 `nudo:module-throw`（用户代码的异常不再是 引擎内部缺陷），因此不再有 `analysis failed for … internal fallback` 行； 契约不变：该文件必须红，且失败原因必须可见。 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"--json 面：机器可判定（ok:false + nudo:internal error issue）+ exit ≠ 0"	"正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"假红防线：正常文件（零回落）仍 exit 0（不得误报）"	"正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"假红防线：unsupported:*（能力边界）回落**不**变成闸门失败"	"能力边界回落**不得**产出「分析失败」信号（`nudo:internal`）—— 该文件的红色只能来自既有诊断（如 L2 entry-may-throw），不得来自本条。 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"check --fix 与 plain check 同口径：同一文件不得「check 红 / --fix 绿」"	"只断言退出码同口径（--fix 不打印诊断清单，它是「计划/写盘」面）： 不得出现 `check` 红而 `--fix` 绿。 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"模块级原生异常不再是「分析失败」⇒ health 只看漂移，报 OK（口径变更）"	"` 被**确定性**归类为 `nudo:module-throw`（分析本身成功，结论是「这个模块装载必抛」）， 不再走 `internal` 回落 ⇒ 的 health 断言前提（「分析失败 ⇒ 闸门 无法裁决」）消失：health 的失败判据是 **contract drift / case drift / path error / internal 回落**，不含「代码本身必抛」这类**可裁决**的缺陷 ——那由 `nudo check` 报红（见上方用例）。 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"正常文件 ⇒ Result: OK + exit 0（不得误报）"	"正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"假红防线：unsupported:*（能力边界）回落 ⇒ health 仍 OK（不得误报）"	"正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。"	没测该层	keep	keep	—
"`--json` 不再声称「仅 `--draft`」，且**提到** print / `--draft` / `--emit` 三形态"	"① 不再声称「With --draft: …」（即不再声称 `--json` 只能配 `--draft`） ② 三形态都被点名（print / `--draft` / `--emit`） ③ 顶层恒为数组 + 元素形状按形态不同（逐形态一句） ⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿与"	夹具漏形态	keep	keep	—
"帮助文本不骗人：print 形态的 `--json` 顶层**恒为数组**（帮助说的三形态都成立）"	"⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `tsc --strict` ⇒ `types/index.d.ts` ⇒ `types/index.nudo.draft.ts`。"	没测该层	keep	keep	—
"拒绝覆盖时提示**同时**给出 `--force` 与 `NUDO_DRAFT_FORCE`（既有草稿逐字不变）"	"既有草稿（内容与新生成的不同 ⇒ 触发「存在且不同」那一关） 两个放行口子都可见（旗标 + 环境变量） 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为 既有草稿逐字不变（没有静默丢内容）+ 没有谎报成功 ⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `"	没测该层	keep	keep	—
"**人工改过的草稿永不被覆盖**（`--force` 也不放行）⇒ 拒绝仍然发生、文件逐字不变"	"先写一次机器原稿 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」 `--force` 放行不了「人工改过」的草稿 ⇒ 拒绝**仍然发生** ⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `tsc --strict` ⇒ `types/index.d.ts` ⇒"	没测该层	keep	keep	—
"提示里的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功"	"先写一次机器原稿 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ `--force` 可覆盖） ⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `tsc --strict` ⇒ `types/index.d.ts` ⇒ `types/index.n"	没测该层	keep	keep	—
"环内文件的签名 = 原生值（改前：unknown）"	"回归（CLI 面）：`nudo check` 检出 ESM import 环就**丢弃整张依赖图** ⇒ 环内文件的 import 全部落空 ⇒ 环内函数在 check 面恒为 `unknown` （原生是确定值）。 改前：`probe() => unknown`；"	没测该层	keep	keep	—
"求值有界：无限递归的环被截断成 nudo:recursion-truncated（不挂死）"	"回归（CLI 面）：`nudo check` 检出 ESM import 环就**丢弃整张依赖图** ⇒ 环内文件的 import 全部落空 ⇒ 环内函数在 check 面恒为 `unknown` （原生是确定值）。 改前：`probe() => unknown`；"	没测该层	keep	keep	—
"负控制：非环的跨模块调用不受影响（21 * 2 = 42）"	"回归（CLI 面）：`nudo check` 检出 ESM import 环就**丢弃整张依赖图** ⇒ 环内文件的 import 全部落空 ⇒ 环内函数在 check 面恒为 `unknown` （原生是确定值）。 改前：`probe() => unknown`；"	没测该层	keep	keep	—
"contract-entry-only 不再被丢弃（info，不挡门禁）"	"现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f"	没测该层	keep	keep	—
"负控制：contract-domain-exceeds 的既有映射不变（error → error）"	"现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f"	没测该层	keep	keep	—
"负控制：白名单外的码仍被过滤（不放大诊断面）"	"现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f"	没测该层	keep	keep	—
"check --from 打印 nudo:contract-entry-only（改前 infos: 0 / 静默丢弃）"	"现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f"	没测该层	keep	keep	—
"check --json：summary.infos 计入 entry-only，ok 仍为 true"	"现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f"	没测该层	keep	keep	—
"解析失败 → 明确报错 + exit 1（改前：静默 0 记录 + exit 0 假绿）"	"好现场文件：可解析可求值，但没有调用"	没测该层	keep	keep	—
"--json 面：pathErrors 收录该失败 + exit 1"	"好现场文件：可解析可求值，但没有调用"	没测该层	keep	keep	—
"负控制：现场文件可读但没有调用 → 不报错、exit 0"	"好现场文件：可解析可求值，但没有调用"	没测该层	keep	keep	—
"负控制：现场文件有调用 → 记录被采集（call@ 而非 entry@）、exit 0"	"好现场文件：可解析可求值，但没有调用"	没测该层	keep	keep	—
"contract 正常出结果（改前：裸 Do not know how to serialize a BigInt，exit 1）"	"bigint 保 `n` 后缀（）：`lit(10)` 与 `lit(10n)` 必须可区分， 否则「expected:」陈述的是另一条契约。 本用例的诉求是「不崩」。 `nudo contract` 遇 **bigint 字面量契约** 不得整条命令崩溃。 本测试钉住产品面：同一份文件，`nudo contract` 与 `nudo check` 都必须 正常出结果（不再裸异常崩溃）。"	夹具漏形态	keep	keep	—
"同一份文件：check 面与 contract 面都不崩（跨 verb 一致）"	"`nudo contract` 遇 **bigint 字面量契约** 不得整条命令崩溃。 本测试钉住产品面：同一份文件，`nudo contract` 与 `nudo check` 都必须 正常出结果（不再裸异常崩溃）。"	夹具漏形态	keep	keep	—
"contract 印的形参 = 声明形参；契约里绑不上的参数另列并标注"	"契约参数不顶替形参名 但必须显式出现（另列一栏 + 标注） 本测试钉住产品面：同一份文件，`nudo contract` 印的形参表必须与 `nudo check` 的签名面一致（同一来源 = 声明形参表）； 契约里绑不上的参数 另列一栏并显式标注（不顶替形参名）。"	没测该层	keep	keep	—
"方向 a：@nudo:mock 内联 —— 两条命令同绿（改前 check 绿 / --fix 红）"	"--fix 面与 plain check 必须一致）"	没测该层	keep	keep	—
"方向 b：autoBind:false —— 两条命令同红（改前 check 红 / --fix 绿）"	"--fix 面与 plain check 必须一致）"	没测该层	keep	keep	—
"方向 c：@nudo:mock from 缺文件 —— 两条命令的 error 条数一致"	"--fix 面与 plain check 必须一致）"	没测该层	keep	keep	—
"方向 d：--profile adoption —— --fix 不得为 warning 级诊断替用户写契约"	"--fix 面与 plain check 必须一致）"	没测该层	keep	keep	—
"① --from 现场文件（调用点在函数体内）⇒ 被调方门禁红（exit 1 + 恰一条跨文件域超限）"	"跨文件面用跨文件面的码（同文件通道的码不得出现在被调方报告里） - `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"② --json 面同判：ok:false + summary.errors=1 + issues 恰一条"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"③ 违例归因到被调方的导出名（fn=f / actual=-1），不是现场文件的本地名"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"④ --from <目录> ⇒ 同判（现场文件集合按目录展开）"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"⑤ 控制组：直接 check 调用方 ⇒ 仍 1 条 nudo:constraint-violated（跨文件面不污染同文件面）"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"⑥ 控制组：不带 --from ⇒ 被调方绿（不凭空造证据）"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"⑦ 不重复报告：顶层调用点（执行态 + 静态两通道同时命中）⇒ 恰一条"	"- `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录 ⇒ 只有静态通道能看见它。"	没测该层	keep	keep	—
"静态扫描：函数体内的调用点被判为被调方的调用点违例"	"归因到**被调方**的导出名（不是现场文件的本地名） - `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。"	没测该层	keep	keep	—
"runCheck 接线：带 --from 现场文件 ⇒ 被调方报告含 error 级调用点违例"	"- `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。"	没测该层	keep	keep	—
"控制组：不带 --from 现场文件 ⇒ 被调方报告不含该违例（不凭空造证据）"	"- `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。"	没测该层	keep	keep	—
"去重：执行态通道已报过的同一处事实不被静态通道重复上报"	"- `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。"	没测该层	keep	keep	—
```
