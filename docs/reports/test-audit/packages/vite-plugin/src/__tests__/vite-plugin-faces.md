# packages/vite-plugin/src/__tests__/vite-plugin-faces.test.ts

模块套件：vite 插件面（诊断/level/harvest/env/symlink/query/virtual）。

审计：82 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
汇总行走 ctx.info（vite logger），不再走裸 console.log；宿主没有 info 通道时降级到 ctx.warn（仍不逃逸到 console.log）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
exclude: ["other/**"] ⇒ other/b.js 被排除（改前仍被分析并报错）；include: ["src/**"] ⇒ src/a.js 照常分析（改前整份分析被静默归零）；include: ["src/**"] ⇒ other/b.js 不在白名单 ⇒ 不分析；绝对路径口径仍然有效（**/other/** 照常排除）；与项目配置面同口径：插件选项与 nudo.analysis.exclude 判定一致	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
软链依赖的 realpath id ⇒ 零诊断（改前报 entry-may-throw）；软链依赖的 node_modules 路径 id ⇒ 零诊断；物理目录依赖 ⇒ 零诊断（与软链形态一致）；对照组：项目源码照常分析（排除没有过宽）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
软链 root + 软链形态 id ⇒ 分析（改前 skip:exclude）；软链 root + realpath 形态 id ⇒ 分析；对照组：非软链 root ⇒ 分析（行为不变）；工程根之外的文件仍被排除（排除规则没有被放宽）；插件层：软链 root 下的源文件照常出诊断（不再静默空转）；同进程两个插件实例 ⇒ 各自的 root 互不覆盖（模块级全局状态不再串味）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
无 `line` 的 check issue ⇒ range 用占位 0（不是编造的 1）；插件层：无位置的 check issue 渲染为「无位置」（不含 :1:0 / :0:0）；有真位置的 check issue 仍渲染 :line:col（不回归）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
"负控制：忽略的是**别的** throw 类 ⇒ TypeError 仍照报（门禁未被关掉）"	"四种**文档认可**的写法（CLI / LSP 都生效）—— 插件面必须逐项相同。 断言：该 throw 类被忽略 ⇒ 无 `nudo:entry-may-throw`，且构建不中断。 断言：expect(r.all).toContain(\"nudo:entry-may-throw\");；expect(r.errors.join(\"\\n\")).toContain(\"nudo:entry-may-throw\");"	没测该层	keep	keep	—
harvest 专有导出可解析 ⇒ 不再误报 nudo:unknown-inference（与 CLI 同结论）；负控制：env 与 harvest 都没有的导出仍报 nudo:unknown-inference	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
无文件级 @nudo:env ⇒ 不报 ReferenceError（基线，一直是对的）；加一行**无关**的文件级 @nudo:env ⇒ 结论不变（不再绿翻红）；两个场景的诊断集合逐项相同（单调）；负控制：项目未声明该 env ⇒ MAGIC 仍报 ReferenceError（门禁未被关掉）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
项目级 env 缺失 ⇒ 构建期 warning 指名项目根下的路径；同一语义的**文件级**写法同样报（两种写法结论一致）；负控制：项目 env 正常 ⇒ 不报 nudo:env-unresolved	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
未知 env 名 ⇒ 构建期 warning（nudo:env-unresolved）；负控制：同目录别的文件的无 path 诊断不误吸	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
@nudo:env 指向缺失文件 → 构建期 warning（nudo:env-unresolved）；负控制：同目录未声明该 env 的文件不得被误伤；负控制：无 @nudo:env 的文件不产生 env 告警	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）；负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
verbose 档：nudo:assume-relied 走 info 通道上屏（不混进 warn 流）；默认档：info 不上屏（档位取舍仍归 filterDiagnosticsByLevel）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）；直接驱动 transform：原始 TS 源码里的 @nudo:throws 可见 ⇒ 不报 CLI 不会报的 entry-may-throw；对照组：同一份源码剥掉注释（= esbuild 产物）⇒ 报 entry-may-throw（差异来自插件排序）；真 vite build：.ts 源里的 @nudo:throws 可见 ⇒ 构建成功、零 [nudo] 诊断（	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
\0 前缀虚拟 id + 干净源码 + failOnError: true ⇒ 不抛、零诊断；\0 前缀虚拟 id + 干净源码 + 默认档 ⇒ 零诊断（改前是 1 条 error 级）；virtual: 前缀虚拟 id（无 NUL）同样被跳过；对照组：同源码的普通文件 id 依旧零诊断（跳过不是「全都不分析」）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
entryThrows=warning ⇒ 报 warning 而不是 error（与 CLI 同口径）；entryThrows=warning + failOnError=true ⇒ 构建不中断（不再抛）；ignoreThrows=[TypeError] ⇒ 该 throw 类不再报 nudo:entry-may-throw；entryThrows=off ⇒ L2 门禁诊断整段缺席；负控制：没有 nudo.check 配置时仍是默认最严档（error）—— 门禁未被整体	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
跨模块调用可证时不得报 nudo:unproven-return / unknown #opaque（与 CLI 同口径：绿）；负控制：真违约仍必须报 nudo:constraint-violated（模块图到位 ≠ 门禁被关掉）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
off 档 + failOnError: true ⇒ 仍然抛（构建红，不再 CI 假绿）；off 档 + failOnError: false ⇒ 门禁诊断仍然可见（不被抹掉）；非 off 档（默认档）口径不变：门禁诊断照旧上报	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
真 vite build：.ts 源里的 @nudo:contract / @nudo:case 可见 ⇒ 门禁不再静默放绿；真 vite build：failOnError: true 时 .ts 源的契约违例红构建（与 .js 源同判）；同一份契约的 .ts 源与 .js 源判同（诊断集合一致；行号随源码坐标系）；直接驱动 transform：.ts 源码（含类型注解）过分析面 ⇒ 报出与 CLI 同码的诊断	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
info 级诊断走 vite 的 info 通道上屏，且不混进 warn 流；buildEnd 汇总行的 warning 计数只算 warning 级诊断（info 不计入）；汇总行与构建日志自洽：被计入的诊断都真的上屏过（info 不再凭空消失）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
failOnError: true + code=null ⇒ 仍然不抛（畸形入参不得中断构建）；对照组：正常源码仍然照常分析（守卫没被整体短路）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
带 ?t=<ts> 的 id 与不带 query 的 id 产出同样的诊断；带 ?v=<hash> 的 id 同样不被跳过；自定义 include 模式也按剥 query 后的路径匹配	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
两条 error ⇒ 首条 this.error 抛出 + 其余逐条 this.warn（不静默丢弃）；摘要计数与实际上报条数一致（2 error(s) ⇒ 1 抛 + 1 warn）；failOnError: false（默认档）口径不变：每条 error 降 warn	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
占位 range（line 0）⇒ 省略 :line:col，且不出现越界行号；真位置仍照旧渲染 :line:col（不回归）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
真违例必须是 nudo:constraint-violated 且为 error 级（不是 warning 级 unproven-return）；failOnError=true ⇒ 真违例必须中断构建（this.error 被调用并抛出）	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
evaluator 面诊断也带 (nudo:code)（此前恒丢）；同一次构建里两类诊断同款结尾（ · (code) 分隔符归一）且码不重复	vite-plugin-faces 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）	dup:插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）（同文件两处逐字同体，保留首份）	commit:e73bbdb8
汇总行走 ctx.info（vite logger），不再走裸 console.log	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
宿主没有 info 通道时降级到 ctx.warn（仍不逃逸到 console.log）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
exclude: ["other/**"] ⇒ other/b.js 被排除（改前仍被分析并报错）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
include: ["src/**"] ⇒ src/a.js 照常分析（改前整份分析被静默归零）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
include: ["src/**"] ⇒ other/b.js 不在白名单 ⇒ 不分析	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
绝对路径口径仍然有效（**/other/** 照常排除）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
与项目配置面同口径：插件选项与 nudo.analysis.exclude 判定一致	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
软链依赖的 realpath id ⇒ 零诊断（改前报 entry-may-throw）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
软链依赖的 node_modules 路径 id ⇒ 零诊断	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
物理目录依赖 ⇒ 零诊断（与软链形态一致）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
对照组：项目源码照常分析（排除没有过宽）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
软链 root + 软链形态 id ⇒ 分析（改前 skip:exclude）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
软链 root + realpath 形态 id ⇒ 分析	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
对照组：非软链 root ⇒ 分析（行为不变）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
工程根之外的文件仍被排除（排除规则没有被放宽）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
插件层：软链 root 下的源文件照常出诊断（不再静默空转）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
同进程两个插件实例 ⇒ 各自的 root 互不覆盖（模块级全局状态不再串味）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
无 `line` 的 check issue ⇒ range 用占位 0（不是编造的 1）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
插件层：无位置的 check issue 渲染为「无位置」（不含 :1:0 / :0:0）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
有真位置的 check issue 仍渲染 :line:col（不回归）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
harvest 专有导出可解析 ⇒ 不再误报 nudo:unknown-inference（与 CLI 同结论）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：env 与 harvest 都没有的导出仍报 nudo:unknown-inference	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
无文件级 @nudo:env ⇒ 不报 ReferenceError（基线，一直是对的）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
加一行**无关**的文件级 @nudo:env ⇒ 结论不变（不再绿翻红）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
两个场景的诊断集合逐项相同（单调）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：项目未声明该 env ⇒ MAGIC 仍报 ReferenceError（门禁未被关掉）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
项目级 env 缺失 ⇒ 构建期 warning 指名项目根下的路径	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
同一语义的**文件级**写法同样报（两种写法结论一致）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：项目 env 正常 ⇒ 不报 nudo:env-unresolved	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
未知 env 名 ⇒ 构建期 warning（nudo:env-unresolved）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：同目录别的文件的无 path 诊断不误吸	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
@nudo:env 指向缺失文件 → 构建期 warning（nudo:env-unresolved）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：同目录未声明该 env 的文件不得被误伤	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：无 @nudo:env 的文件不产生 env 告警	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
verbose 档：nudo:assume-relied 走 info 通道上屏（不混进 warn 流）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
默认档：info 不上屏（档位取舍仍归 filterDiagnosticsByLevel）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
直接驱动 transform：原始 TS 源码里的 @nudo:throws 可见 ⇒ 不报 CLI 不会报的 entry-may-throw	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
对照组：同一份源码剥掉注释（= esbuild 产物）⇒ 报 entry-may-throw（差异来自插件排序）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真 vite build：.ts 源里的 @nudo:throws 可见 ⇒ 构建成功、零 [nudo] 诊断（不假红）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真 vite build：TS 特有语法（enum / namespace / as const / satisfies / 抽象类）⇒ 构建成功、零 [nudo] 诊断	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真 vite build：分析面解析不了的 TS 语法（装饰器）⇒ 降级为 warn，构建不炸（902 守卫兜底）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
\0 前缀虚拟 id + 干净源码 + failOnError: true ⇒ 不抛、零诊断	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
\0 前缀虚拟 id + 干净源码 + 默认档 ⇒ 零诊断（改前是 1 条 error 级）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
virtual: 前缀虚拟 id（无 NUL）同样被跳过	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
对照组：同源码的普通文件 id 依旧零诊断（跳过不是「全都不分析」）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
entryThrows=warning ⇒ 报 warning 而不是 error（与 CLI 同口径）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
entryThrows=warning + failOnError=true ⇒ 构建不中断（不再抛）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
ignoreThrows=[TypeError] ⇒ 该 throw 类不再报 nudo:entry-may-throw	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
entryThrows=off ⇒ L2 门禁诊断整段缺席	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：没有 nudo.check 配置时仍是默认最严档（error）—— 门禁未被整体关掉	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
profile=adoption 预设 ⇒ 落到 warning 档（与 CLI / LSP 的预设解析同口径）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
跨模块调用可证时不得报 nudo:unproven-return / unknown #opaque（与 CLI 同口径：绿）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
负控制：真违约仍必须报 nudo:constraint-violated（模块图到位 ≠ 门禁被关掉）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
off 档 + failOnError: true ⇒ 仍然抛（构建红，不再 CI 假绿）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
off 档 + failOnError: false ⇒ 门禁诊断仍然可见（不被抹掉）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
非 off 档（默认档）口径不变：门禁诊断照旧上报	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真 vite build：.ts 源里的 @nudo:contract / @nudo:case 可见 ⇒ 门禁不再静默放绿	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真 vite build：failOnError: true 时 .ts 源的契约违例红构建（与 .js 源同判）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
同一份契约的 .ts 源与 .js 源判同（诊断集合一致；行号随源码坐标系）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
直接驱动 transform：.ts 源码（含类型注解）过分析面 ⇒ 报出与 CLI 同码的诊断	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
info 级诊断走 vite 的 info 通道上屏，且不混进 warn 流	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
buildEnd 汇总行的 warning 计数只算 warning 级诊断（info 不计入）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
汇总行与构建日志自洽：被计入的诊断都真的上屏过（info 不再凭空消失）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
failOnError: true + code=null ⇒ 仍然不抛（畸形入参不得中断构建）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
对照组：正常源码仍然照常分析（守卫没被整体短路）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
带 ?t=<ts> 的 id 与不带 query 的 id 产出同样的诊断	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
带 ?v=<hash> 的 id 同样不被跳过	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
自定义 include 模式也按剥 query 后的路径匹配	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
两条 error ⇒ 首条 this.error 抛出 + 其余逐条 this.warn（不静默丢弃）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
摘要计数与实际上报条数一致（2 error(s) ⇒ 1 抛 + 1 warn）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
failOnError: false（默认档）口径不变：每条 error 降 warn	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
占位 range（line 0）⇒ 省略 :line:col，且不出现越界行号	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真位置仍照旧渲染 :line:col（不回归）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
真违例必须是 nudo:constraint-violated 且为 error 级（不是 warning 级 unproven-return）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
failOnError=true ⇒ 真违例必须中断构建（this.error 被调用并抛出）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
evaluator 面诊断也带 (nudo:code)（此前恒丢）	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
同一次构建里两类诊断同款结尾（ · (code) 分隔符归一）且码不重复	dup:vite-plugin-faces 聚合矩阵	commit:8fa85177
```
