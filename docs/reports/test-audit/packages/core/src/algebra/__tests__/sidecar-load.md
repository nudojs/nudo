# packages/core/src/algebra/__tests__/sidecar-load.test.ts

模块套件：侧车（*.nudo.*）装载、路径派生、诊断归属与指纹。 表行覆盖纯路径口径（sidecarPathOf / 草稿落点）；

审计：60 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"%s → %s"	表驱动用例：%s → %s；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"draft %s → %s"	表驱动用例：draft %s → %s；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
瞬态读错误自愈：首次抛 EACCES → 重试拿侧车 → 契约诊断完整且无 contract-load；持久读错误响亮：恒抛 → error 级 nudo:contract-load + ok=false；持久错误轮不钉 memo：随后真 miss 轮回到干净（不陈旧命中错误报告）；miss 轮不吞错误轮：先真 miss（干净、进 memo），后恒抛必须响亮（不陈旧命中干净报告）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
装载抛错 ≠ miss：readerr: 前缀 + readError=true，不产 sidecar 条目；真 miss 无前缀、readError=false；正常内容轮含 sidecar 条目	sidecar-load 聚合矩阵	没测该层	keep	keep	—
"keeps only relative .nudo.js/.nudo.ts specs (any import form)"	"- 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）； - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。 断言：expect(sidecarSpecsOf(src)).toEqual(["	没测该层	keep	keep	—
dependency file's ambient sidecar enters fingerprint and eviction paths；dep sidecar with recursive .nudo closure contributes transitive entries；generalize L0 recomputes when the analyzed file's sidecar content changes	sidecar-load 聚合矩阵	没测该层	keep	keep	—
no sidecar file → fingerprint identical to the pre-sidecar algorithm；no specs and no sidecar → empty fingerprint；existing sidecar contributes sidecar: entries for root and recursive .nudo deps；declared .nudo dep also being the sidecar → sin	sidecar-load 聚合矩阵	没测该层	keep	keep	—
in-tree sidecar binds when projectDir set；out-of-tree sidecar is not ambient-bound when projectDir set；node_modules sidecar stays blocked even inside projectDir；checkSource with projectDir does not load out-of-tree sidecar	sidecar-load 聚合矩阵	没测该层	keep	keep	—
sidecar read throws (EACCES) → nudo:contract-load，不静默；读失败按 (路径, 原因) 去重：多导出只报一条；显式 @nudo:import 读失败 → 报诊断（不再炸穿或静默）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
sidecar binds only alpha → load failure reported once, not per source export；sidecar exports two names and fails → one message, affects 2 bindings；unrelated exports do not surface sidecar load noise	sidecar-load 聚合矩阵	没测该层	keep	keep	—
正例：侧车在被调方旁边 ⇒ 只有真违例，无 contract-load / contract-syntax；正例：违例诊断指向被调方的契约（expected: x > 0），不是「装载失败」；负控制：侧车只在调用方目录 ⇒ 按被调方目录解析找不到 ⇒ 报 contract-load；对照：被调方与调用方同目录 ⇒ 侧车同目录 ⇒ 正常解析（零 contract-load）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
诊断点名**依赖侧车路径**（旧口径只说导入方坏了）；依赖侧车正常时，导入方的契约**照常执法**（不再连坐作废）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
"已被 @nudo:import 认领的名字不算孤儿"	"跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录** 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级** `nudo:contract-load` + `nudo:contract-syntax` 假红。 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures` 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contractFromFile` 传进来） 用作 `refine.fromFile`（`refineFromFile = !same"	没测该层	keep	keep	—
`export const pick = fn(…)`（pick 是构建器名）→ 侧车可加载，导出可见；侧车里的 `const number = …`（number 是构建器名）→ 可加载，不抛 SyntaxError；构建器仍可用：侧车未遮蔽的名字照常解析（fn / number）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
ambient 通道 + @nudo:import 通道命中同一物理环 ⇒ 只报 1 条；环诊断文本仍点名环链（去重不丢信息）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
依赖侧车的坏 import ⇒ 诊断归因到依赖侧车路径（不是 root）；root 自己的坏 import ⇒ 归因到 root（零回归）；同一消息在 root 与依赖侧车各一处 ⇒ 两条诊断都在（去重键含来源文件）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
别名导出：诊断点名侧车导出名 class（不是源码本地名 _c）；default 导出：诊断点名侧车导出名 default（不是源码本地名 f）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
裸包别名（number as string）⇒ 侧车装载成功、契约生效；相对侧车别名（positive as number）⇒ 侧车装载成功、契约生效；同名导入（number）仍走 ambient 解构 ⇒ 不得被排除（零回归）	sidecar-load 聚合矩阵	没测该层	keep	keep	—
构建器名撞名 → 侧车可加载（旧口径 SyntaxError）；`__nudoInjects` 撞名 → 侧车可加载（旧口径 SyntaxError）；`__nudoDeps` 撞名 → 侧车可加载（旧口径 SyntaxError）；相对 import 的本地名撞名 → 侧车可加载 + 报出 Nudo 原生诊断	sidecar-load 聚合矩阵	没测该层	keep	keep	—
第二个分析作用域（exec 缓存命中）仍报 contract-load；同一作用域内重复装载 ⇒ 诊断只报一次（作用域内去重，不刷屏）；resetNudoModuleExecCache ⇒ 侧车**重新求值**（导出对象身份变化），诊断仍可见	sidecar-load 聚合矩阵	没测该层	keep	keep	—
$name	装载器缺少「场景 × 诊断码 × 归属」模块矩阵：missing/load-failure/orphan/template/alias/跨文件六条路径散落在 bug 用例里；新增表驱动不变量。	没测该层	add	done	commit:b21fcb34
```

```audit-deleted
title	reason	evidence
真 miss（无侧车文件）→ 静默零诊断（反向回归钉）	dup:模块矩阵：sidecar 装载面	commit:27b8a25b
no sidecar file (undefined) → 保持静默，无 contract-load	dup:模块矩阵：sidecar 装载面	commit:27b8a25b
侧车导出名与源码函数名不匹配 ⇒ 报孤儿导出（点名侧车导出名）	dup:模块矩阵：sidecar 装载面	commit:27b8a25b
非 fn() 形态的孤儿导出（模板）不报（模板是 @nudo:import 的料）	dup:模块矩阵：sidecar 装载面	commit:27b8a25b
名字对得上 ⇒ 无孤儿诊断（不误报）	dup:模块矩阵：sidecar 装载面	commit:27b8a25b
瞬态读错误自愈：首次抛 EACCES → 重试拿侧车 → 契约诊断完整且无 contract-load	dup:sidecar-load 聚合矩阵	commit:a0b08363
持久读错误响亮：恒抛 → error 级 nudo:contract-load + ok=false	dup:sidecar-load 聚合矩阵	commit:a0b08363
持久错误轮不钉 memo：随后真 miss 轮回到干净（不陈旧命中错误报告）	dup:sidecar-load 聚合矩阵	commit:a0b08363
miss 轮不吞错误轮：先真 miss（干净、进 memo），后恒抛必须响亮（不陈旧命中干净报告）	dup:sidecar-load 聚合矩阵	commit:a0b08363
装载抛错 ≠ miss：readerr: 前缀 + readError=true，不产 sidecar 条目	dup:sidecar-load 聚合矩阵	commit:a0b08363
真 miss 无前缀、readError=false；正常内容轮含 sidecar 条目	dup:sidecar-load 聚合矩阵	commit:a0b08363
dependency file's ambient sidecar enters fingerprint and eviction paths	dup:sidecar-load 聚合矩阵	commit:a0b08363
dep sidecar with recursive .nudo closure contributes transitive entries	dup:sidecar-load 聚合矩阵	commit:a0b08363
generalize L0 recomputes when the analyzed file's sidecar content changes	dup:sidecar-load 聚合矩阵	commit:a0b08363
no sidecar file → fingerprint identical to the pre-sidecar algorithm	dup:sidecar-load 聚合矩阵	commit:a0b08363
no specs and no sidecar → empty fingerprint	dup:sidecar-load 聚合矩阵	commit:a0b08363
existing sidecar contributes sidecar: entries for root and recursive .nudo deps	dup:sidecar-load 聚合矩阵	commit:a0b08363
declared .nudo dep also being the sidecar → single regular entry, no duplicate	dup:sidecar-load 聚合矩阵	commit:a0b08363
sidecar content change → fingerprint change	dup:sidecar-load 聚合矩阵	commit:a0b08363
transitive std.nudo.js content change → fingerprint change	dup:sidecar-load 聚合矩阵	commit:a0b08363
missing transitive dep is recorded as miss (creation later flips the fingerprint)	dup:sidecar-load 聚合矩阵	commit:a0b08363
sidecar closure past the node cap → truncated (callers must fail-open)	dup:sidecar-load 聚合矩阵	commit:a0b08363
in-tree sidecar binds when projectDir set	dup:sidecar-load 聚合矩阵	commit:a0b08363
out-of-tree sidecar is not ambient-bound when projectDir set	dup:sidecar-load 聚合矩阵	commit:a0b08363
node_modules sidecar stays blocked even inside projectDir	dup:sidecar-load 聚合矩阵	commit:a0b08363
checkSource with projectDir does not load out-of-tree sidecar	dup:sidecar-load 聚合矩阵	commit:a0b08363
sidecar read throws (EACCES) → nudo:contract-load，不静默	dup:sidecar-load 聚合矩阵	commit:a0b08363
读失败按 (路径, 原因) 去重：多导出只报一条	dup:sidecar-load 聚合矩阵	commit:a0b08363
显式 @nudo:import 读失败 → 报诊断（不再炸穿或静默）	dup:sidecar-load 聚合矩阵	commit:a0b08363
sidecar binds only alpha → load failure reported once, not per source export	dup:sidecar-load 聚合矩阵	commit:a0b08363
sidecar exports two names and fails → one message, affects 2 bindings	dup:sidecar-load 聚合矩阵	commit:a0b08363
unrelated exports do not surface sidecar load noise	dup:sidecar-load 聚合矩阵	commit:a0b08363
正例：侧车在被调方旁边 ⇒ 只有真违例，无 contract-load / contract-syntax	dup:sidecar-load 聚合矩阵	commit:a0b08363
正例：违例诊断指向被调方的契约（expected: x > 0），不是「装载失败」	dup:sidecar-load 聚合矩阵	commit:a0b08363
负控制：侧车只在调用方目录 ⇒ 按被调方目录解析找不到 ⇒ 报 contract-load	dup:sidecar-load 聚合矩阵	commit:a0b08363
对照：被调方与调用方同目录 ⇒ 侧车同目录 ⇒ 正常解析（零 contract-load）	dup:sidecar-load 聚合矩阵	commit:a0b08363
诊断点名**依赖侧车路径**（旧口径只说导入方坏了）	dup:sidecar-load 聚合矩阵	commit:a0b08363
依赖侧车正常时，导入方的契约**照常执法**（不再连坐作废）	dup:sidecar-load 聚合矩阵	commit:a0b08363
`export const pick = fn(…)`（pick 是构建器名）→ 侧车可加载，导出可见	dup:sidecar-load 聚合矩阵	commit:a0b08363
侧车里的 `const number = …`（number 是构建器名）→ 可加载，不抛 SyntaxError	dup:sidecar-load 聚合矩阵	commit:a0b08363
构建器仍可用：侧车未遮蔽的名字照常解析（fn / number）	dup:sidecar-load 聚合矩阵	commit:a0b08363
ambient 通道 + @nudo:import 通道命中同一物理环 ⇒ 只报 1 条	dup:sidecar-load 聚合矩阵	commit:a0b08363
环诊断文本仍点名环链（去重不丢信息）	dup:sidecar-load 聚合矩阵	commit:a0b08363
依赖侧车的坏 import ⇒ 诊断归因到依赖侧车路径（不是 root）	dup:sidecar-load 聚合矩阵	commit:a0b08363
root 自己的坏 import ⇒ 归因到 root（零回归）	dup:sidecar-load 聚合矩阵	commit:a0b08363
同一消息在 root 与依赖侧车各一处 ⇒ 两条诊断都在（去重键含来源文件）	dup:sidecar-load 聚合矩阵	commit:a0b08363
别名导出：诊断点名侧车导出名 class（不是源码本地名 _c）	dup:sidecar-load 聚合矩阵	commit:a0b08363
default 导出：诊断点名侧车导出名 default（不是源码本地名 f）	dup:sidecar-load 聚合矩阵	commit:a0b08363
裸包别名（number as string）⇒ 侧车装载成功、契约生效	dup:sidecar-load 聚合矩阵	commit:a0b08363
相对侧车别名（positive as number）⇒ 侧车装载成功、契约生效	dup:sidecar-load 聚合矩阵	commit:a0b08363
同名导入（number）仍走 ambient 解构 ⇒ 不得被排除（零回归）	dup:sidecar-load 聚合矩阵	commit:a0b08363
构建器名撞名 → 侧车可加载（旧口径 SyntaxError）	dup:sidecar-load 聚合矩阵	commit:a0b08363
`__nudoInjects` 撞名 → 侧车可加载（旧口径 SyntaxError）	dup:sidecar-load 聚合矩阵	commit:a0b08363
`__nudoDeps` 撞名 → 侧车可加载（旧口径 SyntaxError）	dup:sidecar-load 聚合矩阵	commit:a0b08363
相对 import 的本地名撞名 → 侧车可加载 + 报出 Nudo 原生诊断	dup:sidecar-load 聚合矩阵	commit:a0b08363
第二个分析作用域（exec 缓存命中）仍报 contract-load	dup:sidecar-load 聚合矩阵	commit:a0b08363
同一作用域内重复装载 ⇒ 诊断只报一次（作用域内去重，不刷屏）	dup:sidecar-load 聚合矩阵	commit:a0b08363
resetNudoModuleExecCache ⇒ 侧车**重新求值**（导出对象身份变化），诊断仍可见	dup:sidecar-load 聚合矩阵	commit:a0b08363
```
