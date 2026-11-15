# packages/nudojs/src/__tests__/cli-contract.test.ts

模块套件：42 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"侧车契约的形参进求值（不再回落 any）"	"`nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` / 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型： check → g(x: number) => string check --abs → g(any) => any （旧行为） 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值 （core `effectiveContract` + `constraintToEntryAbs`，与 `checkSour"	没测该层	keep	keep	—
"算术函数的返回值随契约收窄（旧行为 number | string）"	"`nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` / 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型： check → g(x: number) => string check --abs → g(any) => any （旧行为） 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值 （core `effectiveContract` + `constraintToEntryAbs`，与 `checkSour"	没测该层	keep	keep	—
"没有契约的文件：--abs 行为不变（不误伤）"	"`nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` / 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型： check → g(x: number) => string check --abs → g(any) => any （旧行为） 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值 （core `effectiveContract` + `constraintToEntryAbs`，与 `checkSour"	没测该层	keep	keep	—
"CLI 级：签名表与 --abs 面给出同一个形参类型"	"`nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` / 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型： check → g(x: number) => string check --abs → g(any) => any （旧行为） 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值 （core `effectiveContract` + `constraintToEntryAbs`，与 `checkSour"	没测该层	keep	keep	—
"print：stderr 报同码 error，但 exit 0（§1.3 只在用法 / IO 错误时 exit 1）"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--json：同样 exit 0，conflict 字段照旧透出"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"好侧车对照：exit 0 + [handwritten]，stderr 无 contract-load"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"print：stderr 报同码 + exit 1"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--json：stderr + exit 1，载荷带 diagnostics 字段"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--draft：stderr 报同码 + exit 1（不再按「无契约」静默起草）"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--fn add 只输出 add；--all 全量"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--fn 未命中 / --fn + --all 组合：显式 usage error + exit 1"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"--write：beta 指向 b.d.ts 自己的模块侧车，不再只给第一个文件"	"旧提示「copy accepted exports into <anchor>」不再出现 缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"单文件模式：next 提示逐字不变（既有钉不回退）"	"缺陷分册 04-contract-command · CLI 回归（）。 CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物）， 目标文件用绝对路径传给 CLI。"	没测该层	keep	keep	—
"stderr 上屏 nudo:contract-conflict 且 exit 1"	"真实诊断带上函数名与冲突的参数位 不发布产物（stdout 面空） 源码契约（正数）与同名侧车（非正数）矛盾 ⇒ 合取不可满足。"	夹具漏形态	keep	keep	—
"--out 落盘面同样不落任何产物"	"源码契约（正数）与同名侧车（非正数）矛盾 ⇒ 合取不可满足。"	夹具漏形态	keep	keep	—
"诊断码与 check 面同码"	"源码契约（正数）与同名侧车（非正数）矛盾 ⇒ 合取不可满足。"	夹具漏形态	keep	keep	—
"zod 返回面不再是「无约束入口」观测（不再是 number | string）"	"契约域种子重算 ⇒ 返回位是 number（改前是无约束入口观测 number | string） 有**参数契约、无返回契约**时，返回面回退到**无约束**的 `entry@` 观测（缺 dts 面的种子重算）⇒ 返回位毫无信息，且与 dts / check 面矛盾。 症状（改前）：`@nudo:contract x num`（无返回契约）的函数，zod 面的 `<fn>Output` = `z.union([z.number()…, z.string()])`（**无约束入口**观测） 而 dts 面（做了契"	没测该层	keep	keep	—
"dts 面与 zod 面同口径（返回位都是契约域的 number）"	"有**参数契约、无返回契约**时，返回面回退到**无约束**的 `entry@` 观测（缺 dts 面的种子重算）⇒ 返回位毫无信息，且与 dts / check 面矛盾。 症状（改前）：`@nudo:contract x num`（无返回契约）的函数，zod 面的 `<fn>Output` = `z.union([z.number()…, z.string()])`（**无约束入口**观测） 而 dts 面（做了契约种子重算）是 `g(x: number): number` ⇒ 两个产物面矛盾， 运行时校验器还会"	没测该层	keep	keep	—
"stderr 上屏 nudo:contract-load 且 exit 1"	"真实原因上屏（侧车路径 + 失败原因） 不发布产物（stdout 面空） 侧车在装载期抛错 ⇒ `nudo:contract-load`（契约整条丢失）。"	没测该层	keep	keep	—
"--out 落盘面同样不落任何产物"	"侧车在装载期抛错 ⇒ `nudo:contract-load`（契约整条丢失）。"	没测该层	keep	keep	—
"诊断文案与 check 面同码同因（nudo check 也报 contract-load）"	"侧车在装载期抛错 ⇒ `nudo:contract-load`（契约整条丢失）。"	没测该层	keep	keep	—
"stderr 上屏 nudo:contract-param-mismatch 且 exit 1"	"契约说 a，函数签名是 y ⇒ 形参名对不上 @nudo:contract x positive / 真实诊断带上函数名与错位的形参名 不发布产物（stdout 面空） 契约形参名与声明形参表**对不上**时，export 面照样发布产物 （zod 面把契约位的名字原样搬进 `<fn>Input` ⇒ 消费方拿到一个**参数名与函数 签名不一致**的校验器），且 stderr **一个字都没有**。 根因：export 面不看 check 面的契约一致性诊断（`nudo:contract-param-mismatc"	没测该层	keep	keep	—
"--out 落盘面同样不落任何产物"	"契约形参名与声明形参表**对不上**时，export 面照样发布产物 （zod 面把契约位的名字原样搬进 `<fn>Input` ⇒ 消费方拿到一个**参数名与函数 签名不一致**的校验器），且 stderr **一个字都没有**。 根因：export 面不看 check 面的契约一致性诊断（`nudo:contract-param-mismatch` 只在 check 面产出）⇒ 契约与产物面对不上时无人上屏。"	没测该层	keep	keep	—
"guard 不再收窄成观测字面量（改前：data === 0.5）"	"改前 guard = `data === 0.5`（观测字面量）；"	夹具漏形态	keep	keep	—
"guard 与 zod 面同一出口域（zod = 契约域，guard = 契约域）"	"zod 面（契约域）：Output = number [0,1] guard 面（契约域）：同一出口域，不再是单点字面量 改前 guard = `data === 0.5`（观测字面量）；"	夹具漏形态	keep	keep	—
"契约允许的值（0.7）guard 接受（改前：guard 拒绝，zod 接受）"	"症状（改前，夹具 = 返回契约 number[0,1] + case 见证 0.5）： zod 面 → `clamp01Output = z.number().gte(0).lte(1)`（契约域） guard 面 → `return data === 0.5; 根因：guard 分支取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`）， 绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。"	夹具漏形态	keep	keep	—
"zod 面判同一组值 ⇒ 与 guard 面裁决一致（不再一个接受一个拒绝）"	"zod 面 = 契约域（number[0,1]） guard 面 = 同一出口域（改前是 `data === 0.5` ⇒ 对 0.7 拒绝） 症状（改前，夹具 = 返回契约 number[0,1] + case 见证 0.5）： zod 面 → `clamp01Output = z.number().gte(0).lte(1)`（契约域） guard 面 → `return data === 0.5; 根因：guard 分支取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.a"	夹具漏形态	keep	keep	—
"守卫源码不再是单点字面量判定（改前：data === 0.5）"	"症状（改前，夹具 = 返回契约 number[0,1] + case 见证 0.5）： zod 面 → `clamp01Output = z.number().gte(0).lte(1)`（契约域） guard 面 → `return data === 0.5; 根因：guard 分支取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`）， 绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。"	夹具漏形态	keep	keep	—
"guard 产物只有导出面函数的守卫（改前：内部函数也出守卫）"	"夹具：一个导出函数 + 一个**未导出**的模块内部函数（两者都有 case 见证）"	夹具漏形态	keep	keep	—
"guard 面与 dts 面口径一致（都只认导出面）"	"夹具：一个导出函数 + 一个**未导出**的模块内部函数（两者都有 case 见证）"	夹具漏形态	keep	keep	—
"文本面：Summary 的 N == 明细行「N @generated slot(s)」"	"旧行为：明细 4 / 摘要 1（「1 个文件」被印成「1 个槽」） 同文件两个 `@generated` 段都陈旧（各 2 个槽 ⇒ 4 个槽）"	没测该层	keep	keep	—
"--json 面：summary.contractDrift == files[].contractDrift（同一数字）"	"同文件两个 `@generated` 段都陈旧（各 2 个槽 ⇒ 4 个槽）"	没测该层	keep	keep	—
"跨文件调用点证据在场 ⇒ 报 contract drift + exit 1（旧行为：0 drift / exit 0）"	"陈旧的生成段：返回仍是 lit(6)，今日应是 \"5!\""	没测该层	keep	keep	—
"--json 面：summary.contractDrift > 0（机器面同源）"	"陈旧的生成段：返回仍是 lit(6)，今日应是 \"5!\""	没测该层	keep	keep	—
"文本面：报 contract drift + exit 1（不得 0 contract drift / Result: OK）"	"陈旧生成段：断言返回 lit(99)，与今日推断不符"	没测该层	keep	keep	—
"--json 面：contractDrift ≥ 1"	"陈旧生成段：断言返回 lit(99)，与今日推断不符"	没测该层	keep	keep	—
"跨动词同口径：nudo check 对同一文件同样报 nudo:contract-drift"	"陈旧生成段：断言返回 lit(99)，与今日推断不符"	没测该层	keep	keep	—
"standard 面仍产出参数位（<fn>_<param>）"	"`nudo export --format standard` 在「**只有返回契约**」时整份参数面 丢失（standard 面一个 `<fn>_<param>` 导出都不产）⇒ 同一次导出里 zod / dts / standard 三个方言的**参数个数互相矛盾**。 该缺陷已修（standard 面的参数位统一取统一参数面 `paramExps`，契约返回位不再 压掉观测参数位）——本文件只补**跨方言一致性回归钉**，防止再次回退。"	没测该层	keep	keep	—
"跨方言参数个数一致（zod 槽数 == dts 形参数 == standard 参数导出数）"	"`nudo export --format standard` 在「**只有返回契约**」时整份参数面 丢失（standard 面一个 `<fn>_<param>` 导出都不产）⇒ 同一次导出里 zod / dts / standard 三个方言的**参数个数互相矛盾**。 该缺陷已修（standard 面的参数位统一取统一参数面 `paramExps`，契约返回位不再 压掉观测参数位）——本文件只补**跨方言一致性回归钉**，防止再次回退。"	没测该层	keep	keep	—
"zod 返回面：违约的契约不投影（回落实现实际返回）"	"导出面把**契约返回约束**当「已证成的事实」直接投影：投影前没有 复核实现 ⇒ 产物声明一个实现**可被证否**的返回类型。 症状（改前）：`@nudo:contract return txt`（string）而实现返回入参（number） ⇒ zod 面产出 `fOutput = z.string()`、dts 面产出 `export declare function f(x: number): string;"	没测该层	keep	keep	—
"dts 返回类型与实现一致（不是被证否的契约）"	"导出面把**契约返回约束**当「已证成的事实」直接投影：投影前没有 复核实现 ⇒ 产物声明一个实现**可被证否**的返回类型。 症状（改前）：`@nudo:contract return txt`（string）而实现返回入参（number） ⇒ zod 面产出 `fOutput = z.string()`、dts 面产出 `export declare function f(x: number): string;"	没测该层	keep	keep	—
```
