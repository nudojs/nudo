```audit
title	rootCause	gap	action	status	evidence
具名/别名导入归因类模块并合成 call@；命名空间形态按成员名；他模块调用不挂本文件	去重/槽/类导入表	没测该层	keep	keep	—
槽字面量不符不满足；相符满足；类型槽满足	去重/槽/类导入表	没测该层	keep	keep	—
对象/嵌套/字符串槽不符报；类型槽、顶层字面量、数组元素口径不变	去重/槽/类导入表	没测该层	keep	keep	—
不同调用点两条见证（顺序无关，同行不同列也算）；同点重复采集去重为一条	去重/槽/类导入表	没测该层	keep	keep	—
trimLeft/trimRight ⇒ label: string()；includes 推不出（负控）	码归因/建议/body-read 表	没测该层	keep	keep	—
suggestion 按种类：重复/导出缺失/文件缺失	码归因/建议/body-read 表	没测该层	keep	keep	—
文件缺失 module-missing error（分析与门禁面同口径）且不被改成 mock-invalid	码归因/建议/body-read 表	没测该层	keep	keep	—
重复声明 mock-invalid warning 且不冒充 module-missing；单条零误报	码归因/建议/body-read 表	没测该层	keep	keep	—
A→B→A 预算与会话 LRU 回到 A；无 nudo 回落默认；重复稳定；env 压过配置	include/预算矩阵	没测该层	keep	keep	—
目录/文件/glob/多条/空/排除的命中矩阵	include/预算矩阵	没测该层	keep	keep	—
推导失败 number/any 都 unchecked；成功不符 failed；无期望 no-expectation；never failed	去重/may-throw/opaque/unchecked 表	没测该层	keep	keep	—
推导失败只发 opaque info；成功不符报 case-expected；成功相符都不发	去重/may-throw/opaque/unchecked 表	没测该层	keep	keep	—
case/函数/侧车申报豁免；未申报与 kind 不覆盖仍报；Error 族覆盖不报；坏侧车 contract-load	去重/may-throw/opaque/unchecked 表	没测该层	keep	keep	—
同值只告警一次；不同值各一次；合法值不告警；非法值回落可用档	去重/may-throw/opaque/unchecked 表	没测该层	keep	keep	—
模块级状态每入口独立；声明式 case / 无状态 / 未改写负控	entryThrows/谓词/隔离表	没测该层	keep	keep	—
满足谓词无诊断；违反谓词/类型不符仍报；无谓词口径不变	entryThrows/谓词/隔离表	没测该层	keep	keep	—
strict/无 profile 非法值文案 error；合法值与 profile 预设不告警	entryThrows/谓词/隔离表	没测该层	keep	keep	—
点名声明落在自己前面；两条都 applied	截断/锚点表	没测该层	keep	keep	—
假设落在被点名声明自己的行；行尾注释不消费；未声明进 unapplied	截断/锚点表	没测该层	keep	keep	—
自递归一条 info 锚函数声明；cycle 措辞；无截断零误报	截断/锚点表	没测该层	keep	keep	—
恒真循环一条 info 锚文件起点；措辞 iteration budget；无截断零误报	截断/锚点表	没测该层	keep	keep	—
依赖调用不贴现场文件；同号不同列保留现场调用	观测/顺序/见证表	没测该层	keep	keep	—
同行两调用点加列维度；唯一调用点格式不变；列缺失退回序号	观测/顺序/见证表	没测该层	keep	keep	—
先定义不截断；顺序无关 combined 一致；有调用点不再误报 entry-only	观测/顺序/见证表	没测该层	keep	keep	—
调用点字面量投影基类型；带断言 case 保留字面量	观测/顺序/见证表	没测该层	keep	keep	—
全部超限整组跳过；正常记录照常合成	归因/超限表	没测该层	keep	keep	—
ESM/CJS 命名空间带接收者限定并可归因；具名/对象方法无前缀；产品面 error	归因/超限表	没测该层	keep	keep	—
"两个现场文件同行的调用 → 见证名不同（改前都是 call@L2）"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`； 断言：expect(names.length).toBe(2);；expect(new Set(names).size).toBe(2);"	夹具漏形态	keep	keep	—
"负控制：本地调用点的见证名保持 call@L<n>（与既有已固化名字兼容）"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`； 断言：expect(names).toEqual([\"call@L2\"]);"	夹具漏形态	keep	keep	—
"emitter：已有同名见证不重复写；新见证照写（不再整函数丢弃）"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`； 断言：expect(base).toBeDefined();；expect(withFrozen.source).toContain('\"call@b.js:L2\"');"	夹具漏形态	keep	keep	—
"接线：已固化函数的**新增外部调用点**也合成 call@ 见证"	"固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号 ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。 根因： - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在 同一行调用同一函数 → 同名 `call@L2`； 断言：expect(names).toContain(\"call@b.js:L2\");"	夹具漏形态	keep	keep	—
"声明式 @nudo:case 的求值结果不变"	"找出 nudo:case-expected 诊断（期望不满足）。 断言：expect(shapes.add).toBe(\"2\");"	没测该层	keep	keep	—
"无模块级状态的模块，入口用例结果不变"	"断言：expect(shapes.g).toBe('\"ok\"');"	没测该层	keep	keep	—
"模块级状态未被改写时，读到的就是初值"	"断言：expect(shapes.read).toBe(\"7\");"	没测该层	keep	keep	—
"实例方法：见证求值出确切值 1（改前恒 unknown）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`； 断言：expect(fn).toBeDefined();；expect(c).toBeDefined();"	没测该层	keep	keep	—
"实例方法：见证实参参与运算（(1) => 2）"	"断言：expect(t?.op === \"lit\" ? t.value : undefined).toBe(2);"	没测该层	keep	keep	—
"负控制：顶层函数同款 case 口径不变（结果 1）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`； 断言：expect(t?.op === \"lit\" ? t.value : undefined).toBe(1);"	没测该层	keep	keep	—
"负控制：判不出来时如实回落 unknown（不编造值）"	"**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown` → 任何期望都必假红（顶层函数同款 case 却通过）。 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当 **源码里的被调表达式**传给 `tryEvalCallFull`； 断言：expect(c!.abs.shape.k).toBe(\"unknown\");"	没测该层	keep	keep	—
"模块状态不同：见证值 = 现场观测值 6（改前被重算成 1）"	"合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出 的调用点真值与实际调用结果矛盾（错误的确切值）。 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension` 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值） 被目标语境（被分析文件语境）的值顶掉。 断言：expect(values).toEqual([5, 6]);"	没测该层	keep	keep	—
"负控制：无状态差异的调用点值不变（3）"	"合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出 的调用点真值与实际调用结果矛盾（错误的确切值）。 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension` 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值） 被目标语境（被分析文件语境）的值顶掉。 断言：expect(ct?.op === \"lit\" ? ct.value : undefined).toBe(3);"	没测该层	keep	keep	—
"export * barrel：记录归因到定义文件，domain-exceeds 门禁照报"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件； 断言：expect(rec).toBeDefined();；expect(rec!.targetModule).toBe(lib);"	没测该层	keep	keep	—
"改名再导出 barrel（export { area as area2 }）：记录名跟到定义侧导出名"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件； 断言：expect(rec).toBeDefined();；expect(rec!.targetModule).toBe(lib);"	没测该层	keep	keep	—
"负控制：直接 import（无 barrel）行为不变——门禁照报"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件； 断言：expect(rec!.targetModule).toBe(lib);；expect(result.diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(1);"	没测该层	keep	keep	—
"负控制：别处的记录不得在本文件报门禁（跨文件污染守卫）"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件； 断言：expect(result.diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(0);"	没测该层	keep	keep	—
"负控制：模块未导出该名 → 回落 import 目标（不猜、不崩）"	"`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒ `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方 import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件； 断言：expect(rec).toBeDefined();；expect(rec!.targetModule).toBe(barrel);"	没测该层	keep	keep	—
"anchors the dual-entry issue on line 1 (not the line-0 placeholder)"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。 断言：expect(issue).not.toBeNull();；expect(issue!.line).toBe(1);"	没测该层	keep	keep	—
"anchors the node face on line 1 too (both variants)"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。 断言：expect(issue).not.toBeNull();；expect(issue!.line).toBe(1);"	没测该层	keep	keep	—
"keeps the legacy browser-field package shape anchored"	"\\\"] 命中整个子树，不命中 lib\", () => { const dir = project([\"src/**\"]); it(\"include: [\\\"src/*.js\\\"] 不跨 /（段内通配）\", () => { const dir = project([\"src/*.js\"]); 断言：expect(issue).not.toBeNull();；expect(issue!.line).toBe(1);"	没测该层	keep	keep	—
"negative control: single-entry package still yields no issue at all"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。 断言：expect(entryVariantIssueForFile(join(dir, \"index.js\"))).toBeNull();"	没测该层	keep	keep	—
"negative control: non-entry helper inside a dual package yields no issue"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。 断言：expect(entryVariantIssueForFile(join(dir, \"lib\", \"helper.js\"))).toBeNull();"	没测该层	keep	keep	—
"analyzeFile 的 dual-entry 诊断落在第 1 行（不是 line 0 占位）"	"下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。 断言：expect(d).toBeDefined();；expect(d!.range.start.line).toBeGreaterThanOrEqual(1);"	没测该层	keep	keep	—
"跨模块：display 由求值面合成，与 resultAbs / nudo check 签名一致"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。 断言：expect(fn).toBeDefined();；expect(entry).toBeDefined();"	没测该层	keep	keep	—
"负控制：同模块（符号面有效）display 保持符号面形态"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。 断言：expect(entry!.intension?.display).toBe(\"inner2: () => 7\");"	没测该层	keep	keep	—
"负控制：真推断失败时 display 仍如实说 unknown（与 payload 一致）"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。 断言：expect(entry).toBeDefined();；expect(entry!.intension?.abs).toContain(\"unknown\");"	没测该层	keep	keep	—
"不变量：任何 case 的 display 不得与同一条 payload 的 abs 矛盾"	"根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面** （generalizeFromAst → formatPoly），`abs` 走**求值面**； 跨模块时被调方是 import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值 面有确切的 7。 断言：expect(display, `${fn.name}/${c.name}`).not.toContain(\"unknown\");"	没测该层	keep	keep	—
"does not launder an unrecognized name into any()"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法 连 `nudo:di"	没测该层	keep	keep	—
"does not launder a TS type reference (T.*) into any()"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法 连 `nudo:di"	没测该层	keep	keep	—
"echoes the actual injection instead of the user text when degraded"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法 连 `nudo:di"	没测该层	keep	keep	—
"degrades a union with one unrecognized member as a whole"	"回归：引擎「放弃求值」必须在 **test 面可观测**。 症状（修前）：同一份递归源码，`nudo check` / `nudo health` 都报「求值被 截断」，而 `nudo test`（人类面 + `--json`）**零诊断** —— 把放宽后的类型 （`0 | number | string`）当一次正常观测打印，断言段还报「0 failed」全绿。 断言：expect(source).toContain(\"// @nudo:as unknown\");；expect(source).not.toContain(\"union(\");"	没测该层	keep	keep	—
"negative control: expressible expressions keep their mapping and echo"	"回归：被调方的**调用点域**不得被「首次 settle」截断。 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 —— 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接 产出假红。 断言：expect(typeExprToDirective(\"number\")).toBe(\"number()\");；expect(typeExprToDirective(\"stri"	没测该层	keep	keep	—
"negative control: explicit unknown / any stay expressible (no degradation note)"	"what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报 「Bindings applied: <用户原文>」——报告与实际注入不符。 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）： `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` / 裸名字**全是同一个 Abs** `{k:\"unknown\"}` ⇒ 洗成 `any()` 既不改变推断结果， 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法 连 `nudo:di"	没测该层	keep	keep	—
"negative control: bindings with no top-level declaration stay unapplied"	"\\\"] 命中整个子树，不命中 lib\", () => { const dir = project([\"src/**\"]); it(\"include: [\\\"src/*.js\\\"] 不跨 /（段内通配）\", () => { const dir = project([\"src/*.js\"]); 断言：expect(applied).toEqual([]);；expect(unapplied).toEqual([\"nope\"]);"	没测该层	keep	keep	—
"函数体内调用：被调方有 call@ 见证（改前只有 entry@）"	"调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records； 断言：expect(names.some((n) => n.startsWith(\"call@\"))).toBe(true);；expect(names.some((n) => n.startsWith(\"entry@\"))).toBe(fal"	没测该层	keep	keep	—
"负控制：顶层调用点口径不变（call@ 见证仍在）"	"调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records； 断言：expect(names.some((n) => n.startsWith(\"call@\"))).toBe(true);；expect(names.some((n) => n.startsWith(\"entry@\"))).toBe(fal"	没测该层	keep	keep	—
"负控制：非导出函数口径不变（保留 entry@ 见证）"	"调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）： `call@` 合成只消费**外部传入**的 records； 断言：expect(names.some((n) => n.startsWith(\"entry@\"))).toBe(true);"	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
ESM `import * as dep`：记录名带接收者限定，且归因到被调模块	dup:归因/超限表	commit:75e79cab
CJS `const dep = require(...)`：同样带接收者限定且可归因	dup:归因/超限表	commit:75e79cab
负控制：具名导入的记录名保持原样（不加前缀）	dup:归因/超限表	commit:75e79cab
负控制：对象字面量方法调用不被误加接收者限定	dup:归因/超限表	commit:75e79cab
产品面：注入后 nudo:contract-domain-exceeds 必须是 error（不再是假绿）	dup:归因/超限表	commit:75e79cab
产品面：CJS 命名空间形态同样报 error	dup:归因/超限表	commit:75e79cab
组内记录全部超限 ⇒ 整组跳过（不抛、不产出残缺分析）	dup:归因/超限表	commit:75e79cab
对照组：正常记录照常合成（口径不变）	dup:归因/超限表	commit:75e79cab
调用点字面量实参 ⇒ 投影成基类型（不是 lit(N)）	dup:观测/顺序/见证表	commit:342167e1
对照组：带断言的 @nudo:case 是域声明 ⇒ 字面量保留	dup:观测/顺序/见证表	commit:342167e1
被调方先定义：三个调用点全部留证（不再只剩第一条）	dup:观测/顺序/见证表	commit:342167e1
两种声明顺序的调用点域与 combinedAbs 完全一致	dup:观测/顺序/见证表	commit:342167e1
有调用点域的被调方不再误报 nudo:contract-entry-only	dup:观测/顺序/见证表	commit:342167e1
同一行两个调用点 ⇒ 名字不同（加列维度），且各自可核对到列	dup:观测/顺序/见证表	commit:342167e1
对照组：唯一调用点的名字格式不变（既有固化见证不漂移）	dup:观测/顺序/见证表	commit:342167e1
三个及以上同行调用点：列缺失时退回序号（仍唯一）	dup:观测/顺序/见证表	commit:342167e1
依赖模块里的调用不得带现场文件（行号落在注释行）	dup:观测/顺序/见证表	commit:342167e1
同号不同列（collide）⇒ 现场调用保留现场文件，依赖调用不贴	dup:观测/顺序/见证表	commit:342167e1
恒具体真的循环产出 nudo:loop-truncated（info，锚在函数声明处）	dup:截断/锚点表	commit:72990e36
无截断文件零误报	dup:截断/锚点表	commit:72990e36
自递归截断产出 nudo:recursion-truncated（info，锚在函数声明处）	dup:截断/锚点表	commit:72990e36
无截断文件零误报	dup:截断/锚点表	commit:72990e36
假设落在被点名的声明**自己**的那一行（不是上一行）	dup:截断/锚点表	commit:72990e36
负控制：行尾注释不是指令 ⇒ 不得被当成行内指令消费	dup:截断/锚点表	commit:72990e36
负控制：不是顶层声明的名字仍进 unapplied	dup:截断/锚点表	commit:72990e36
点名的声明落在**自己**的前面（不被同行的前一条声明吃掉）	dup:截断/锚点表	commit:72990e36
同行两条声明各自被点名 ⇒ 两条都 applied（不再有「丢弃 + 编造理由」）	dup:截断/锚点表	commit:72990e36
非法 entryThrows + adoption profile：文案说 warning（生效值也是 warning）	dup:entryThrows/谓词/隔离表	commit:00164a1e
非法 entryThrows + strict profile：文案说 error（生效值也是 error）	dup:entryThrows/谓词/隔离表	commit:00164a1e
非法 entryThrows + 无 profile：回默认 error，文案说 error	dup:entryThrows/谓词/隔离表	commit:00164a1e
合法 entryThrows：不告警，且显式值压过 profile	dup:entryThrows/谓词/隔离表	commit:00164a1e
无 check 段 / 无 entryThrows：不告警，默认 error	dup:entryThrows/谓词/隔离表	commit:00164a1e
profile 预设本身仍生效（adoption→warning / strict→error），无告警	dup:entryThrows/谓词/隔离表	commit:00164a1e
满足谓词：期望 number().gt(0)，实际 2 → 无 nudo:case-expected	dup:entryThrows/谓词/隔离表	commit:00164a1e
负控制：违反谓词（期望 number().gt(5)，实际 2）→ 仍报 nudo:case-expected	dup:entryThrows/谓词/隔离表	commit:00164a1e
负控制：无谓词的期望（number()）口径不变 → 无诊断	dup:entryThrows/谓词/隔离表	commit:00164a1e
负控制：类型不匹配的期望（string()）→ 仍报 nudo:case-expected	dup:entryThrows/谓词/隔离表	commit:00164a1e
非导出辅助函数改写模块级状态后，导出函数的入口用例仍从初值起算	dup:entryThrows/谓词/隔离表	commit:00164a1e
多个导出函数的入口用例互不串味（各自独立实例）	dup:entryThrows/谓词/隔离表	commit:00164a1e
同一非法值在多次 checkConfig 调用里只告警一次	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：不同非法值各告警一次（去重键含值）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：合法值不告警	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
非法值仍回落可用档位（告警文案里的 using 段与生效档一致）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
case 上的 `!! throws TypeError` ⇒ 不发 nudo:may-throw	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
函数级 `@nudo:throws TypeError` ⇒ 不发 nudo:may-throw	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
侧车 `fn(…, { throws: "TypeError" })` ⇒ 不发 nudo:may-throw	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：未申报 ⇒ 仍发 nudo:may-throw（口径不变）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：申报的 kind 不覆盖实测 kind（RangeError vs TypeError）⇒ 仍发	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：申报 Error（族）覆盖实测 TypeError ⇒ 不发	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：坏侧车 ⇒ nudo:contract-load 仍报（memo 化不得吞掉加载失败）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
推导失败 + 期望 number() ⇒ 只有 nudo:opaque-result，且严重度是 info	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
推导失败 + 期望 any() ⇒ 同上（不放宽的期望不得空洞通过）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：推导成功 + 期望不符 ⇒ 仍是 nudo:case-expected（error）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：推导成功 + 期望相符 ⇒ 两者都不产出	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
推导失败 + 期望 number() ⇒ unchecked（不是 failed）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
推导失败 + 期望 any() ⇒ 同样 unchecked（不是空洞 passed）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：推导成功 + 期望不符 ⇒ 仍是 failed（既有行为不变）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：声明了但没写期望 ⇒ no-expectation 口径不变	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
负控制：抛错（实测 never）⇒ 仍是 failed（never 不是「推导失败」）	dup:去重/may-throw/opaque/unchecked 表	commit:d9bc7de9
include: ["src"] 命中 src 下的文件（改前：永不命中 → 白名单作废）	dup:include/预算矩阵	commit:2e09de7f
include: ["src"] 不命中 src-other / lib（字面量不是子串搜索）	dup:include/预算矩阵	commit:2e09de7f
include: ["src/a.js"] 只命中这一个文件	dup:include/预算矩阵	commit:2e09de7f
include: ["src/**"] 命中整个子树，不命中 lib	dup:include/预算矩阵	commit:2e09de7f
include: ["src/*.js"] 不跨 /（段内通配）	dup:include/预算矩阵	commit:2e09de7f
include: ["**/*.js"] 命中任意目录的 .js	dup:include/预算矩阵	commit:2e09de7f
include 多条：任一命中即纳入	dup:include/预算矩阵	commit:2e09de7f
负控制：include 为空 → 不过滤（mode=all 全纳入）	dup:include/预算矩阵	commit:2e09de7f
负控制：exclude 的字面量子串语义不变（src/vendored 命中子树）	dup:include/预算矩阵	commit:2e09de7f
A → B → A（memo 命中）：预算回到 A 的值（不是 B 的最后写入者）	dup:include/预算矩阵	commit:2e09de7f
A → B → A：会话 LRU 上限同样随本次解析回到 A	dup:include/预算矩阵	commit:2e09de7f
无 nudo 键的目录：预算回落默认（不是上一个项目的值）	dup:include/预算矩阵	commit:2e09de7f
同一项目重复解析：预算稳定	dup:include/预算矩阵	commit:2e09de7f
env NUDO_MAX_FORKS 仍压过项目配置（优先级不变）	dup:include/预算矩阵	commit:2e09de7f
② 重复声明 ⇒ 分析器诊断的码是 nudo:mock-invalid	dup:码归因/建议/body-read 表	commit:9549ec7b
② 重复声明 ⇒ 该诊断**不得**再被说成 nudo:module-missing	dup:码归因/建议/body-read 表	commit:9549ec7b
② 重复声明 ⇒ warning 级（同码同级：mock-invalid = 指令写法有歧义）	dup:码归因/建议/body-read 表	commit:9549ec7b
① 单条声明 ⇒ 零该诊断（不许误报）	dup:码归因/建议/body-read 表	commit:9549ec7b
③ mock 文件缺失 ⇒ nudo:module-missing + error	dup:码归因/建议/body-read 表	commit:9549ec7b
③ 门禁面（check 补充通道）同口径：nudo:module-missing + error	dup:码归因/建议/body-read 表	commit:9549ec7b
重复声明 ⇒ 提示「只保留一条声明」（不是通用表达式句）	dup:码归因/建议/body-read 表	commit:9549ec7b
导出名缺失 ⇒ 提示点名那个缺失的导出	dup:码归因/建议/body-read 表	commit:9549ec7b
mock 文件缺失 ⇒ 仍是「建 mock 文件 / 改路径」那句（既有文案逐字保留）	dup:码归因/建议/body-read 表	commit:9549ec7b
param.trimLeft() ⇒ param: string()	dup:码归因/建议/body-read 表	commit:9549ec7b
param.trimRight() ⇒ param: string()	dup:码归因/建议/body-read 表	commit:9549ec7b
负控：param.includes(...) 仍推不出 string()（该表刻意排除 Array 同名方法）	dup:码归因/建议/body-read 表	commit:9549ec7b
同形态但不同调用点 ⇒ 两条独立见证（顺序无关）	dup:去重/槽/类导入表	commit:8c95a46e
对照组：同一调用点被重复采集 ⇒ 仍去重成一条	dup:去重/槽/类导入表	commit:8c95a46e
对象槽字面量不符（期望 { a: 2 }，实际 { a: 1 }）→ 报 nudo:case-expected	dup:去重/槽/类导入表	commit:8c95a46e
对象槽字面量类型不同（期望 { a: "y" }，实际 { a: "x" }）→ 报	dup:去重/槽/类导入表	commit:8c95a46e
嵌套对象槽字面量不符（期望 { a: { b: 2 } }，实际 { a: { b: 1 } }）→ 报	dup:去重/槽/类导入表	commit:8c95a46e
负控制：期望槽是**类型**（number()）→ 口径不变（不报）	dup:去重/槽/类导入表	commit:8c95a46e
负控制：顶层字面量不符（期望 2，实际 1）→ 口径不变（报）	dup:去重/槽/类导入表	commit:8c95a46e
负控制：数组元素字面量不符（期望 ["y"]，实际 ["x"]）→ 口径不变（报）	dup:去重/槽/类导入表	commit:8c95a46e
对象槽字面量不符 → 不满足	dup:去重/槽/类导入表	commit:8c95a46e
对象槽字面量相符 → 满足	dup:去重/槽/类导入表	commit:8c95a46e
负控制：期望槽是类型（number()）→ 满足（口径不变）	dup:去重/槽/类导入表	commit:8c95a46e
import { Svc }：调用点归因到类所在模块并合成 call@ case	dup:去重/槽/类导入表	commit:8c95a46e
import { Svc as S }（本地名 ≠ 类名）：同样归因到类所在模块	dup:去重/槽/类导入表	commit:8c95a46e
负控制：命名空间导入形态仍按成员名归因（exportName = 成员名）	dup:去重/槽/类导入表	commit:8c95a46e
负控制：别的模块的调用点不得挂到本文件的函数域	dup:去重/槽/类导入表	commit:8c95a46e
```
