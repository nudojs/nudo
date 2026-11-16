# packages/nudojs/src/__tests__/cli-products.test.ts

模块套件：nudojs draft/emit/export/dts 产品面。

审计：86 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
同一份源码在两个目录下导出到同一 out 目录 ⇒ 只有一份产物；产物 marker 不含绝对路径（同一源码 ⇒ 同一字节）	cli-products 聚合矩阵	没测该层	keep	keep	—
用户导出名在 stdout 的 dts 段保持原名（不出现 *Dts 后缀）；stdout 的 dts 段与 --out 落盘的 .d.ts 逐字相同（两条投递路径同一公开 API）	cli-products 聚合矩阵	没测该层	keep	keep	—
只有再导出的模块：dts 产出再导出声明（不是「无函数」早退）；负控制：本地函数 + 再导出的模块两条面都在；负控制：真的没有导出面的模块仍如实说明（不静默零产物）	cli-products 聚合矩阵	没测该层	keep	keep	—
--fn renamed ⇒ 草拟出 `export const renamed = fn(`（不再是空草稿）；不回归 BUG-042：名字写错仍是用法错误 + 不落盘	cli-products 聚合矩阵	没测该层	keep	keep	—
名字写错 ⇒ 用法错误（exit 1）+ 列出可用导出名 + **不落盘**；--json 面：stdout 仍是**一份合法 JSON 文档**（usage-error 有条目）+ exit 1；对照组：名字正确 ⇒ exit 0 且草稿点名该导出；非导出的本地函数名 ⇒ 仍走**可见**的 not-an-export 条目（门禁不误伤）	cli-products 聚合矩阵	没测该层	keep	keep	—
dts 面：返回位是真类型（不是 unknown），且与 dot 形态逐字一致；zod 面：Output 是联合（不是 `z.unknown()`），且与 dot 形态逐字一致；guard 面：校验器真的校验（不是 `return true;`），且与 dot 形态逐字一致	cli-products 聚合矩阵	没测该层	keep	keep	—
违约见证不写入；固化后 check 仍绿（旧行为：check FAILED + exit 1）；--freeze=update 不再重记违约见证（旧行为：原样重记同一条 ⇒ 永远红）	cli-products 聚合矩阵	没测该层	keep	keep	—
default 函数：declare function + `export { main as default }`；default 类：declare class + `export { Box as default }`；单独 --format dts 同样合法（存成 .ts 也可编译）；具名导出保持既有 `export declare function` 形态	cli-products 聚合矩阵	没测该层	keep	keep	—
--from-dts + --emit/--all/--dry-run/--exit-on-diff ⇒ 用法错误（exit 1）+ 不写侧车；--from-dts + --fn ⇒ 同样用法错误（过滤不许被吞）；对照组：--from-dts 单独跑 ⇒ 仍出草稿（exit 0）；机器面控制组：--from-dts + --emit + --json ⇒ 仍是合法 JSON + exit 1（绝不假绿）	cli-products 聚合矩阵	没测该层	keep	keep	—
首次 --emit --all：标签行真落盘（Updated 与文件一致）；第二次逐字不变（幂等）；--dry-run --exit-on-diff：预览与落盘同源 —— 收敛前 exit 1，收敛后 exit 0；对照组：真有净漂移 ⇒ dry-run 打 diff 且 --exit-on-diff exit 1（门禁没被关掉）	cli-products 聚合矩阵	没测该层	keep	keep	—
两个分支都命中同一导出 ⇒ 直写正文优先 + `derived-from` 标签行真落盘；幂等：连跑两次 --emit --all ⇒ 第二次无 Updated 且 md5 不变；收敛后 --dry-run --exit-on-diff ⇒ exit 0，且不再打印永不落盘的 diff；预览 == 写盘（字节级）：dry-run 的新增行拼起来就是真实写盘内容	cli-products 聚合矩阵	没测该层	keep	keep	—
"warning 级 nudo:contract-conflict ⇒ 阻断（诊断上屏 + exit 1）"	"`export.ts` 又只在 `blocking` 时才上屏 ⇒ 已收集的诊断既不打印也不阻断 ⇒ 出货「只编码了一半契约」的产物、 stderr 空、exit 0，与同文件 `nudo check` 的结论相反。 断言：expect(r.status).toBe(1);；expect(r.stderr).toContain(\"contract-conflict\");"	没测该层	keep	keep	—
`export =` 被剥除 ⇒ 产物 `node --check` 过；`export as namespace` 被剥除 ⇒ 产物 `node --check` 过；兜底闸门认得这两条语句（真源漏网 ⇒ 拒绝写盘 + 点名文件 + exit 1）	cli-products 聚合矩阵	没测该层	keep	keep	—
skip 函数进导出面（zod / standard / dts / guard 四面都有）；skip 函数在 --out 落盘面同样有产物（四个文件都在）	cli-products 聚合矩阵	没测该层	keep	keep	—
手写 .d.ts 在 out 目录里 ⇒ 拒绝覆盖 + exit 1 + 文件逐字不变；本工具自己生成的产物 ⇒ 允许覆盖更新（同模块重导）	cli-products 聚合矩阵	没测该层	keep	keep	—
非导出函数不进 zod / standard / guard 三面（stdout 面）；非导出函数不进任何落盘产物（--out 面）；导出面函数照常进四（闸门不误伤公开面）	cli-products 聚合矩阵	没测该层	keep	keep	—
全部未命中 ⇒ 用法错误（exit 1）+ 列出候选 + **侧车逐字不变**；未命中 ⇒ 连 dry-run 预览都不给（不产生放大作用域的 diff）；部分命中 ⇒ 未命中的名字走 `skipped <fn> (not-an-export)` 通道（与 LSP/agent 同构）；对照组：名字正确 ⇒ 只改那一个（beta 的段不被刷新）	cli-products 聚合矩阵	没测该层	keep	keep	—
目录 + --draft --json：stdout 可被 JSON.parse 解析（改前抛）；目录 + --json（print 分支）：同样是一份 JSON 数组（改前是多份拼接）；单文件 + --json：顶层仍是数组（单元素）⇒ 形态恒定；单文件 + --draft --json：顶层仍是数组（单元素）⇒ 形态恒定；非 --json 面不受影响（人类面仍是逐文件文本，不是 JSON）	cli-products 聚合矩阵	没测该层	keep	keep	—
--from-dts + --emit --draft：报互斥错误 + exit 1（改前：静默出 draft、exit 0）；--from-dts + --exit-on-diff：报前置条件错误 + exit 1（改前：静默忽略、exit 0）；--from-dts + --json：显式拒绝（机器面拿不到 JSON ⇒ 不是静默吞旗标）；控制组：--from-dts（无旗标）仍然照常出 draft 正文 + exit 0（不误伤）；控制组：--from-dts + --	cli-products 聚合矩阵	没测该层	keep	keep	—
dry-run 打 unified diff（--- a/ + ++ b/ + @@ hunk）且**不写盘**；负控制：非 dry-run 的 `--draft --write` 仍然写盘，且**不打** diff；diff 头与 `--emit --dry-run` 的头**同款**（同一个 unifiedDiff 生成器）	cli-products 聚合矩阵	没测该层	keep	keep	—
"dry-run 标签点名**侧车**（与 diff 头同口径），不再点名源文件"	"同文件另两分支（派生分支 / 写盘分支）都取**侧车** ⇒ **单点笔误**，不是取舍。 断言：expect(r.status).toBe(0);；expect(r.stdout).toContain(\"[dry-run] would update lib.nudo.js:\");"	没测该层	keep	keep	—
--json + --write：exit 1 + 机器面给出理由 + 草稿**没有**落盘；负控制：`--draft --json`（无 --write）仍然照常出审阅载荷（不误伤）；负控制：`--draft --write`（无 --json）仍然照常写盘（不误伤）	cli-products 聚合矩阵	没测该层	keep	keep	—
单文件（语法错）+ --draft --json：stdout 非空 + 合法 JSON + errors[] + exit 1；目录（好文件 + 坏文件）+ --draft --json：坏文件**不再消失**（载荷不缺项）；print 形态（--json）+ 语法错：同样有 errors 条目（机器面统一）；人类面不变：stderr 仍点名失败文件 + exit 1	cli-products 聚合矩阵	没测该层	keep	keep	—
--json --emit ⇒ stdout 是合法 JSON 且载荷是 emit 的机器文档；--json --emit --dry-run ⇒ 载荷里带 diff（与 draft 分支同构）	cli-products 聚合矩阵	没测该层	keep	keep	—
落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）；「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）；既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子；内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）；机器原稿（内容不同）+ `--force` ⇒ 覆盖成功；机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1`	cli-products 聚合矩阵	没测该层	keep	keep	—
无既有草稿 ⇒ exit 0，打 unified diff（不再是全文 dump），且**不建**草稿文件；既有草稿不同 + 无 --force ⇒ exit 1（与真写同口径），**仍**打 diff + 报拒绝 + 文件逐字不变；人工改过的草稿 + `--force` ⇒ exit 1（force 也放行不了），diff 照打、文件逐字不变；负控制：真写（无 --dry-run）遇既有不同草稿仍 exit 1、文件逐字不变，且**不打** diff	cli-products 聚合矩阵	没测该层	keep	keep	—
草稿落在**源 .d.ts 旁边**（不再是 CWD）⇒ CWD 里的同名草稿逐字不变；「next」提示**点名目标侧车路径**；目标已存在且内容不同 ⇒ **拒绝覆盖**（exit 1）+ 提示 + 既有草稿逐字不变	cli-products 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
同一份源码在两个目录下导出到同一 out 目录 ⇒ 只有一份产物	dup:cli-products 聚合矩阵	commit:14f49e20
产物 marker 不含绝对路径（同一源码 ⇒ 同一字节）	dup:cli-products 聚合矩阵	commit:14f49e20
用户导出名在 stdout 的 dts 段保持原名（不出现 *Dts 后缀）	dup:cli-products 聚合矩阵	commit:14f49e20
stdout 的 dts 段与 --out 落盘的 .d.ts 逐字相同（两条投递路径同一公开 API）	dup:cli-products 聚合矩阵	commit:14f49e20
只有再导出的模块：dts 产出再导出声明（不是「无函数」早退）	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：本地函数 + 再导出的模块两条面都在	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：真的没有导出面的模块仍如实说明（不静默零产物）	dup:cli-products 聚合矩阵	commit:14f49e20
--fn renamed ⇒ 草拟出 `export const renamed = fn(`（不再是空草稿）	dup:cli-products 聚合矩阵	commit:14f49e20
不回归 BUG-042：名字写错仍是用法错误 + 不落盘	dup:cli-products 聚合矩阵	commit:14f49e20
名字写错 ⇒ 用法错误（exit 1）+ 列出可用导出名 + **不落盘**	dup:cli-products 聚合矩阵	commit:14f49e20
--json 面：stdout 仍是**一份合法 JSON 文档**（usage-error 有条目）+ exit 1	dup:cli-products 聚合矩阵	commit:14f49e20
对照组：名字正确 ⇒ exit 0 且草稿点名该导出	dup:cli-products 聚合矩阵	commit:14f49e20
非导出的本地函数名 ⇒ 仍走**可见**的 not-an-export 条目（门禁不误伤）	dup:cli-products 聚合矩阵	commit:14f49e20
dts 面：返回位是真类型（不是 unknown），且与 dot 形态逐字一致	dup:cli-products 聚合矩阵	commit:14f49e20
zod 面：Output 是联合（不是 `z.unknown()`），且与 dot 形态逐字一致	dup:cli-products 聚合矩阵	commit:14f49e20
guard 面：校验器真的校验（不是 `return true;`），且与 dot 形态逐字一致	dup:cli-products 聚合矩阵	commit:14f49e20
违约见证不写入；固化后 check 仍绿（旧行为：check FAILED + exit 1）	dup:cli-products 聚合矩阵	commit:14f49e20
--freeze=update 不再重记违约见证（旧行为：原样重记同一条 ⇒ 永远红）	dup:cli-products 聚合矩阵	commit:14f49e20
default 函数：declare function + `export { main as default }`	dup:cli-products 聚合矩阵	commit:14f49e20
default 类：declare class + `export { Box as default }`	dup:cli-products 聚合矩阵	commit:14f49e20
单独 --format dts 同样合法（存成 .ts 也可编译）	dup:cli-products 聚合矩阵	commit:14f49e20
具名导出保持既有 `export declare function` 形态	dup:cli-products 聚合矩阵	commit:14f49e20
--from-dts + --emit/--all/--dry-run/--exit-on-diff ⇒ 用法错误（exit 1）+ 不写侧车	dup:cli-products 聚合矩阵	commit:14f49e20
--from-dts + --fn ⇒ 同样用法错误（过滤不许被吞）	dup:cli-products 聚合矩阵	commit:14f49e20
对照组：--from-dts 单独跑 ⇒ 仍出草稿（exit 0）	dup:cli-products 聚合矩阵	commit:14f49e20
机器面控制组：--from-dts + --emit + --json ⇒ 仍是合法 JSON + exit 1（绝不假绿）	dup:cli-products 聚合矩阵	commit:14f49e20
首次 --emit --all：标签行真落盘（Updated 与文件一致）；第二次逐字不变（幂等）	dup:cli-products 聚合矩阵	commit:14f49e20
--dry-run --exit-on-diff：预览与落盘同源 —— 收敛前 exit 1，收敛后 exit 0	dup:cli-products 聚合矩阵	commit:14f49e20
对照组：真有净漂移 ⇒ dry-run 打 diff 且 --exit-on-diff exit 1（门禁没被关掉）	dup:cli-products 聚合矩阵	commit:14f49e20
两个分支都命中同一导出 ⇒ 直写正文优先 + `derived-from` 标签行真落盘	dup:cli-products 聚合矩阵	commit:14f49e20
幂等：连跑两次 --emit --all ⇒ 第二次无 Updated 且 md5 不变	dup:cli-products 聚合矩阵	commit:14f49e20
收敛后 --dry-run --exit-on-diff ⇒ exit 0，且不再打印永不落盘的 diff	dup:cli-products 聚合矩阵	commit:14f49e20
预览 == 写盘（字节级）：dry-run 的新增行拼起来就是真实写盘内容	dup:cli-products 聚合矩阵	commit:14f49e20
`export =` 被剥除 ⇒ 产物 `node --check` 过	dup:cli-products 聚合矩阵	commit:14f49e20
`export as namespace` 被剥除 ⇒ 产物 `node --check` 过	dup:cli-products 聚合矩阵	commit:14f49e20
兜底闸门认得这两条语句（真源漏网 ⇒ 拒绝写盘 + 点名文件 + exit 1）	dup:cli-products 聚合矩阵	commit:14f49e20
skip 函数进导出面（zod / standard / dts / guard 四面都有）	dup:cli-products 聚合矩阵	commit:14f49e20
skip 函数在 --out 落盘面同样有产物（四个文件都在）	dup:cli-products 聚合矩阵	commit:14f49e20
手写 .d.ts 在 out 目录里 ⇒ 拒绝覆盖 + exit 1 + 文件逐字不变	dup:cli-products 聚合矩阵	commit:14f49e20
本工具自己生成的产物 ⇒ 允许覆盖更新（同模块重导）	dup:cli-products 聚合矩阵	commit:14f49e20
非导出函数不进 zod / standard / guard 三面（stdout 面）	dup:cli-products 聚合矩阵	commit:14f49e20
非导出函数不进任何落盘产物（--out 面）	dup:cli-products 聚合矩阵	commit:14f49e20
导出面函数照常进四（闸门不误伤公开面）	dup:cli-products 聚合矩阵	commit:14f49e20
全部未命中 ⇒ 用法错误（exit 1）+ 列出候选 + **侧车逐字不变**	dup:cli-products 聚合矩阵	commit:14f49e20
未命中 ⇒ 连 dry-run 预览都不给（不产生放大作用域的 diff）	dup:cli-products 聚合矩阵	commit:14f49e20
部分命中 ⇒ 未命中的名字走 `skipped <fn> (not-an-export)` 通道（与 LSP/agent 同构）	dup:cli-products 聚合矩阵	commit:14f49e20
对照组：名字正确 ⇒ 只改那一个（beta 的段不被刷新）	dup:cli-products 聚合矩阵	commit:14f49e20
目录 + --draft --json：stdout 可被 JSON.parse 解析（改前抛）	dup:cli-products 聚合矩阵	commit:14f49e20
目录 + --json（print 分支）：同样是一份 JSON 数组（改前是多份拼接）	dup:cli-products 聚合矩阵	commit:14f49e20
单文件 + --json：顶层仍是数组（单元素）⇒ 形态恒定	dup:cli-products 聚合矩阵	commit:14f49e20
单文件 + --draft --json：顶层仍是数组（单元素）⇒ 形态恒定	dup:cli-products 聚合矩阵	commit:14f49e20
非 --json 面不受影响（人类面仍是逐文件文本，不是 JSON）	dup:cli-products 聚合矩阵	commit:14f49e20
--from-dts + --emit --draft：报互斥错误 + exit 1（改前：静默出 draft、exit 0）	dup:cli-products 聚合矩阵	commit:14f49e20
--from-dts + --exit-on-diff：报前置条件错误 + exit 1（改前：静默忽略、exit 0）	dup:cli-products 聚合矩阵	commit:14f49e20
--from-dts + --json：显式拒绝（机器面拿不到 JSON ⇒ 不是静默吞旗标）	dup:cli-products 聚合矩阵	commit:14f49e20
控制组：--from-dts（无旗标）仍然照常出 draft 正文 + exit 0（不误伤）	dup:cli-products 聚合矩阵	commit:14f49e20
控制组：--from-dts + --write 仍然可用（合法组合，不被校验误伤）	dup:cli-products 聚合矩阵	commit:14f49e20
控制组：非 from-dts 模式的既有校验不变（--emit/--draft 互斥仍报同一句）	dup:cli-products 聚合矩阵	commit:14f49e20
dry-run 打 unified diff（--- a/ + ++ b/ + @@ hunk）且**不写盘**	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：非 dry-run 的 `--draft --write` 仍然写盘，且**不打** diff	dup:cli-products 聚合矩阵	commit:14f49e20
diff 头与 `--emit --dry-run` 的头**同款**（同一个 unifiedDiff 生成器）	dup:cli-products 聚合矩阵	commit:14f49e20
--json + --write：exit 1 + 机器面给出理由 + 草稿**没有**落盘	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：`--draft --json`（无 --write）仍然照常出审阅载荷（不误伤）	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：`--draft --write`（无 --json）仍然照常写盘（不误伤）	dup:cli-products 聚合矩阵	commit:14f49e20
单文件（语法错）+ --draft --json：stdout 非空 + 合法 JSON + errors[] + exit 1	dup:cli-products 聚合矩阵	commit:14f49e20
目录（好文件 + 坏文件）+ --draft --json：坏文件**不再消失**（载荷不缺项）	dup:cli-products 聚合矩阵	commit:14f49e20
print 形态（--json）+ 语法错：同样有 errors 条目（机器面统一）	dup:cli-products 聚合矩阵	commit:14f49e20
人类面不变：stderr 仍点名失败文件 + exit 1	dup:cli-products 聚合矩阵	commit:14f49e20
--json --emit ⇒ stdout 是合法 JSON 且载荷是 emit 的机器文档	dup:cli-products 聚合矩阵	commit:14f49e20
--json --emit --dry-run ⇒ 载荷里带 diff（与 draft 分支同构）	dup:cli-products 聚合矩阵	commit:14f49e20
落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）	dup:cli-products 聚合矩阵	commit:14f49e20
「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）	dup:cli-products 聚合矩阵	commit:14f49e20
既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子	dup:cli-products 聚合矩阵	commit:14f49e20
内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）	dup:cli-products 聚合矩阵	commit:14f49e20
机器原稿（内容不同）+ `--force` ⇒ 覆盖成功	dup:cli-products 聚合矩阵	commit:14f49e20
机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1` ⇒ 覆盖成功（环境变量口子同样是真的）	dup:cli-products 聚合矩阵	commit:14f49e20
人工改过的草稿 ⇒ `--force` **也不放行**（逐字不变 + exit 1）	dup:cli-products 聚合矩阵	commit:14f49e20
无既有草稿 ⇒ exit 0，打 unified diff（不再是全文 dump），且**不建**草稿文件	dup:cli-products 聚合矩阵	commit:14f49e20
既有草稿不同 + 无 --force ⇒ exit 1（与真写同口径），**仍**打 diff + 报拒绝 + 文件逐字不变	dup:cli-products 聚合矩阵	commit:14f49e20
人工改过的草稿 + `--force` ⇒ exit 1（force 也放行不了），diff 照打、文件逐字不变	dup:cli-products 聚合矩阵	commit:14f49e20
负控制：真写（无 --dry-run）遇既有不同草稿仍 exit 1、文件逐字不变，且**不打** diff	dup:cli-products 聚合矩阵	commit:14f49e20
草稿落在**源 .d.ts 旁边**（不再是 CWD）⇒ CWD 里的同名草稿逐字不变	dup:cli-products 聚合矩阵	commit:14f49e20
「next」提示**点名目标侧车路径**	dup:cli-products 聚合矩阵	commit:14f49e20
目标已存在且内容不同 ⇒ **拒绝覆盖**（exit 1）+ 提示 + 既有草稿逐字不变	dup:cli-products 聚合矩阵	commit:14f49e20
```
