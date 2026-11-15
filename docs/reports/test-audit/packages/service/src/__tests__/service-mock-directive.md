# packages/service/src/__tests__/service-mock-directive.test.ts

模块套件：79 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"@nudo:mock Number 生效（宿主 Number 不再应答）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"@nudo:mock Math 生效（宿主 Math.floor 不再应答）"	"宿主应答 = 1（Math.floor(1.5)）⇒ mock 生效后不再是 1 负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"@nudo:mock Date 生效（宿主 Date.now 不再应答）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"产品面（analyzeFileAsync / nudo test 的 case 值）同值"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"普通名 mock 仍生效（改前就生效，不得回退）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"mock 覆盖 env 的优先级不变（同名时 mock 赢）"	"mock 赢 ⇒ \"MOCKED\"（env 的 object 不可调用） 负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"env 全局仍受跳过表约束（env 的 Math 不遮蔽宿主 Math）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"没有 mock 时宿主应答不变"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"collectAbsBindingsFromGraph：宿主内建名的 mock 生效（顶层 const 求值面）"	"负控制：没有 mock ⇒ 宿主应答"	没测该层	keep	keep	—
"a named export the mock does not provide is a fail-closed error, not a silent fall-through"	"走错误出口：nudo:module-missing（code 缺省 ⇒ check-issues 映射成该码） 该条指令**不生效** ⇒ applied 不置 true 原模块保持原样（**不是**「一半 mock、一半原模块」的混合程序） 原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"names the mock does provide still overlay, unnamed exports still fall through (regression guard)"	"depFn 来自 mock（不是原模块的哨兵） 未点名 ⇒ 回落原模块（文档口径：Unspecified exports fall through） 原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"reports every missing named export"	"原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"a missing `default` named export is reported the same way"	"mock 没有任何导出 ⇒ 既无 named 也无 default 原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"surfaces on the check face as nudo:module-missing (error)"	"原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"full replacement (no names list) is unaffected"	"原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。"	没测该层	keep	keep	—
"被替换调用的 throws 域保留（L2 门禁不再假绿）"	"checkSource 签名显示串"	没测该层	keep	keep	—
"被替换调用的副作用保留（求值发生，结果取注入值）"	"checkSource 签名显示串"	没测该层	keep	keep	—
"负控制：未被标注的相邻子表达式照常求值"	"checkSource 签名显示串"	没测该层	keep	keep	—
"@nudo:as 挂在 if 上不泄漏进块内的 return"	"checkSource 签名显示串"	没测该层	keep	keep	—
"@nudo:replace 不泄漏进嵌套函数体"	"checkSource 签名显示串"	没测该层	keep	keep	—
"@nudo:replace 只作用于被标注的那条语句（同行下一条不受影响）"	"checkSource 签名显示串"	没测该层	keep	keep	—
"负控制：指令仍作用于它标注的那条语句"	"checkSource 签名显示串"	没测该层	keep	keep	—
"负控制：@nudo:as 仍覆盖紧随语句的 init"	"checkSource 签名显示串"	没测该层	keep	keep	—
"skip 且未声明返回 ⇒ 仍然声明成 unknown（与 check 同源、TS 投影面归一）"	"`@nudo:skip`（未声明返回类型）让 export 面把**整条导出静默丢掉** （`.d.ts` 里该函数不存在，exit 0 零警告），而 `nudo check`（core）为同一 函数合成 `any` ⇒ 两面相反 + 消费端 `import` TS2305。 修法：`combinedAbs == null` 分支不再返回空行，投影成 `(...args: unknown[]): unknown` （2026-11-06 TS 投影面归一；"	没测该层	keep	keep	—
"对照组：未 skip 的普通函数仍然走推断面（不受本修法影响）"	"`@nudo:skip`（未声明返回类型）让 export 面把**整条导出静默丢掉** （`.d.ts` 里该函数不存在，exit 0 零警告），而 `nudo check`（core）为同一 函数合成 `any` ⇒ 两面相反 + 消费端 `import` TS2305。 修法：`combinedAbs == null` 分支不再返回空行，投影成 `(...args: unknown[]): unknown` （2026-11-06 TS 投影面归一；"	没测该层	keep	keep	—
"只有孤儿指令 ⇒ 有一条「无处可施」诊断（既有口径）"	"两处孤儿（同一文案、不同位置）⇒ 各报一条（位置进身份）"	没测该层	keep	keep	—
"孤儿 + 一条生效的 @nudo:as ⇒ 孤儿诊断**仍然在场**（改前被抑制为 0）"	"同一条诊断的文案保持不变（既有消费面按文案筛） 两处孤儿（同一文案、不同位置）⇒ 各报一条（位置进身份）"	没测该层	keep	keep	—
"生效的那条 @nudo:as 照旧进入收集表（抑制解除没有副作用）"	"两处孤儿（同一文案、不同位置）⇒ 各报一条（位置进身份）"	没测该层	keep	keep	—
"两处孤儿各报一条（改前合并成一条）"	"两处孤儿（同一文案、不同位置）⇒ 各报一条（位置进身份）"	没测该层	keep	keep	—
"② 目标写错 ⇒ 有一条点名目标文本的诊断"	"诊断必须**点名目标文本** ⇒ 用户能看出是哪个字写错了 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"① 目标写对 ⇒ 零该诊断（且指令确实命中了节点）"	"未命中才会缺这两个字段 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"③ 根本没有该指令 ⇒ 零该诊断（不许误报）"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"② 与 ③ 可区分（改前两者的诊断集逐字相同）"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"门禁面可见：warning 级（不挡 exit），且文案点名目标"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"② 重复声明 ⇒ 有一条点名两条来源的诊断"	"诊断必须点名**两条**指令的来源 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"① 单条声明 ⇒ 零该诊断（不许误报）"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"② 重复后先声明者的导出名不得静默消失（不退化成 unknown）"	"改前：整块覆写 ⇒ readFile 从导出表里**消失**（调用点退化成 unknown） 且先声明者的导出**仍是精确值**（不是 unknown） 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"门禁面可见：warning 级（不挡 exit）"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"重复声明不影响单条声明的既有口径（局部形态：未点名的名字回落原模块）"	"「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。"	没测该层	keep	keep	—
"applies in the declaring function only (entry B)"	"依赖模块自己的 `@nudo:mock` 完全不注入 ⇒ 同一个函数「作为目标」 与「作为依赖」结论互斥。 修复：abs-modules-graph 按声明函数作用域重求值 依赖模块，只覆盖该函数导出（其它函数保留无 mock 基线）。"	没测该层	keep	keep	—
"same function keeps the same result as a direct target (entry A)"	"依赖模块自己的 `@nudo:mock` 完全不注入 ⇒ 同一个函数「作为目标」 与「作为依赖」结论互斥。 修复：abs-modules-graph 按声明函数作用域重求值 依赖模块，只覆盖该函数导出（其它函数保留无 mock 基线）。"	没测该层	keep	keep	—
"目标命中声明符 id（绑定位）⇒ 不算命中 + 显式诊断"	"绑定位没有被替换（值仍是 5），且这条「没生效」是**可见**的 未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd）"	没测该层	keep	keep	—
"目标命中对象属性键位 ⇒ 不算命中 + 显式诊断"	"未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd）"	没测该层	keep	keep	—
"对照组：目标命中属性值（表达式位）⇒ 命中有区间、零诊断、替换生效"	"未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd）"	没测该层	keep	keep	—
"对照组：目标全文未命中 ⇒ 仍然是「matched no expression」告警"	"未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd）"	没测该层	keep	keep	—
"C：内层同名函数的 skip 不再顶掉外层（C 的签名 == D 的签名）"	"E：外层无 skip + 内层**同名** string（越界组）"	夹具漏形态	keep	keep	—
"E：外层没有 skip ⇒ 内层同名 skip 不越界（该名不进 skip 表）"	"E：外层无 skip + 内层**同名** string（越界组）"	夹具漏形态	keep	keep	—
"E 与 F 的签名逐字相同（导出函数的 throws 标注不再被抹掉）"	"E：外层无 skip + 内层**同名** string（越界组）"	夹具漏形态	keep	keep	—
"内层函数自己的 skip 仍按最浅同名者裁决（不同名时照常绑定）"	"E：外层无 skip + 内层**同名** string（越界组）"	夹具漏形态	keep	keep	—
"同族 @nudo:pure 用同一裁决（内层同名 pure 不标记外层）"	"顶层函数的 pure 不受影响 抽取面仍返回「带指令的函数」（depth 只是新增字段，不改变成员集） E：外层无 skip + 内层**同名** string（越界组）"	夹具漏形态	keep	keep	—
"收集 for 循环体里的 @nudo:replace"	"收集器层面：每个容器位置的指令都必须进注入表"	没测该层	keep	keep	—
"无指令的语句不受同函数内其它指令影响"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"指令挂在非语句节点上——不产生注入（无处可施），且发显式诊断"	"对象属性不是语句：@nudo:as 没有可覆盖的语句 @nudo:as number() 负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"无任何行内指令的源码不产生诊断"	"负控制：不该被这条修复波及的邻近形态"	夹具漏形态	keep	keep	—
"先声明的函数不再被后声明的同名 mock 改写成错类型"	"负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"声明顺序互换不改变各自的取值（不再纯源序 last-wins）"	"负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"种子表保留每个作用域各自的那一份（scoped + 覆盖表）"	"作用域选择面：各自取各自的 mock（两个 mock 是不同的 Abs） 负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"声明函数取值一致；未声明函数看不到该 mock"	"负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"无冲突时不产生作用域覆盖表（不留冗余状态）"	"负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"readA / readB 各自取各自的 mock（接线前：先声明的也被后声明的改写）"	"产物面（`nudo export --format dts` / `nudo test` 的 case 值 / LSP hover） 走 service analyzer 的**按函数求值**路径（tryEvalCallFull / tryEvalAbsFull）， 不经过 core 的 generalizeFromAst ⇒ 作用域选择必须在这两个入口接上。 负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见"	没测该层	keep	keep	—
"hasNudoDirectives 认得 assume/invariant/throws/budget"	"改前已在名单里的指令名（负控制：不得回退）。"	没测该层	keep	keep	—
"shouldAnalyzeFile 纳入只含这四个指令的文件（改前：整份文件被跳过 → 假绿）"	"改前已在名单里的指令名（负控制：不得回退）。"	没测该层	keep	keep	—
"负控制：无指令 / 指令只在字符串里 → 仍不纳入"	"改前已在名单里的指令名（负控制：不得回退）。"	没测该层	keep	keep	—
"负控制：已在名单里的指令名不得回退"	"改前已在名单里的指令名（负控制：不得回退）。"	没测该层	keep	keep	—
"文件级指令形态（/// @nudo:env）也纳入"	"改前已在名单里的指令名（负控制：不得回退）。"	没测该层	keep	keep	—
"mock expression parse failure is a warning, not an error"	"文档口径（packages/website/docs/reference/diagnostics.md#nudo-mock-invalid、 packages/website/docs/guides/check.md「nudo:mock-invalid | engine | warning」） 是 **warning**：@nudo:mock 表达式解析失败 ⇒ 指令被忽略，mock 不生效。 修复前：service 面的 mock 种子通道（mockDirectivesToAbsSeeds 的 fromError"	没测该层	keep	keep	—
"both mock-invalid channels (static validation + mock seed) agree"	"文档口径（packages/website/docs/reference/diagnostics.md#nudo-mock-invalid、 packages/website/docs/guides/check.md「nudo:mock-invalid | engine | warning」） 是 **warning**：@nudo:mock 表达式解析失败 ⇒ 指令被忽略，mock 不生效。 修复前：service 面的 mock 种子通道（mockDirectivesToAbsSeeds 的 fromError"	没测该层	keep	keep	—
"missing mock file stays an error (no fake green)"	"文档口径（packages/website/docs/reference/diagnostics.md#nudo-mock-invalid、 packages/website/docs/guides/check.md「nudo:mock-invalid | engine | warning」） 是 **warning**：@nudo:mock 表达式解析失败 ⇒ 指令被忽略，mock 不生效。 修复前：service 面的 mock 种子通道（mockDirectivesToAbsSeeds 的 fromError"	没测该层	keep	keep	—
"内联箭头 mock：new 定抛 ⇒ 走 catch 分支（原生 caught，修复前 mocked）"	"负控制：同一段代码不加 mock（本地 const 箭头）"	没测该层	keep	keep	—
"内联 mock 的种子带 ctor facet（箭头 ⇒ 不可构造）"	"负控制：同一段代码不加 mock（本地 const 箭头）"	没测该层	keep	keep	—
"内联 function 表达式 mock：可构造（ctor:true），不走 catch 分支"	"构造成功（不再定抛 TypeError）⇒ 结果不是 catch 分支的 \"caught\" 负控制：同一段代码不加 mock（本地 const 箭头）"	夹具漏形态	keep	keep	—
"from 形态（mock 文件导出箭头）仍是 caught"	"负控制：同一段代码不加 mock（本地 const 箭头）"	没测该层	keep	keep	—
"本地 const 箭头（不加 mock）仍是 caught"	"负控制：同一段代码不加 mock（本地 const 箭头）"	没测该层	keep	keep	—
"返回类型是 promise 面（eff/promise），不是 never"	"负控制：普通 returns 形态（同步返回值，不受本条影响）"	夹具漏形态	keep	keep	—
"返回契约不再被 never 空洞满足（string() 判为不满足 ⇒ 报 unproven-return）"	"负控制：普通 returns 形态（同步返回值，不受本条影响）"	夹具漏形态	keep	keep	—
"resolves 形态仍是 promise<42>"	"负控制：普通 returns 形态（同步返回值，不受本条影响）"	夹具漏形态	keep	keep	—
"returns 形态仍是同步值 42"	"负控制：普通 returns 形态（同步返回值，不受本条影响）"	夹具漏形态	keep	keep	—
"resolves 形态在同契约下同样报 unproven-return（口径一致）"	"负控制：普通 returns 形态（同步返回值，不受本条影响）"	夹具漏形态	keep	keep	—
```
