# packages/service/src/emit/__tests__/emit-types.test.ts

模块套件：emit 值类型/诊断渲染/导入命名/字面量面。

审计：114 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
--emit --all 跳过手写绑定（name-clash），侧车内容原样保留；core 与 service 对「谁是生成段」的判定一致（跨包一致性）；合法生成段仍被识别（emit 走段替换，不报 name-clash）；段内夹无关 const ⇒ 手写段不是生成段（Bug 432 的段边界，同批落地）	emit-types 聚合矩阵	没测该层	keep	keep	—
本地调用点来源的宽域段带 `local` 标记；调用点消失 ⇒ 段被删（残差收口）；`--from` 外部记录来源的段带 `external` 标记；证据缺失 ⇒ 留存（不误删）；旧侧车（无 `// evidence:` 行）的宽域段仍然留存 —— 迁移期零回归；旧侧车的单点字面量见证段仍按旧启发式删除（既有语义不变）；`derived-from` 段即使带 `local` 标记也留存（root 可能在别的文件）；标记是确定性的：连续两次发射逐字节相同，第二次无改动；存在边界	emit-types 聚合矩阵	没测该层	keep	keep	—
注入 `nullable(…)` 的同一次改写里补上 import（TS2304 的根因）；不变式：侧车用到的每个 builder 都被 import 覆盖（tsc --noEmit --strict 可编译）；已有 `nullable` import ⇒ 不重复追加；`nullable` 被改名导入（`nullable as nb`）⇒ 新包装按本地名写；负控制：`.nudo.js` 侧车不加 import 行（引擎运行时注入 builder）；负控制：return 位已经	emit-types 聚合矩阵	没测该层	keep	keep	—
原生域前提：NaN / ±Infinity 都是 number（Abs 域含之）；无 refinement 的 number prim 渲染成放宽形态（不再收窄）；带 numBound 的 number prim 只放宽满足该界的那一端（BUG-093 收口）；共享节点形态不变（standard 面不受影响——S4 的决定）；lit NaN 的兜底投影覆盖 NaN 域（不再假红）；负控制：lit 精度的 number 仍投影成字面量（不牵连邻近形态）	emit-types 聚合矩阵	没测该层	keep	keep	—
不确信置信度 ⇒ zod 放宽（不再 z.literal(1)）；不确信置信度 ⇒ standard 节点放宽（prim 而非 lit）；不确信置信度 ⇒ guard 放宽（不再 data === 1）；放宽记进 dropped 台账（损失可观测）；负控制：确信置信度（exact）⇒ 字面量精度保留；负控制：契约面（pred 通道）⇒ 字面量精度保留	emit-types 聚合矩阵	没测该层	keep	keep	—
renders a duplicated issue exactly once；keeps distinct issues (dedupe must not swallow real diagnostics)；consumes the issues after rendering (a second renderer cannot duplicate them)	emit-types 聚合矩阵	没测该层	keep	keep	—
守卫签名带类型标注（入参 unknown / 返回 boolean）；各类形态的守卫产物写进同一模块也能过 strict 编译；负控制：守卫的运行时语义不变（谓词文本原样）；负控制：守卫产物不引用用户类名（不会 TS2304）	emit-types 聚合矩阵	没测该层	keep	keep	—
库函数版：超长 / 欠长元组被拒，等长放行；生成产物版：超长元组被拒（与库函数版同口径）；负控制：带 rest 的元组仍放行超长元素（rest 语义不回归）	emit-types 聚合矩阵	没测该层	keep	keep	—
derives ONE row for the same downstream export hit by two roots；writes ONE section — the sidecar has no duplicate export；refuses to write a sidecar that would carry a duplicate export	emit-types 聚合矩阵	没测该层	keep	keep	—
merges the two roots' domains — order-independent snapshot；is idempotent after the merge (second emit: no change)	emit-types 聚合矩阵	没测该层	keep	keep	—
"drops the stale section of an export the target no longer has"	"侧车里出现的导出名（Babel 不报 duplicate export —— 自己数一遍） 断言：expect(e.sidecars[0]!.written).toBe(true);；expect(first).toContain(\"export const add2\");"	没测该层	keep	keep	—
库函数版与生成产物版对稀疏洞给出逐字相同的结果；负控制：稠密数组两份实现都放行（不得把稠密数组误判成稀疏）	emit-types 聚合矩阵	没测该层	keep	keep	—
冷跑与缓存命中跑逐字相同（递归展开不被 any().optional() 取代）；负控制：非 lazy 契约的往返显示不变、缓存无节点表；旧缓存表（无版本号）整层 miss：不得当命中读出退化约束	emit-types 聚合矩阵	没测该层	keep	keep	—
库函数版：非函数被拒，函数放行；生成产物版：与 zod 面 z.function() 同判；promise 节点自 BUG-025 起拒绝裸 thenable（不再放行一切）	emit-types 聚合矩阵	没测该层	keep	keep	—
names the source file path and states the path semantics；negative control: an allowlist matching the source file is not denied	emit-types 聚合矩阵	没测该层	keep	keep	—
declares the builders used by the generated section in a .nudo.ts sidecar；the .nudo.ts sidecar is idempotent (second emit reports no change)；negative control: a .js sidecar gets no builder declaration (bare injection suffices)	emit-types 聚合矩阵	没测该层	keep	keep	—
TS 投影面：Abs any 与 Abs unknown 都渲染成 TS unknown；nudo 展示面仍区分 any / unknown（abs.md display 规则作用域不变）；未受约束的入口形参在 .d.ts 里渲染成 unknown（与三面校验器同口径）；Case 见证行按观测值渲染，且产物不出现 TS any；产物真的能过 tsc --noEmit --strict（unknown 经收窄后可用）；未收窄的 unknown 返回值被 TS2571 拦下（正确	emit-types 聚合矩阵	没测该层	keep	keep	—
`.nudo.ts` 侧车带 builder import，TS 关键字构建器改名导入；产物真的过 `tsc --noEmit --strict`（改前 3× TS 错误）；改前形态（无 import 的裸 DSL）确实过不了 tsc —— 回归有效性自证；负控制：`.nudo.js` 侧车维持「裸注入」纪律（不加 import）；负控制：已有侧车自带 import 时不重复 import（沿用既有本地名）	emit-types 聚合矩阵	没测该层	keep	keep	—
uses an alias binding when an import local shadows the target name；the whole file's contracts survive (handwritten binding still binds)；is idempotent (second emit reports no change)；negative control: no import local shadow ⇒ the direct bind	emit-types 聚合矩阵	没测该层	keep	keep	—
库函数版：bigint / 循环对象 / 抛错 getter 都返回 Result 而非抛异常；生成产物版：validate(bigint) / validate(循环对象) 不抛；负控制：合法值仍放行（兜底不得误拒）；负控制：numLit(42) 的消息仍是可读的类型错（不因兜底变成无信息）	emit-types 聚合矩阵	没测该层	keep	keep	—
保留字作绑定名 ⇒ `_` 前缀（不是直出）；多个保留字都清洗（default / let / eval / await）；负控制：合法绑定名原样保留（不误伤）；负控制：点号名仍按既有口径清洗成 C_m（#494 不回退）	emit-types 聚合矩阵	没测该层	keep	keep	—
库函数版：Infinity 放行、null / 0 拒绝，消息保真；生成产物版：Infinity 不再被折成 null；负控制：-Infinity 同样保真；普通字面量消息格式不变	emit-types 聚合矩阵	没测该层	keep	keep	—
同名局部绑定不再命中：定位到顶层声明；注解落进顶层 alpha 的 JSDoc（不是 beta 的函数体）；改前形态：旧实现把注解写进 beta 的函数体（回归有效性自证）；负控制：顶层 const 箭头函数仍可定位（既有行为不变）；负控制：函数体里的同名局部 const 不是目标函数 → 不定位	emit-types 聚合矩阵	没测该层	keep	keep	—
CRLF 源文件写回后仍是纯 CRLF（新插入的行不带裸 LF）；负控制：LF 源文件写回后仍是纯 LF（不得被改成 CRLF）；CRLF + 末行无终止符：行尾仍是纯 CRLF，末尾仍无换行；负控制：文件末尾有无换行不变（LF + 有末尾换行）	emit-types 聚合矩阵	没测该层	keep	keep	—
空 obj → Record<string, never>（不是 {}）；负控制：有成员的对象仍是结构体（不误伤）；端到端：空对象返回值的属性读不再吃 TS2339；联合类型里契约义务不被吸收（{ a: number } | Record<string, never>）；非对象实参被拒（与 zod 面「必须是对象」同裁决）；改前形态确实红（{} ⇒ TS2339，且联合里吸收契约义务）；负控制：字面量成员对象不受影响（结构体照旧，嵌套精度保留）	emit-types 聚合矩阵	没测该层	keep	keep	—
helper(x+5, x+1)：返回位是 b（gt(1)），不是 a（gt(5)）；helper(x+1, x+5)：参数顺序反向时返回位仍是 b（gt(5)）；落盘侧车的返回位是 b（改前写的是 a）；负控制：不同 root 的两个形参 —— 既有锚定不变（仍取实现返回的那个）；负控制：返回位不是形参本身 —— 保持相对 shift 形态（a.shift(1)）	emit-types 聚合矩阵	没测该层	keep	keep	—
guard / standard / standard 产物 逐值同裁决（含用户原型上的同名键）；用户原型上的**非**污染键三面都算在场（不误伤 HasProperty 语义）；zod 产物：必填污染键槽带上同一条存在性子句（修前完全没有）	emit-types 聚合矩阵	没测该层	keep	keep	—
形状前提：combinedAbs 是 obj 形状 + view: "array"；dts 面：元组 + 其余自有槽的交集（不再摊平成对象字面量类型）；guard 面：真实数组放行、同形普通对象拒绝（头部判据是 Array.isArray）；standard 面（库函数 + 产物）：接受真实数组、拒绝同形对象 / 缺槽数组；zod 面：`z.tuple([...])`（`z.object` 会把真实数组判成违规）；多见证 join：两条数组视图见证 ⇒ facet 仍在；混入	emit-types 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
--emit --all 跳过手写绑定（name-clash），侧车内容原样保留	dup:emit-types 聚合矩阵	commit:8fa85177
core 与 service 对「谁是生成段」的判定一致（跨包一致性）	dup:emit-types 聚合矩阵	commit:8fa85177
合法生成段仍被识别（emit 走段替换，不报 name-clash）	dup:emit-types 聚合矩阵	commit:8fa85177
段内夹无关 const ⇒ 手写段不是生成段（Bug 432 的段边界，同批落地）	dup:emit-types 聚合矩阵	commit:8fa85177
本地调用点来源的宽域段带 `local` 标记；调用点消失 ⇒ 段被删（残差收口）	dup:emit-types 聚合矩阵	commit:8fa85177
`--from` 外部记录来源的段带 `external` 标记；证据缺失 ⇒ 留存（不误删）	dup:emit-types 聚合矩阵	commit:8fa85177
旧侧车（无 `// evidence:` 行）的宽域段仍然留存 —— 迁移期零回归	dup:emit-types 聚合矩阵	commit:8fa85177
旧侧车的单点字面量见证段仍按旧启发式删除（既有语义不变）	dup:emit-types 聚合矩阵	commit:8fa85177
`derived-from` 段即使带 `local` 标记也留存（root 可能在别的文件）	dup:emit-types 聚合矩阵	commit:8fa85177
标记是确定性的：连续两次发射逐字节相同，第二次无改动	dup:emit-types 聚合矩阵	commit:8fa85177
存在边界：有外部记录参与但仍有本地证据 ⇒ 标记 external（保守方向 = 少删）	dup:emit-types 聚合矩阵	commit:8fa85177
注入 `nullable(…)` 的同一次改写里补上 import（TS2304 的根因）	dup:emit-types 聚合矩阵	commit:8fa85177
不变式：侧车用到的每个 builder 都被 import 覆盖（tsc --noEmit --strict 可编译）	dup:emit-types 聚合矩阵	commit:8fa85177
已有 `nullable` import ⇒ 不重复追加	dup:emit-types 聚合矩阵	commit:8fa85177
`nullable` 被改名导入（`nullable as nb`）⇒ 新包装按本地名写	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：`.nudo.js` 侧车不加 import 行（引擎运行时注入 builder）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：return 位已经是 `nullable(…)` ⇒ 无改写（不重复包装）	dup:emit-types 聚合矩阵	commit:8fa85177
原生域前提：NaN / ±Infinity 都是 number（Abs 域含之）	dup:emit-types 聚合矩阵	commit:8fa85177
无 refinement 的 number prim 渲染成放宽形态（不再收窄）	dup:emit-types 聚合矩阵	commit:8fa85177
带 numBound 的 number prim 只放宽满足该界的那一端（BUG-093 收口）	dup:emit-types 聚合矩阵	commit:8fa85177
共享节点形态不变（standard 面不受影响——S4 的决定）	dup:emit-types 聚合矩阵	commit:8fa85177
lit NaN 的兜底投影覆盖 NaN 域（不再假红）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：lit 精度的 number 仍投影成字面量（不牵连邻近形态）	dup:emit-types 聚合矩阵	commit:8fa85177
不确信置信度 ⇒ zod 放宽（不再 z.literal(1)）	dup:emit-types 聚合矩阵	commit:8fa85177
不确信置信度 ⇒ standard 节点放宽（prim 而非 lit）	dup:emit-types 聚合矩阵	commit:8fa85177
不确信置信度 ⇒ guard 放宽（不再 data === 1）	dup:emit-types 聚合矩阵	commit:8fa85177
放宽记进 dropped 台账（损失可观测）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：确信置信度（exact）⇒ 字面量精度保留	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：契约面（pred 通道）⇒ 字面量精度保留	dup:emit-types 聚合矩阵	commit:8fa85177
renders a duplicated issue exactly once	dup:emit-types 聚合矩阵	commit:8fa85177
keeps distinct issues (dedupe must not swallow real diagnostics)	dup:emit-types 聚合矩阵	commit:8fa85177
consumes the issues after rendering (a second renderer cannot duplicate them)	dup:emit-types 聚合矩阵	commit:8fa85177
守卫签名带类型标注（入参 unknown / 返回 boolean）	dup:emit-types 聚合矩阵	commit:8fa85177
各类形态的守卫产物写进同一模块也能过 strict 编译	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：守卫的运行时语义不变（谓词文本原样）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：守卫产物不引用用户类名（不会 TS2304）	dup:emit-types 聚合矩阵	commit:8fa85177
库函数版：超长 / 欠长元组被拒，等长放行	dup:emit-types 聚合矩阵	commit:8fa85177
生成产物版：超长元组被拒（与库函数版同口径）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：带 rest 的元组仍放行超长元素（rest 语义不回归）	dup:emit-types 聚合矩阵	commit:8fa85177
derives ONE row for the same downstream export hit by two roots	dup:emit-types 聚合矩阵	commit:8fa85177
writes ONE section — the sidecar has no duplicate export	dup:emit-types 聚合矩阵	commit:8fa85177
refuses to write a sidecar that would carry a duplicate export	dup:emit-types 聚合矩阵	commit:8fa85177
merges the two roots' domains — order-independent snapshot	dup:emit-types 聚合矩阵	commit:8fa85177
is idempotent after the merge (second emit: no change)	dup:emit-types 聚合矩阵	commit:8fa85177
库函数版与生成产物版对稀疏洞给出逐字相同的结果	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：稠密数组两份实现都放行（不得把稠密数组误判成稀疏）	dup:emit-types 聚合矩阵	commit:8fa85177
冷跑与缓存命中跑逐字相同（递归展开不被 any().optional() 取代）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：非 lazy 契约的往返显示不变、缓存无节点表	dup:emit-types 聚合矩阵	commit:8fa85177
旧缓存表（无版本号）整层 miss：不得当命中读出退化约束	dup:emit-types 聚合矩阵	commit:8fa85177
库函数版：非函数被拒，函数放行	dup:emit-types 聚合矩阵	commit:8fa85177
生成产物版：与 zod 面 z.function() 同判	dup:emit-types 聚合矩阵	commit:8fa85177
promise 节点自 BUG-025 起拒绝裸 thenable（不再放行一切）	dup:emit-types 聚合矩阵	commit:8fa85177
names the source file path and states the path semantics	dup:emit-types 聚合矩阵	commit:8fa85177
negative control: an allowlist matching the source file is not denied	dup:emit-types 聚合矩阵	commit:8fa85177
declares the builders used by the generated section in a .nudo.ts sidecar	dup:emit-types 聚合矩阵	commit:8fa85177
the .nudo.ts sidecar is idempotent (second emit reports no change)	dup:emit-types 聚合矩阵	commit:8fa85177
negative control: a .js sidecar gets no builder declaration (bare injection suffices)	dup:emit-types 聚合矩阵	commit:8fa85177
TS 投影面：Abs any 与 Abs unknown 都渲染成 TS unknown	dup:emit-types 聚合矩阵	commit:8fa85177
nudo 展示面仍区分 any / unknown（abs.md display 规则作用域不变）	dup:emit-types 聚合矩阵	commit:8fa85177
未受约束的入口形参在 .d.ts 里渲染成 unknown（与三面校验器同口径）	dup:emit-types 聚合矩阵	commit:8fa85177
Case 见证行按观测值渲染，且产物不出现 TS any	dup:emit-types 聚合矩阵	commit:8fa85177
产物真的能过 tsc --noEmit --strict（unknown 经收窄后可用）	dup:emit-types 聚合矩阵	commit:8fa85177
未收窄的 unknown 返回值被 TS2571 拦下（正确的类型安全提示，非假红）	dup:emit-types 聚合矩阵	commit:8fa85177
`.nudo.ts` 侧车带 builder import，TS 关键字构建器改名导入	dup:emit-types 聚合矩阵	commit:8fa85177
产物真的过 `tsc --noEmit --strict`（改前 3× TS 错误）	dup:emit-types 聚合矩阵	commit:8fa85177
改前形态（无 import 的裸 DSL）确实过不了 tsc —— 回归有效性自证	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：`.nudo.js` 侧车维持「裸注入」纪律（不加 import）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：已有侧车自带 import 时不重复 import（沿用既有本地名）	dup:emit-types 聚合矩阵	commit:8fa85177
uses an alias binding when an import local shadows the target name	dup:emit-types 聚合矩阵	commit:8fa85177
the whole file's contracts survive (handwritten binding still binds)	dup:emit-types 聚合矩阵	commit:8fa85177
is idempotent (second emit reports no change)	dup:emit-types 聚合矩阵	commit:8fa85177
negative control: no import local shadow ⇒ the direct binding is used	dup:emit-types 聚合矩阵	commit:8fa85177
库函数版：bigint / 循环对象 / 抛错 getter 都返回 Result 而非抛异常	dup:emit-types 聚合矩阵	commit:8fa85177
生成产物版：validate(bigint) / validate(循环对象) 不抛	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：合法值仍放行（兜底不得误拒）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：numLit(42) 的消息仍是可读的类型错（不因兜底变成无信息）	dup:emit-types 聚合矩阵	commit:8fa85177
保留字作绑定名 ⇒ `_` 前缀（不是直出）	dup:emit-types 聚合矩阵	commit:8fa85177
多个保留字都清洗（default / let / eval / await）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：合法绑定名原样保留（不误伤）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：点号名仍按既有口径清洗成 C_m（#494 不回退）	dup:emit-types 聚合矩阵	commit:8fa85177
库函数版：Infinity 放行、null / 0 拒绝，消息保真	dup:emit-types 聚合矩阵	commit:8fa85177
生成产物版：Infinity 不再被折成 null	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：-Infinity 同样保真；普通字面量消息格式不变	dup:emit-types 聚合矩阵	commit:8fa85177
同名局部绑定不再命中：定位到顶层声明	dup:emit-types 聚合矩阵	commit:8fa85177
注解落进顶层 alpha 的 JSDoc（不是 beta 的函数体）	dup:emit-types 聚合矩阵	commit:8fa85177
改前形态：旧实现把注解写进 beta 的函数体（回归有效性自证）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：顶层 const 箭头函数仍可定位（既有行为不变）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：函数体里的同名局部 const 不是目标函数 → 不定位	dup:emit-types 聚合矩阵	commit:8fa85177
CRLF 源文件写回后仍是纯 CRLF（新插入的行不带裸 LF）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：LF 源文件写回后仍是纯 LF（不得被改成 CRLF）	dup:emit-types 聚合矩阵	commit:8fa85177
CRLF + 末行无终止符：行尾仍是纯 CRLF，末尾仍无换行	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：文件末尾有无换行不变（LF + 有末尾换行）	dup:emit-types 聚合矩阵	commit:8fa85177
空 obj → Record<string, never>（不是 {}）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：有成员的对象仍是结构体（不误伤）	dup:emit-types 聚合矩阵	commit:8fa85177
端到端：空对象返回值的属性读不再吃 TS2339	dup:emit-types 聚合矩阵	commit:8fa85177
联合类型里契约义务不被吸收（{ a: number } | Record<string, never>）	dup:emit-types 聚合矩阵	commit:8fa85177
非对象实参被拒（与 zod 面「必须是对象」同裁决）	dup:emit-types 聚合矩阵	commit:8fa85177
改前形态确实红（{} ⇒ TS2339，且联合里吸收契约义务）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：字面量成员对象不受影响（结构体照旧，嵌套精度保留）	dup:emit-types 聚合矩阵	commit:8fa85177
helper(x+5, x+1)：返回位是 b（gt(1)），不是 a（gt(5)）	dup:emit-types 聚合矩阵	commit:8fa85177
helper(x+1, x+5)：参数顺序反向时返回位仍是 b（gt(5)）	dup:emit-types 聚合矩阵	commit:8fa85177
落盘侧车的返回位是 b（改前写的是 a）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：不同 root 的两个形参 —— 既有锚定不变（仍取实现返回的那个）	dup:emit-types 聚合矩阵	commit:8fa85177
负控制：返回位不是形参本身 —— 保持相对 shift 形态（a.shift(1)）	dup:emit-types 聚合矩阵	commit:8fa85177
guard / standard / standard 产物 逐值同裁决（含用户原型上的同名键）	dup:emit-types 聚合矩阵	commit:8fa85177
用户原型上的**非**污染键三面都算在场（不误伤 HasProperty 语义）	dup:emit-types 聚合矩阵	commit:8fa85177
zod 产物：必填污染键槽带上同一条存在性子句（修前完全没有）	dup:emit-types 聚合矩阵	commit:8fa85177
形状前提：combinedAbs 是 obj 形状 + view: "array"	dup:emit-types 聚合矩阵	commit:8fa85177
dts 面：元组 + 其余自有槽的交集（不再摊平成对象字面量类型）	dup:emit-types 聚合矩阵	commit:8fa85177
guard 面：真实数组放行、同形普通对象拒绝（头部判据是 Array.isArray）	dup:emit-types 聚合矩阵	commit:8fa85177
standard 面（库函数 + 产物）：接受真实数组、拒绝同形对象 / 缺槽数组	dup:emit-types 聚合矩阵	commit:8fa85177
zod 面：`z.tuple([...])`（`z.object` 会把真实数组判成违规）	dup:emit-types 聚合矩阵	commit:8fa85177
多见证 join：两条数组视图见证 ⇒ facet 仍在；混入普通对象 ⇒ facet 消失	dup:emit-types 聚合矩阵	commit:8fa85177
```
