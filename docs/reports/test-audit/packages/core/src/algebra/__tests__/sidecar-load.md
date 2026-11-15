# packages/core/src/algebra/__tests__/sidecar-load.test.ts

模块套件：59 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"瞬态读错误自愈：首次抛 EACCES → 重试拿侧车 → 契约诊断完整且无 contract-load"	"自愈：raw 抛错不进 per-call 缓存，下一消费者（侧车闭包指纹 / 绑定）重试 契约族诊断完整在场（-5 ⊭ x>0）——不是静默消失的少集 瞬态故障不该被上报为加载失败 且不污染后续轮：同 loader 转「真无侧车」后必须回到干净报告 （修复前：瞬态轮以 miss 键 memo 了带诊断报告 → 真 miss 轮陈旧命中） 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	没测该层	keep	keep	—
"持久读错误响亮：恒抛 → error 级 nudo:contract-load + ok=false"	"契约族诊断可以缺席（侧车没绑上），但失败本身必须可见、门禁红 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	没测该层	keep	keep	—
"持久错误轮不钉 memo：随后真 miss 轮回到干净（不陈旧命中错误报告）"	"fs 恢复为「真无侧车」（侧车被删）：同一 loader 身份、同源 → 若错误轮 以 miss 键进了 memo，此轮会陈旧命中错误报告（假红）； 修复后必须重算 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	没测该层	keep	keep	—
"miss 轮不吞错误轮：先真 miss（干净、进 memo），后恒抛必须响亮（不陈旧命中干净报告）"	"fs 从「无侧车」变成「有侧车但不可读」：miss 键下已有干净报告—— 修复前此轮 memo 命中干净报告 → 读错误静默（#135 假绿形状）； 修复后重算 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	夹具漏形态	keep	keep	—
"真 miss（无侧车文件）→ 静默零诊断（反向回归钉）"	"真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	没测该层	keep	keep	—
"装载抛错 ≠ miss：readerr: 前缀 + readError=true，不产 sidecar 条目"	"contents 补 null 条目：磁盘缓存消费方（hasBareMiss）与主 BFS 读错误 同口径 fail-closed，不按「无侧车」形状写 iface/check 缓存键 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	夹具漏形态	keep	keep	—
"真 miss 无前缀、readError=false；正常内容轮含 sidecar 条目"	"真 miss 不产生任何条目（零回归契约保持） 错误轮与 miss 轮键不同（互不陈旧命中）、与内容轮键也不同 真实（非缓存命中）探测次数——「抛错后重试」的直接证据"	没测该层	keep	keep	—
"keeps only relative .nudo.js/.nudo.ts specs (any import form)"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"dependency file's ambient sidecar enters fingerprint and eviction paths"	"R08 P1：跨文件被调（checkExternalCall）按定义文件路径绑定 lib.nudo.js， 其内容影响调用方报告——lib.nudo.js 必须进调用方指纹与逐出索引， 否则编辑依赖侧车后 check memo 陈旧命中（错诊断）。 依赖侧车内容变 → 指纹变（整文件 memo 借此失效） - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"dep sidecar with recursive .nudo closure contributes transitive entries"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"generalize L0 recomputes when the analyzed file's sidecar content changes"	"R08 minor：两阶段断言——不只是指纹字符串翻转，L0 结果必须重算且 签名携带新约束（防「键构成回归」）。 go 必须是导出（侧车同名绑定 只落本地 named export）。 - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	夹具漏形态	keep	keep	—
"no sidecar file → fingerprint identical to the pre-sidecar algorithm"	"旧算法形态：仅声明 spec 的 `路径=hash` 排序拼接，无 sidecar: 条目 - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	夹具漏形态	keep	keep	—
"no specs and no sidecar → empty fingerprint"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"existing sidecar contributes sidecar: entries for root and recursive .nudo deps"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"declared .nudo dep also being the sidecar → single regular entry, no duplicate"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"sidecar content change → fingerprint change"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"transitive std.nudo.js content change → fingerprint change"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"missing transitive dep is recorded as miss (creation later flips the fingerprint)"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"sidecar closure past the node cap → truncated (callers must fail-open)"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。"	没测该层	keep	keep	—
"in-tree sidecar binds when projectDir set"	"projectDir 提供时，树外侧车不 ambient 加载；"	没测该层	keep	keep	—
"out-of-tree sidecar is not ambient-bound when projectDir set"	"projectDir 提供时，树外侧车不 ambient 加载；"	没测该层	keep	keep	—
"node_modules sidecar stays blocked even inside projectDir"	"projectDir 提供时，树外侧车不 ambient 加载；"	没测该层	keep	keep	—
"checkSource with projectDir does not load out-of-tree sidecar"	"projectDir 提供时，树外侧车不 ambient 加载；"	没测该层	keep	keep	—
"sidecar read throws (EACCES) → nudo:contract-load，不静默"	"侧车不存在：返回 undefined（auto-bind 常态）"	没测该层	keep	keep	—
"no sidecar file (undefined) → 保持静默，无 contract-load"	"侧车不存在：返回 undefined（auto-bind 常态）"	没测该层	keep	keep	—
"读失败按 (路径, 原因) 去重：多导出只报一条"	"侧车不存在：返回 undefined（auto-bind 常态）"	没测该层	keep	keep	—
"显式 @nudo:import 读失败 → 报诊断（不再炸穿或静默）"	"侧车不存在：返回 undefined（auto-bind 常态）"	没测该层	keep	keep	—
"sidecar binds only alpha → load failure reported once, not per source export"	"null_ 不是注入构建器：exec 时炸在 fn({ x: null_() }) 只报 1 条模块级失败（不按 alpha/beta/gamma 各报一条） 措辞不点名函数（避免读成「X 自身有问题」） #64：侧车加载失败按 (路径, 原因) 去重，不按源导出逐个上报。 最小复现：侧车只绑定 alpha，但 import 打错（null_ 不是构建器）→ 修复前 alpha/beta/gamma 各报一条相同的 ERROR；"	没测该层	keep	keep	—
"sidecar exports two names and fails → one message, affects 2 bindings"	"#64：侧车加载失败按 (路径, 原因) 去重，不按源导出逐个上报。 最小复现：侧车只绑定 alpha，但 import 打错（null_ 不是构建器）→ 修复前 alpha/beta/gamma 各报一条相同的 ERROR；"	没测该层	keep	keep	—
"unrelated exports do not surface sidecar load noise"	"侧车正常，只绑 alpha：beta/gamma 不该出现任何 contract-load #64：侧车加载失败按 (路径, 原因) 去重，不按源导出逐个上报。 最小复现：侧车只绑定 alpha，但 import 打错（null_ 不是构建器）→ 修复前 alpha/beta/gamma 各报一条相同的 ERROR；"	没测该层	keep	keep	—
"正例：侧车在被调方旁边 ⇒ 只有真违例，无 contract-load / contract-syntax"	"跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录** 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级** `nudo:contract-load` + `nudo:contract-syntax` 假红。 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures` 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contrac"	没测该层	keep	keep	—
"正例：违例诊断指向被调方的契约（expected: x > 0），不是「装载失败」"	"跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录** 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级** `nudo:contract-load` + `nudo:contract-syntax` 假红。 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures` 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contrac"	没测该层	keep	keep	—
"负控制：侧车只在调用方目录 ⇒ 按被调方目录解析找不到 ⇒ 报 contract-load"	"跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录** 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级** `nudo:contract-load` + `nudo:contract-syntax` 假红。 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures` 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contrac"	没测该层	keep	keep	—
"对照：被调方与调用方同目录 ⇒ 侧车同目录 ⇒ 正常解析（零 contract-load）"	"跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录** 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级** `nudo:contract-load` + `nudo:contract-syntax` 假红。 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures` 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contrac"	没测该层	keep	keep	—
"诊断点名**依赖侧车路径**（旧口径只说导入方坏了）"	"回归：依赖侧车的求值异常**不包装、不标注依赖路径** ⇒ 报错指向 **导入方**且点名它根本没有的名字； 导入方的合法契约被连坐作废 ⇒ 契约门禁 假绿。"	没测该层	keep	keep	—
"依赖侧车正常时，导入方的契约**照常执法**（不再连坐作废）"	"回归：依赖侧车的求值异常**不包装、不标注依赖路径** ⇒ 报错指向 **导入方**且点名它根本没有的名字； 导入方的合法契约被连坐作废 ⇒ 契约门禁 假绿。"	没测该层	keep	keep	—
"侧车导出名与源码函数名不匹配 ⇒ 报孤儿导出（点名侧车导出名）"	"侧车导出名打错 ⇒ 契约被**静默丢弃**。 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、 dts 类型错、门禁冒一条与真实原因无关的假红（\"may throw TypeError\"）。"	没测该层	keep	keep	—
"名字对得上 ⇒ 无孤儿诊断（不误报）"	"侧车导出名打错 ⇒ 契约被**静默丢弃**。 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、 dts 类型错、门禁冒一条与真实原因无关的假红（\"may throw TypeError\"）。"	没测该层	keep	keep	—
"非 fn() 形态的孤儿导出（模板）不报（模板是 @nudo:import 的料）"	"侧车导出名打错 ⇒ 契约被**静默丢弃**。 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、 dts 类型错、门禁冒一条与真实原因无关的假红（\"may throw TypeError\"）。"	没测该层	keep	keep	—
"已被 @nudo:import 认领的名字不算孤儿"	"侧车导出名打错 ⇒ 契约被**静默丢弃**。 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、 dts 类型错、门禁冒一条与真实原因无关的假红（\"may throw TypeError\"）。"	没测该层	keep	keep	—
"`export const pick = fn(…)`（pick 是构建器名）→ 侧车可加载，导出可见"	"回归：侧车自身的绑定名与**构建器名**同名 ⇒ 侧车根本加载不了。 根因：`execSidecar` 用 `new Function(...Object.keys(sidecarInjects), …)` 把 15 个构建器名当**形参**注入；"	夹具漏形态	keep	keep	—
"侧车里的 `const number = …`（number 是构建器名）→ 可加载，不抛 SyntaxError"	"回归：侧车自身的绑定名与**构建器名**同名 ⇒ 侧车根本加载不了。 根因：`execSidecar` 用 `new Function(...Object.keys(sidecarInjects), …)` 把 15 个构建器名当**形参**注入；"	夹具漏形态	keep	keep	—
"构建器仍可用：侧车未遮蔽的名字照常解析（fn / number）"	"回归：侧车自身的绑定名与**构建器名**同名 ⇒ 侧车根本加载不了。 根因：`execSidecar` 用 `new Function(...Object.keys(sidecarInjects), …)` 把 15 个构建器名当**形参**注入；"	夹具漏形态	keep	keep	—
"ambient 通道 + @nudo:import 通道命中同一物理环 ⇒ 只报 1 条"	"两条通道： - ambient 侧车加载通道（contract.ts `loadSidecarBinding` 的 exec catch） - `@nudo:import` 通道（refine.ts `collectConstraints` → exec 抛 `NudoSidecarError(nudo:contract-cycle)`） 两条通道命中的是**同一个物理环**（环链文本相同），但 message 差一个 \"sidecar '…' failed to load: \" 前缀 ⇒ check 层的 cod"	没测该层	keep	keep	—
"环诊断文本仍点名环链（去重不丢信息）"	"两条通道： - ambient 侧车加载通道（contract.ts `loadSidecarBinding` 的 exec catch） - `@nudo:import` 通道（refine.ts `collectConstraints` → exec 抛 `NudoSidecarError(nudo:contract-cycle)`） 两条通道命中的是**同一个物理环**（环链文本相同），但 message 差一个 \"sidecar '…' failed to load: \" 前缀 ⇒ check 层的 cod"	没测该层	keep	keep	—
"依赖侧车的坏 import ⇒ 诊断归因到依赖侧车路径（不是 root）"	"依赖侧车：import 了一个不存在的 builder ⇒ 装载期报「not an injected builder」"	没测该层	keep	keep	—
"root 自己的坏 import ⇒ 归因到 root（零回归）"	"依赖侧车：import 了一个不存在的 builder ⇒ 装载期报「not an injected builder」"	没测该层	keep	keep	—
"同一消息在 root 与依赖侧车各一处 ⇒ 两条诊断都在（去重键含来源文件）"	"依赖侧车：import 了一个不存在的 builder ⇒ 装载期报「not an injected builder」"	没测该层	keep	keep	—
"别名导出：诊断点名侧车导出名 class（不是源码本地名 _c）"	"侧车形态诊断点名的是**源码本地名**，不是侧车里真实存在的导出名。 旧诊断点名源码本地名 ⇒ 用户照着去侧车 里找一个根本不存在的导出。"	夹具漏形态	keep	keep	—
"default 导出：诊断点名侧车导出名 default（不是源码本地名 f）"	"侧车形态诊断点名的是**源码本地名**，不是侧车里真实存在的导出名。 旧诊断点名源码本地名 ⇒ 用户照着去侧车 里找一个根本不存在的导出。"	夹具漏形态	keep	keep	—
"裸包别名（number as string）⇒ 侧车装载成功、契约生效"	"装载失败（SyntaxError）会被报成 nudo:contract-load —— 修复后不得出现 契约真的绑上了：case 违例可见 带 case 的源码：case 违例可见 ⇒ 证明契约真的绑上了（不只是「没报错」）"	没测该层	keep	keep	—
"相对侧车别名（positive as number）⇒ 侧车装载成功、契约生效"	"带 case 的源码：case 违例可见 ⇒ 证明契约真的绑上了（不只是「没报错」）"	没测该层	keep	keep	—
"同名导入（number）仍走 ambient 解构 ⇒ 不得被排除（零回归）"	"带 case 的源码：case 违例可见 ⇒ 证明契约真的绑上了（不只是「没报错」）"	没测该层	keep	keep	—
"`__nudoInjects` 撞名 → 侧车可加载（旧口径 SyntaxError）"	"构建器名撞名的基础形态（`export const number = fn(...)`）已由本文件 「侧车绑定名与构建器名同名」组钉住（同一根因），此处只保留扩展面。 根因（同 338）：`new Function(...Object.keys(sidecarInjects), …)` 把 15 个 构建器名当形参注入； 侧车的顶层 `const <name>` 与形参同名 ⇒ 整份侧车失效。"	夹具漏形态	keep	keep	—
"`__nudoDeps` 撞名 → 侧车可加载（旧口径 SyntaxError）"	"根因（同 338）：`new Function(...Object.keys(sidecarInjects), …)` 把 15 个 构建器名当形参注入； 侧车的顶层 `const <name>` 与形参同名 ⇒ 整份侧车失效。"	夹具漏形态	keep	keep	—
"相对 import 的本地名撞名 → 侧车可加载 + 报出 Nudo 原生诊断"	"根因（同 338）：`new Function(...Object.keys(sidecarInjects), …)` 把 15 个 构建器名当形参注入； 侧车的顶层 `const <name>` 与形参同名 ⇒ 整份侧车失效。"	夹具漏形态	keep	keep	—
"第二个分析作用域（exec 缓存命中）仍报 contract-load"	"第二轮：exec 缓存命中（不重跑 execSidecar）⇒ 旧实现这里诊断消失 同上，但**连导出对象一起**返回——「是否重新求值」只能靠**对象身份**观测 （诊断是**有意重放**的 ⇒ 诊断可见与否证明不了重新求值）。"	夹具漏形态	keep	keep	—
"同一作用域内重复装载 ⇒ 诊断只报一次（作用域内去重，不刷屏）"	"同上，但**连导出对象一起**返回——「是否重新求值」只能靠**对象身份**观测 （诊断是**有意重放**的 ⇒ 诊断可见与否证明不了重新求值）。"	夹具漏形态	keep	keep	—
"resetNudoModuleExecCache ⇒ 侧车**重新求值**（导出对象身份变化），诊断仍可见"	"未 reset：exec 缓存命中 ⇒ **同一个**导出对象（没有重跑 exec） reset 后 ⇒ **重新求值** ⇒ 导出对象身份变化 （旧写法只断言「诊断仍可见」——诊断是**有意重放**的 ⇒ 恒真、零信息） 同上，但**连导出对象一起**返回——「是否重新求值」只能靠**对象身份**观测 （诊断是**有意重放**的 ⇒ 诊断可见与否证明不了重新求值）。"	夹具漏形态	keep	keep	—
构建器名撞名 → 侧车可加载（旧口径 SyntaxError）	侧车顶层的 `export const number = fn(...)` 与 `new Function` 注入的构建器形参同名 ⇒ 重复声明 SyntaxError；旧测试没有「构建器名作为导出绑定」的形态。	夹具漏形态	keep	keep	—
```
