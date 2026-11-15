# packages/vite-plugin/src/__tests__/vite-plugin-faces.test.ts

模块套件：82 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"汇总行走 ctx.info（vite logger），不再走裸 console.log"	"⚠ `mockRestore()` 会**清空** `mock.calls` ⇒ 必须在 restore 之前取。 汇总行**不得**再从 console.log 逃逸（否则 logLevel: \"silent\" 挡不住） vite-plugin 的 `buildEnd` 汇总行走 `console.log` ⇒ **绕过 Vite 的 `build.logLevel`** ⇒ 用户设了 `logLevel: \"silent\"` 仍然**只**剩下 `[nudo] Analysis complete: N erro"	没测该层	keep	keep	—
"宿主没有 info 通道时降级到 ctx.warn（仍不逃逸到 console.log）"	"vite-plugin 的 `buildEnd` 汇总行走 `console.log` ⇒ **绕过 Vite 的 `build.logLevel`** ⇒ 用户设了 `logLevel: \"silent\"` 仍然**只**剩下 `[nudo] Analysis complete: N error(s)` 一行，而那 N 条**诊断一条都没被打印** ⇒ 静默失效 + 汇总与日志互相矛盾。 根因：插件的输出**分了两条通道** —— 逐条诊断走 Vite 的 `this.warn` （受 logLevel 管辖），"	没测该层	keep	keep	—
"exclude: [\"other/**\"] ⇒ other/b.js 被排除（改前仍被分析并报错）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"include: [\"src/**\"] ⇒ src/a.js 照常分析（改前整份分析被静默归零）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"include: [\"src/**\"] ⇒ other/b.js 不在白名单 ⇒ 不分析"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"绝对路径口径仍然有效（**/other/** 照常排除）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"与项目配置面同口径：插件选项与 nudo.analysis.exclude 判定一致"	"同名同语法 ⇒ 两个面的判定必须一致（都排除）。 \\\"] ⇒ other/b.js 被排除（改前仍被分析并报错）\", async () => { const { dir, otherId } = fixture(\"exclude\"); it(\"include: [\\\"src/**\\\"] ⇒ src/a.js 照常分析（改前整份分析被静默归零）\", async () => { const { dir, srcId } = fixture(\"include\");"	夹具漏形态	keep	keep	—
"软链依赖的 realpath id ⇒ 零诊断（改前报 entry-may-throw）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"软链依赖的 node_modules 路径 id ⇒ 零诊断"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"物理目录依赖 ⇒ 零诊断（与软链形态一致）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"对照组：项目源码照常分析（排除没有过宽）"	"HEAD 版没有该钩子 ⇒ 跳过。"	没测该层	keep	keep	—
"软链 root + 软链形态 id ⇒ 分析（改前 skip:exclude）"	"夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"软链 root + realpath 形态 id ⇒ 分析"	"夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"对照组：非软链 root ⇒ 分析（行为不变）"	"夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"工程根之外的文件仍被排除（排除规则没有被放宽）"	"夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"插件层：软链 root 下的源文件照常出诊断（不再静默空转）"	"夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"同进程两个插件实例 ⇒ 各自的 root 互不覆盖（模块级全局状态不再串味）"	"第二个实例的 configResolved 会覆盖模块级 root（改前的行为） 夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根 （Vite 的 `config.root` 形态：只 resolve，不解析软链）。"	夹具漏形态	keep	keep	—
"无 `line` 的 check issue ⇒ range 用占位 0（不是编造的 1）"	"依赖模块**存在但不可解析** ⇒ core 产出 `nudo:opaque-result`（**不带 `line`** 的 check issue；"	没测该层	keep	keep	—
"插件层：无位置的 check issue 渲染为「无位置」（不含 :1:0 / :0:0）"	"无源位置 ⇒ 整段位置省略（既不写编造的 :1:0，也不写越界的 :0:0） 依赖模块**存在但不可解析** ⇒ core 产出 `nudo:opaque-result`（**不带 `line`** 的 check issue；"	没测该层	keep	keep	—
"有真位置的 check issue 仍渲染 :line:col（不回归）"	"依赖模块**存在但不可解析** ⇒ core 产出 `nudo:opaque-result`（**不带 `line`** 的 check issue；"	没测该层	keep	keep	—
"负控制：忽略的是**别的** throw 类 ⇒ TypeError 仍照报（门禁未被关掉）"	"四种**文档认可**的写法（CLI / LSP 都生效）—— 插件面必须逐项相同。 断言：该 throw 类被忽略 ⇒ 无 `nudo:entry-may-throw`，且构建不中断。"	没测该层	keep	keep	—
"harvest 专有导出可解析 ⇒ 不再误报 nudo:unknown-inference（与 CLI 同结论）"	"`@nudo:env node` ⇒ env 模块表里有 `util`（Node 内建）——同名冲突的来源。"	夹具漏形态	keep	keep	—
"负控制：env 与 harvest 都没有的导出仍报 nudo:unknown-inference"	"`@nudo:env node` ⇒ env 模块表里有 `util`（Node 内建）——同名冲突的来源。"	夹具漏形态	keep	keep	—
"无文件级 @nudo:env ⇒ 不报 ReferenceError（基线，一直是对的）"	"`projectEnv` 省略 ⇒ 项目**不**声明任何 env。"	没测该层	keep	keep	—
"加一行**无关**的文件级 @nudo:env ⇒ 结论不变（不再绿翻红）"	"`projectEnv` 省略 ⇒ 项目**不**声明任何 env。"	没测该层	keep	keep	—
"两个场景的诊断集合逐项相同（单调）"	"`projectEnv` 省略 ⇒ 项目**不**声明任何 env。"	没测该层	keep	keep	—
"负控制：项目未声明该 env ⇒ MAGIC 仍报 ReferenceError（门禁未被关掉）"	"`projectEnv` 省略 ⇒ 项目**不**声明任何 env。"	没测该层	keep	keep	—
"项目级 env 缺失 ⇒ 构建期 warning 指名项目根下的路径"	"解析基准 = **项目根**（不是文件目录）：路径必须是 <projectRoot>/missing-env.ts 回归（vite-plugin 构建期）：**项目级** env （`package.json#nudo.env`）装载失败必须可见（`nudo:env-unresolved`）， 与 CLI / LSP 同口径。 病灶：`envUnresolvedDiagnostics` 只按**文件目录**取失败表 （`getPathEnvLoadErrors(dirname(id))`），而项目级 env 的失败"	没测该层	keep	keep	—
"同一语义的**文件级**写法同样报（两种写法结论一致）"	"回归（vite-plugin 构建期）：**项目级** env （`package.json#nudo.env`）装载失败必须可见（`nudo:env-unresolved`）， 与 CLI / LSP 同口径。 病灶：`envUnresolvedDiagnostics` 只按**文件目录**取失败表 （`getPathEnvLoadErrors(dirname(id))`），而项目级 env 的失败条目被记在 **项目根**名下（`analyzer-orchestrate.ts` 的 `preloadAnalys"	没测该层	keep	keep	—
"负控制：项目 env 正常 ⇒ 不报 nudo:env-unresolved"	"回归（vite-plugin 构建期）：**项目级** env （`package.json#nudo.env`）装载失败必须可见（`nudo:env-unresolved`）， 与 CLI / LSP 同口径。 病灶：`envUnresolvedDiagnostics` 只按**文件目录**取失败表 （`getPathEnvLoadErrors(dirname(id))`），而项目级 env 的失败条目被记在 **项目根**名下（`analyzer-orchestrate.ts` 的 `preloadAnalys"	没测该层	keep	keep	—
"未知 env 名 ⇒ 构建期 warning（nudo:env-unresolved）"	"未知 env 名（词字符形态——指令文法只收 `\\w+` 或 path 形态）"	夹具漏形态	keep	keep	—
"负控制：同目录别的文件的无 path 诊断不误吸"	"先分析声明了另一个未知名 env 的文件（失败进进程级错误表） 未知 env 名（词字符形态——指令文法只收 `\\w+` 或 path 形态）"	夹具漏形态	keep	keep	—
"@nudo:env 指向缺失文件 → 构建期 warning（nudo:env-unresolved）"	"vite-plugin **从不读** path-env 加载失败通道 ⇒ `@nudo:env ./missing.js` 加载失败零诊断（env 静默不生效：该 env 提供的全局退化成 unknown / 宿主真身， 构建日志里没有任何一行提示）。 负控制：未声明该 env 的文件不得被同目录的失败误伤；"	没测该层	keep	keep	—
"负控制：同目录未声明该 env 的文件不得被误伤"	"先分析声明了坏 env 的文件（失败进进程级错误表） vite-plugin **从不读** path-env 加载失败通道 ⇒ `@nudo:env ./missing.js` 加载失败零诊断（env 静默不生效：该 env 提供的全局退化成 unknown / 宿主真身， 构建日志里没有任何一行提示）。 负控制：未声明该 env 的文件不得被同目录的失败误伤；"	没测该层	keep	keep	—
"负控制：无 @nudo:env 的文件不产生 env 告警"	"vite-plugin **从不读** path-env 加载失败通道 ⇒ `@nudo:env ./missing.js` 加载失败零诊断（env 静默不生效：该 env 提供的全局退化成 unknown / 宿主真身， 构建日志里没有任何一行提示）。 负控制：未声明该 env 的文件不得被同目录的失败误伤；"	没测该层	keep	keep	—
"@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）"	"无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛"	没测该层	keep	keep	—
"负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）"	"无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛"	没测该层	keep	keep	—
"verbose 档：nudo:assume-relied 走 info 通道上屏（不混进 warn 流）"	"（vite 半）—— vite-plugin 把 **info 级 check 诊断丢在噪声档过滤 之前** ⇒ `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result` **永不上屏**，且 `nudo.analysis.diagnostics: \"verbose\"` 对 check 诊断 **完全是空操作**。 根因：`checkIssuesToDiagnostics` 在转成 vite Diagnostic **之前**就 `f"	没测该层	keep	keep	—
"默认档：info 不上屏（档位取舍仍归 filterDiagnosticsByLevel）"	"（vite 半）—— vite-plugin 把 **info 级 check 诊断丢在噪声档过滤 之前** ⇒ `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result` **永不上屏**，且 `nudo.analysis.diagnostics: \"verbose\"` 对 check 诊断 **完全是空操作**。 根因：`checkIssuesToDiagnostics` 在转成 vite Diagnostic **之前**就 `f"	没测该层	keep	keep	—
"插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）"	"收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"直接驱动 transform：原始 TS 源码里的 @nudo:throws 可见 ⇒ 不报 CLI 不会报的 entry-may-throw"	"指令可见 ⇒ 抛错已声明 ⇒ 无 entry-may-throw（与 `nudo check` 判同：OK） 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"对照组：同一份源码剥掉注释（= esbuild 产物）⇒ 报 entry-may-throw（差异来自插件排序）"	"指令不可见 ⇒ 声明缺失 ⇒ 门禁报 error（这正是 895 的**假红**面） 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"真 vite build：.ts 源里的 @nudo:throws 可见 ⇒ 构建成功、零 [nudo] 诊断（不假红）"	"failOnError: true ⇒ 假红会直接红构建（CLI 判 OK ⇒ 插件也必须判 OK） 构建**不得**失败（`nudo check` 对同一份文件判 OK） 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"真 vite build：TS 特有语法（enum / namespace / as const / satisfies / 抽象类）⇒ 构建成功、零 [nudo] 诊断"	"同一份文件 `nudo check` 判 **OK**（0 error）⇒ 插件也必须判 OK TS 源码必须被分析面吃下（解析失败 ⇒ \"Failed to analyze\"）， 且**不得**红构建 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"真 vite build：分析面解析不了的 TS 语法（装饰器）⇒ 降级为 warn，构建不炸（902 守卫兜底）"	"**绝不**红构建 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"\\0 前缀虚拟 id + 干净源码 + failOnError: true ⇒ 不抛、零诊断"	"干净源码（无指令、无入口面 ⇒ 控制组必须零诊断）。"	没测该层	keep	keep	—
"\\0 前缀虚拟 id + 干净源码 + 默认档 ⇒ 零诊断（改前是 1 条 error 级）"	"干净源码（无指令、无入口面 ⇒ 控制组必须零诊断）。"	没测该层	keep	keep	—
"virtual: 前缀虚拟 id（无 NUL）同样被跳过"	"干净源码（无指令、无入口面 ⇒ 控制组必须零诊断）。"	没测该层	keep	keep	—
"对照组：同源码的普通文件 id 依旧零诊断（跳过不是「全都不分析」）"	"干净源码（无指令、无入口面 ⇒ 控制组必须零诊断）。"	没测该层	keep	keep	—
"entryThrows=warning ⇒ 报 warning 而不是 error（与 CLI 同口径）"	"档位是 warning ⇒ 不得走 this.error（否则 failOnError 会中断构建） 会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"entryThrows=warning + failOnError=true ⇒ 构建不中断（不再抛）"	"会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"ignoreThrows=[TypeError] ⇒ 该 throw 类不再报 nudo:entry-may-throw"	"会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"entryThrows=off ⇒ L2 门禁诊断整段缺席"	"会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"负控制：没有 nudo.check 配置时仍是默认最严档（error）—— 门禁未被整体关掉"	"会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"profile=adoption 预设 ⇒ 落到 warning 档（与 CLI / LSP 的预设解析同口径）"	"会真抛的入口（读未约束全局 ⇒ L2 may-throw）。"	没测该层	keep	keep	—
"跨模块调用可证时不得报 nudo:unproven-return / unknown #opaque（与 CLI 同口径：绿）"	"回归（vite-plugin 构建期）：check 面必须把 **Abs 模块图** （`modules`）传给 `checkSource` —— 与 CLI / LSP 同口径。 病灶（勘察基线 `7af5520c`）：插件调 `checkSource` 时**不传** `modules` ⇒ 跨模块被调函数的类型在 check 通道里缺席 ⇒ 返回值塌成 `unknown #opaque` ⇒ **可证**的返回契约被报成 `nudo:unproven-return` （**假红**：同一份文件 `nudo c"	没测该层	keep	keep	—
"负控制：真违约仍必须报 nudo:constraint-violated（模块图到位 ≠ 门禁被关掉）"	"回归（vite-plugin 构建期）：check 面必须把 **Abs 模块图** （`modules`）传给 `checkSource` —— 与 CLI / LSP 同口径。 病灶（勘察基线 `7af5520c`）：插件调 `checkSource` 时**不传** `modules` ⇒ 跨模块被调函数的类型在 check 通道里缺席 ⇒ 返回值塌成 `unknown #opaque` ⇒ **可证**的返回契约被报成 `nudo:unproven-return` （**假红**：同一份文件 `nudo c"	没测该层	keep	keep	—
"off 档 + failOnError: true ⇒ 仍然抛（构建红，不再 CI 假绿）"	"L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"off 档 + failOnError: false ⇒ 门禁诊断仍然可见（不被抹掉）"	"L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"非 off 档（默认档）口径不变：门禁诊断照旧上报"	"L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）"	"收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"真 vite build：.ts 源里的 @nudo:contract / @nudo:case 可见 ⇒ 门禁不再静默放绿"	"failOnError: false ⇒ 门禁 error 走 warn 通道（构建不失败，但**必须看得见**） 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"真 vite build：failOnError: true 时 .ts 源的契约违例红构建（与 .js 源同判）"	"收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"同一份契约的 .ts 源与 .js 源判同（诊断集合一致；行号随源码坐标系）"	"诊断**集合**必须一致（此前 `.ts` 源零诊断 ⇒ 静默放绿） 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"直接驱动 transform：.ts 源码（含类型注解）过分析面 ⇒ 报出与 CLI 同码的诊断"	"收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。"	没测该层	keep	keep	—
"info 级诊断走 vite 的 info 通道上屏，且不混进 warn 流"	"info 级诊断**一条都不许**出现在 warn 流（否则 info 冒充告警）。 info 级诊断也不许走 error 通道。 诊断消息的 severity（由诊断文本格式的唯一出口解析，不靠消息正文）。"	没测该层	keep	keep	—
"buildEnd 汇总行的 warning 计数只算 warning 级诊断（info 不计入）"	"前置：本夹具确实产出了 info 级诊断（否则「info 不计入」无从谈起）。 汇总**不是**把全部诊断都算成 warning（否则 info 会被计入）。 诊断消息的 severity（由诊断文本格式的唯一出口解析，不靠消息正文）。"	夹具漏形态	keep	keep	—
"汇总行与构建日志自洽：被计入的诊断都真的上屏过（info 不再凭空消失）"	"被计入汇总的诊断条数不得超过实际上屏的诊断条数（不得「凭空多报」）。 诊断消息的 severity（由诊断文本格式的唯一出口解析，不靠消息正文）。"	没测该层	keep	keep	—
"failOnError: true + code=null ⇒ 仍然不抛（畸形入参不得中断构建）"	"`transform()` 对 `code = null` **抛未捕获异常**（异常在 `try` 之外， 插件自己的兜底 `catch` 接不到）。 根因：`shouldAnalyzeFile` 的守卫是 `text !== undefined`（**漏掉 `null`**）⇒ `hasNudoDirectives(null)` ⇒ `stripStringsKeepComments(null)` 访问 `.length` ⇒ node 措辞 `Cannot read properties of null (r"	没测该层	keep	keep	—
"对照组：正常源码仍然照常分析（守卫没被整体短路）"	"`transform()` 对 `code = null` **抛未捕获异常**（异常在 `try` 之外， 插件自己的兜底 `catch` 接不到）。 根因：`shouldAnalyzeFile` 的守卫是 `text !== undefined`（**漏掉 `null`**）⇒ `hasNudoDirectives(null)` ⇒ `stripStringsKeepComments(null)` 访问 `.length` ⇒ node 措辞 `Cannot read properties of null (r"	没测该层	keep	keep	—
"带 ?t=<ts> 的 id 与不带 query 的 id 产出同样的诊断"	"改前：带 query 的 id 一条诊断都没有（整份被跳过 ⇒ dev 期假绿）。 L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"带 ?v=<hash> 的 id 同样不被跳过"	"L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"自定义 include 模式也按剥 query 后的路径匹配"	"L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。"	没测该层	keep	keep	—
"两条 error ⇒ 首条 this.error 抛出 + 其余逐条 this.warn（不静默丢弃）"	"首条走 this.error（抛） 其余 error 逐条 warn —— 此前**一条都没有**（904 的核心症状） `failOnError: true` 只报**第一条** error，其余 error 级诊断被 **静默丢弃** ⇒ 构建摘要说「2 error(s)」而报错里只有 1 条。 根因：`fatal` 是**单个字符串**、`??` 短路只留首条 ⇒ 第二条 error 诊断在 构建日志里**一条都没出现**（用户无从定位；"	夹具漏形态	keep	keep	—
"摘要计数与实际上报条数一致（2 error(s) ⇒ 1 抛 + 1 warn）"	"`failOnError: true` 只报**第一条** error，其余 error 级诊断被 **静默丢弃** ⇒ 构建摘要说「2 error(s)」而报错里只有 1 条。 根因：`fatal` 是**单个字符串**、`??` 短路只留首条 ⇒ 第二条 error 诊断在 构建日志里**一条都没出现**（用户无从定位；"	夹具漏形态	keep	keep	—
"failOnError: false（默认档）口径不变：每条 error 降 warn"	"`failOnError: true` 只报**第一条** error，其余 error 级诊断被 **静默丢弃** ⇒ 构建摘要说「2 error(s)」而报错里只有 1 条。 根因：`fatal` 是**单个字符串**、`??` 短路只留首条 ⇒ 第二条 error 诊断在 构建日志里**一条都没出现**（用户无从定位；"	夹具漏形态	keep	keep	—
"占位 range（line 0）⇒ 省略 :line:col，且不出现越界行号"	"越界位置（行号 0）不得出现 编造的第 1 行也不得出现（无位置 ⇒ 整段位置省略） 无位置 ⇒ `[nudo] <id> <severity>: <message>`（位置整段省略） mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`， 其 range 是上游的**占位** `{line: 0, column: 0}` ⇒ 插件此前渲染成 `:0:0`。"	没测该层	keep	keep	—
"真位置仍照旧渲染 :line:col（不回归）"	"mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`， 其 range 是上游的**占位** `{line: 0, column: 0}` ⇒ 插件此前渲染成 `:0:0`。"	没测该层	keep	keep	—
"真违例必须是 nudo:constraint-violated 且为 error 级（不是 warning 级 unproven-return）"	"error 级诊断的上屏文本必须自带 \"error:\"（severity 三档原样带出） 回归（vite-plugin 构建期）：**同 898 的反方向面** —— 跨模块 返回契约**真违例**时，插件必须给出 **error** 级的 `nudo:constraint-violated`，而不是被降级成 **warning** 级的 `nudo:unproven-return`。 危害（假绿）：「证不出来」时插件只能给弱断言（warning）⇒ `failOnError: true` 也放行 ⇒ **门禁失效"	没测该层	keep	keep	—
"failOnError=true ⇒ 真违例必须中断构建（this.error 被调用并抛出）"	"回归（vite-plugin 构建期）：**同 898 的反方向面** —— 跨模块 返回契约**真违例**时，插件必须给出 **error** 级的 `nudo:constraint-violated`，而不是被降级成 **warning** 级的 `nudo:unproven-return`。 危害（假绿）：「证不出来」时插件只能给弱断言（warning）⇒ `failOnError: true` 也放行 ⇒ **门禁失效**（CI 假绿）。"	没测该层	keep	keep	—
"evaluator 面诊断也带 (nudo:code)（此前恒丢）"	"mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`（码在 `diag.code` 字段里，此前插件**从不读** ⇒ 码恒丢）；"	没测该层	keep	keep	—
"同一次构建里两类诊断同款结尾（ · (code) 分隔符归一）且码不重复"	"码与消息之间只有一个空格（不带 ` · ` 分隔） mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`（码在 `diag.code` 字段里，此前插件**从不读** ⇒ 码恒丢）；"	没测该层	keep	keep	—
```
