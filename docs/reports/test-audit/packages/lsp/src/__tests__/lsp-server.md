# packages/lsp/src/__tests__/lsp-server.test.ts

模块套件：LSP server 面（协议/URI/workspace/trace/会话/取消/config）。 client-capabilities 与 server-watch-err 因模块级 vi.mock 保留独立入口。

审计：73 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
畸形 workspaceFolders[0].uri ⇒ 跳过该 folder，initialize 照常返回；畸形 rootUri ⇒ 跳过该根，initialize 照常返回；正常 URI 不受影响（仍返回 capabilities）	lsp-server 聚合矩阵	没测该层	keep	keep	—
未知命令名不再回落 result:null；已声明的命令名照常执行（白名单 = advertise 面）	lsp-server 聚合矩阵	没测该层	keep	keep	—
"声明 changeNotifications + 增删根即时生效（写盘边界跟着走）"	"工作区文件夹增删不生效（`workspaceRoots` 永久冻结）。 症状：多根工作区里，客户端新增/移除一个工作区文件夹后，server 仍按 `initialize` 时的老根集合行事 ⇒ 新加入的目录被写盘边界误拒 （\"outside allowed roots\"），已移出的目录**仍被授权**。 断言：expect(res.capabilities?.workspace).toMatchObject({；expect(await emitText(join(b, \"y.js\"))).toContain(\"outside allowed roots\");"	没测该层	keep	keep	—
① 客户端不声明 workspaceFolders 能力 ⇒ createNudoServer 不抛异常；② 该客户端的 onInitialize 仍正常返回（服务端能力声明一字不动）；③ 真语义（getter 在 initialize 之后才可用）⇒ 订阅仍建立且只建立一次	lsp-server 聚合矩阵	没测该层	keep	keep	—
trace({file, functionName}) 回落到 externalFunctions：出跨模块见证；真 server executeCommand `nudo.trace [uri, fn]`（观察镜动作形态）不报 not found；同文件 call@ 对照：trace 仍按本地函数解析（不回归）	lsp-server 聚合矩阵	没测该层	keep	keep	—
位置参数 [uri, fn] 跑出 trace（不是错误）；对象形态 { uri, functionName } 仍然可用（桥不得吃掉既有形态）；非对象参数（裸字符串）⇒ 协议层 InvalidParams（不再把字符串当对象传下去）	lsp-server 聚合矩阵	没测该层	keep	keep	—
nudo/trace 的 {uri} 形态：出见证（不再 TypeError）；nudo/trace 的 {file} 形态：不回归；agent 侧：trace 工具直调也接受 uri 键；位置参数桥 tracePositionalArgs：[uri, fn] ⇒ { uri, functionName }	lsp-server 聚合矩阵	没测该层	keep	keep	—
编码侧对保留字符做百分号转义（裸 % 不再出现）；普通路径的 URI 形态不变（file:/// 绝对路径）；解码侧：合法 URI 解回原路径（与编码侧互逆）；解码侧：畸形百分号转义**绝不抛**（回退到未解码原文）；解码侧：非 file: scheme 原样返回（行为不变）；Windows 盘符形态经 cacheKey 归一（file:///c:/… ⇒ c:/…）；协议面：客户端把服务端自己刚给的（裸 % 的）URI 回传给 didOpen ⇒ 不中断且该文档有诊断	lsp-server 聚合矩阵	没测该层	keep	keep	—
会出诊断的文件：didOpen 只发布一次（同 version 同内容）；不出诊断的文件：didOpen 也只发布一次（空数组）；编辑后仍会发布新版本的诊断（去重不得把后续诊断吞掉）	lsp-server 聚合矩阵	没测该层	keep	keep	—
变更文件自己 ⇒ 不重检自己（无自激重检）；真正的 parent（@nudo:import 依赖方）仍被重检（self-排除不得误伤）	lsp-server 聚合矩阵	没测该层	keep	keep	—
declares the full capability inventory and command list；registers slash- and dot-form request aliases for every agent tool	lsp-server 聚合矩阵	没测该层	keep	keep	—
workspace/executeCommand nudo.check analyzes a source payload；slash-form nudo/check and dot-form nudo.check share one handler；nudo.getActiveCases returns the empty case map for a fresh uri	lsp-server 聚合矩阵	没测该层	keep	keep	—
unknown executeCommand raises a protocol-level MethodNotFound error；nudo.check on a missing file returns isError (fail-closed)；pull diagnostics for an unknown document are empty (no crash)；pull diagnostics catch 不得 items:[] — 标 Analysis err	lsp-server 聚合矩阵	没测该层	keep	keep	—
plain non-export JS stays quiet without client settings (exports default)；initializationOptions analysis.mode=all widens the gate；invalid initializationOptions mode falls back to the product default；project package.json#nudo.analysis.mode w	lsp-server 聚合矩阵	没测该层	keep	keep	—
默认关：无参数 where inlay（返回 inlay 仍在）；initializationOptions inlayHints.parameters=true 开启；非法宿主值回落默认关；workspace/didChangeConfiguration 实时开关；项目 package.json#nudo.inlayHints.parameters 显式值赢过宿主默认；折叠展示：侧车表达式原文 label + 完整 pred tooltip	lsp-server 聚合矩阵	没测该层	keep	keep	—
默认：契约选项 ●，全部 case ○；动作与观察层照常；selectCase 后契约转 ○、选中 case 转 ●；inlay 档投影同态；selectContract 切回契约（case 全 ○），幂等；nudo/selectContract 请求别名与命令同效	lsp-server 聚合矩阵	没测该层	keep	keep	—
analysisCache trims to maxFiles as distinct files stream in；knownFiles caps at maxFiles (dirty-propagation registry)；nudoDepParents caps at 4× maxFiles with LRU refresh on access；maxFiles=0 disables the analysisCache layer (recompute, never	lsp-server 聚合矩阵	没测该层	keep	keep	—
bumps generation per validateText call；bumpValidateGeneration (onDidClose path) discards in-flight publish；older overlapping validate does not publish after a newer one starts；stillCurrent gate: a completed older gen after newer bump does n	lsp-server 聚合矩阵	没测该层	keep	keep	—
superseded 文档版本的慢分析不发布陈旧诊断；未变更文档的分析正常发布且带启动时 version；无文档跟踪的宿主回落 generation-only 口径（照常发布）	lsp-server 聚合矩阵	没测该层	keep	keep	—
部分载荷 / 无关载荷 / 扁平键：analysis.mode 不被抹掉；显式 null = 重置（回落产品默认 exports）	lsp-server 聚合矩阵	没测该层	keep	keep	—
"package.json change clears analysisCache and notifies host"	"dep 边按 4× 口径）—— 长 IDE 会话不再单调增长。 断言：expect(configChanged).toBe(1);；expect(analysisCache.has(\"/tmp/proj/a.js\")).toBe(false);"	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
畸形 workspaceFolders[0].uri ⇒ 跳过该 folder，initialize 照常返回	dup:lsp-server 聚合矩阵	commit:d25e91ca
畸形 rootUri ⇒ 跳过该根，initialize 照常返回	dup:lsp-server 聚合矩阵	commit:d25e91ca
正常 URI 不受影响（仍返回 capabilities）	dup:lsp-server 聚合矩阵	commit:d25e91ca
未知命令名不再回落 result:null	dup:lsp-server 聚合矩阵	commit:d25e91ca
已声明的命令名照常执行（白名单 = advertise 面）	dup:lsp-server 聚合矩阵	commit:d25e91ca
① 客户端不声明 workspaceFolders 能力 ⇒ createNudoServer 不抛异常	dup:lsp-server 聚合矩阵	commit:d25e91ca
② 该客户端的 onInitialize 仍正常返回（服务端能力声明一字不动）	dup:lsp-server 聚合矩阵	commit:d25e91ca
③ 真语义（getter 在 initialize 之后才可用）⇒ 订阅仍建立且只建立一次	dup:lsp-server 聚合矩阵	commit:d25e91ca
trace({file, functionName}) 回落到 externalFunctions：出跨模块见证	dup:lsp-server 聚合矩阵	commit:d25e91ca
真 server executeCommand `nudo.trace [uri, fn]`（观察镜动作形态）不报 not found	dup:lsp-server 聚合矩阵	commit:d25e91ca
同文件 call@ 对照：trace 仍按本地函数解析（不回归）	dup:lsp-server 聚合矩阵	commit:d25e91ca
位置参数 [uri, fn] 跑出 trace（不是错误）	dup:lsp-server 聚合矩阵	commit:d25e91ca
对象形态 { uri, functionName } 仍然可用（桥不得吃掉既有形态）	dup:lsp-server 聚合矩阵	commit:d25e91ca
非对象参数（裸字符串）⇒ 协议层 InvalidParams（不再把字符串当对象传下去）	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudo/trace 的 {uri} 形态：出见证（不再 TypeError）	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudo/trace 的 {file} 形态：不回归	dup:lsp-server 聚合矩阵	commit:d25e91ca
agent 侧：trace 工具直调也接受 uri 键	dup:lsp-server 聚合矩阵	commit:d25e91ca
位置参数桥 tracePositionalArgs：[uri, fn] ⇒ { uri, functionName }	dup:lsp-server 聚合矩阵	commit:d25e91ca
编码侧对保留字符做百分号转义（裸 % 不再出现）	dup:lsp-server 聚合矩阵	commit:d25e91ca
普通路径的 URI 形态不变（file:/// 绝对路径）	dup:lsp-server 聚合矩阵	commit:d25e91ca
解码侧：合法 URI 解回原路径（与编码侧互逆）	dup:lsp-server 聚合矩阵	commit:d25e91ca
解码侧：畸形百分号转义**绝不抛**（回退到未解码原文）	dup:lsp-server 聚合矩阵	commit:d25e91ca
解码侧：非 file: scheme 原样返回（行为不变）	dup:lsp-server 聚合矩阵	commit:d25e91ca
Windows 盘符形态经 cacheKey 归一（file:///c:/… ⇒ c:/…）	dup:lsp-server 聚合矩阵	commit:d25e91ca
协议面：客户端把服务端自己刚给的（裸 % 的）URI 回传给 didOpen ⇒ 不中断且该文档有诊断	dup:lsp-server 聚合矩阵	commit:d25e91ca
会出诊断的文件：didOpen 只发布一次（同 version 同内容）	dup:lsp-server 聚合矩阵	commit:d25e91ca
不出诊断的文件：didOpen 也只发布一次（空数组）	dup:lsp-server 聚合矩阵	commit:d25e91ca
编辑后仍会发布新版本的诊断（去重不得把后续诊断吞掉）	dup:lsp-server 聚合矩阵	commit:d25e91ca
变更文件自己 ⇒ 不重检自己（无自激重检）	dup:lsp-server 聚合矩阵	commit:d25e91ca
真正的 parent（@nudo:import 依赖方）仍被重检（self-排除不得误伤）	dup:lsp-server 聚合矩阵	commit:d25e91ca
declares the full capability inventory and command list	dup:lsp-server 聚合矩阵	commit:d25e91ca
registers slash- and dot-form request aliases for every agent tool	dup:lsp-server 聚合矩阵	commit:d25e91ca
workspace/executeCommand nudo.check analyzes a source payload	dup:lsp-server 聚合矩阵	commit:d25e91ca
slash-form nudo/check and dot-form nudo.check share one handler	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudo.getActiveCases returns the empty case map for a fresh uri	dup:lsp-server 聚合矩阵	commit:d25e91ca
unknown executeCommand raises a protocol-level MethodNotFound error	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudo.check on a missing file returns isError (fail-closed)	dup:lsp-server 聚合矩阵	commit:d25e91ca
pull diagnostics for an unknown document are empty (no crash)	dup:lsp-server 聚合矩阵	commit:d25e91ca
pull diagnostics catch 不得 items:[] — 标 Analysis error（R2B-003）	dup:lsp-server 聚合矩阵	commit:d25e91ca
pull diagnostics catch 保留上次已发布诊断（R2B-003）	dup:lsp-server 聚合矩阵	commit:d25e91ca
listen() is the only transport start — safe to call explicitly	dup:lsp-server 聚合矩阵	commit:d25e91ca
plain non-export JS stays quiet without client settings (exports default)	dup:lsp-server 聚合矩阵	commit:d25e91ca
initializationOptions analysis.mode=all widens the gate	dup:lsp-server 聚合矩阵	commit:d25e91ca
invalid initializationOptions mode falls back to the product default	dup:lsp-server 聚合矩阵	commit:d25e91ca
project package.json#nudo.analysis.mode wins over the client default (directives vs all)	dup:lsp-server 聚合矩阵	commit:d25e91ca
project package.json#nudo.analysis.mode=all wins over client default directives	dup:lsp-server 聚合矩阵	commit:d25e91ca
workspace/didChangeConfiguration re-gates an already-open document	dup:lsp-server 聚合矩阵	commit:d25e91ca
默认关：无参数 where inlay（返回 inlay 仍在）	dup:lsp-server 聚合矩阵	commit:d25e91ca
initializationOptions inlayHints.parameters=true 开启	dup:lsp-server 聚合矩阵	commit:d25e91ca
非法宿主值回落默认关	dup:lsp-server 聚合矩阵	commit:d25e91ca
workspace/didChangeConfiguration 实时开关	dup:lsp-server 聚合矩阵	commit:d25e91ca
项目 package.json#nudo.inlayHints.parameters 显式值赢过宿主默认	dup:lsp-server 聚合矩阵	commit:d25e91ca
折叠展示：侧车表达式原文 label + 完整 pred tooltip	dup:lsp-server 聚合矩阵	commit:d25e91ca
默认：契约选项 ●，全部 case ○；动作与观察层照常	dup:lsp-server 聚合矩阵	commit:d25e91ca
selectCase 后契约转 ○、选中 case 转 ●；inlay 档投影同态	dup:lsp-server 聚合矩阵	commit:d25e91ca
selectContract 切回契约（case 全 ○），幂等	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudo/selectContract 请求别名与命令同效	dup:lsp-server 聚合矩阵	commit:d25e91ca
analysisCache trims to maxFiles as distinct files stream in	dup:lsp-server 聚合矩阵	commit:d25e91ca
knownFiles caps at maxFiles (dirty-propagation registry)	dup:lsp-server 聚合矩阵	commit:d25e91ca
nudoDepParents caps at 4× maxFiles with LRU refresh on access	dup:lsp-server 聚合矩阵	commit:d25e91ca
maxFiles=0 disables the analysisCache layer (recompute, never stale)	dup:lsp-server 聚合矩阵	commit:d25e91ca
bumps generation per validateText call	dup:lsp-server 聚合矩阵	commit:d25e91ca
bumpValidateGeneration (onDidClose path) discards in-flight publish	dup:lsp-server 聚合矩阵	commit:d25e91ca
older overlapping validate does not publish after a newer one starts	dup:lsp-server 聚合矩阵	commit:d25e91ca
stillCurrent gate: a completed older gen after newer bump does not send	dup:lsp-server 聚合矩阵	commit:d25e91ca
clearValidationState resets generations	dup:lsp-server 聚合矩阵	commit:d25e91ca
superseded 文档版本的慢分析不发布陈旧诊断	dup:lsp-server 聚合矩阵	commit:d25e91ca
未变更文档的分析正常发布且带启动时 version	dup:lsp-server 聚合矩阵	commit:d25e91ca
无文档跟踪的宿主回落 generation-only 口径（照常发布）	dup:lsp-server 聚合矩阵	commit:d25e91ca
部分载荷 / 无关载荷 / 扁平键：analysis.mode 不被抹掉	dup:lsp-server 聚合矩阵	commit:d25e91ca
显式 null = 重置（回落产品默认 exports）	dup:lsp-server 聚合矩阵	commit:d25e91ca
```
