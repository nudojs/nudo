# packages/nudojs/src/__tests__/cli-check.test.ts

模块套件：nudojs check/abs/assume/case/callsite/contract 面。

审计：116 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
dts 面：有调试见证与无证据的投影相同（形参是 unknown，不是 number）；zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）；与 nudo check 的签名同口径（发布面 = 门禁面）	cli-check 聚合矩阵	没测该层	keep	keep	—
dts：有 case 与无 case 逐字相同（均门禁口径 x: unknown）；schema：入参是宽松域（z.unknown），不是 case 的 z.number；guard：入参接受 string（实现允许 f("s")）；`nudo contract` 打印面与 check 同口径（x: any）	cli-check 聚合矩阵	没测该层	keep	keep	—
计数器工厂：check 与 test 都给 1；一次性抛：check 给 never（与 d.ts 一致），不是 1；手写 lit(1) 生成段 ⇒ 不报 contract-drift（脏值会与生成段打架）	cli-check 聚合矩阵	没测该层	keep	keep	—
clean 文件 ⇒ 恰好一行摘要（旧实现 3 行 OK 块 + 代数面）；失败文件 ⇒ 不打 signatures 段（与单独 --quiet 同形）	cli-check 聚合矩阵	没测该层	keep	keep	—
带 assume：--abs 与 --json 的 abs 面出现同一句 pred；对照组（无 assume 行）：两面都不出现该 pred；`nudo test --abs` 走同一观察面 ⇒ 前提同样可见	cli-check 聚合矩阵	没测该层	keep	keep	—
zod / standard / guard 三面都保留 union（同一 zod 文件内 Input 与 Output 同口径）；运行时：standard 面拒绝契约违约值、接受契约允许值	cli-check 聚合矩阵	没测该层	keep	keep	—
空目录 ⇒ path-empty-dir 进 sink，且不返回记录；对照组：非空目录现场照常采集（无路径错误）	cli-check 聚合矩阵	没测该层	keep	keep	—
"已固化见证 + 另一现场 ⇒ 同名 case 只出现一次，summary.cases == 不同见证数"	"回归：`--from` 的调用点见证不得被**两条合成路径各合成一次**。 改前「已固化 directive 见证 + 主候选循环的 callsite 见证」会产出同名两条 ⇒ 台账里 `call@` 出现两次、人类面打印两遍、`summary.cases` 重复计数。 断言：expect(names.length).toBeGreaterThan(0);；expect(new Set(names).size).toBe(names.length);"	夹具漏形态	keep	keep	—
--gitlab 语法错文件 ⇒ stdout 是**可解析数组**且含该文件的条目；--gitlab 路径不存在 ⇒ stdout 仍是可解析数组（不是 0 字节）；--gha 语法错文件 ⇒ 至少一条 ::error 注解；批量（坏 + 绿）⇒ 一份数组里同时有语法错行与绿文件无关行（不丢坏文件）	cli-check 聚合矩阵	没测该层	keep	keep	—
三个同内容文件的载荷逐字相同（换序也不变）；载荷三字段不含内部 id；机器面 display 与人类面 signatures 行同源；--verbose 人类面不得含内部 id	cli-check 聚合矩阵	没测该层	keep	keep	—
zod 入参面：契约覆盖的位 + 未覆盖的形参位都在（不丢位）；dts 面与 zod 面同口径：未覆盖的形参位在 dts 里也在	cli-check 聚合矩阵	没测该层	keep	keep	—
zod 面：见证不进 Output 面，也不泄漏见证返回值；standard 面：同样没有 Output 校验器	cli-check 聚合矩阵	没测该层	keep	keep	—
zod 入参面：点路径 ⇒ 嵌套 obj（不是字面量点号键）；dts 面保持嵌套形状（两面的节点形状一致）	cli-check 聚合矩阵	没测该层	keep	keep	—
call@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1；entry@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1；--freeze 写回形态的名字（call@<file>:<line>）：仍是声明式见证 ⇒ 计入失败 + exit 1；普通名字的声明式见证：与前缀变体同构（同样计入失败 + exit 1）；call@ 前缀的声明式见证：期望相符 ⇒ 计入通过、exit 0（不是 unchecked / synthetic）	cli-check 聚合矩阵	没测该层	keep	keep	—
无函数文件：--abs 与非 --abs 同为 exit 0 + 同一句报告；无函数文件：--json 面（另一条机器面）同样 exit 0；对照：check --abs 的「无函数 ⇒ exit 1」是既有期望行为（Bug 669）不被本片改动	cli-check 聚合矩阵	没测该层	keep	keep	—
拼错的函数名 → Function not found + exit 1（不再是 unknown/partial）；真实函数名 → 正常观察面（不误伤）；文件本身没有函数 → 既有口径不变（Function not found + exit 1）；CLI 级：拼错的函数名 → 进程 exit 1（check 报告段不把 exitCode 复位）	cli-check 聚合矩阵	没测该层	keep	keep	—
`x=5` 这类坏值 → exit 1（旧行为 exit 0）；好值仍然生效（不误伤）；多个 --assume 里混一个坏值 → 仍然 exit 1（不得部分生效后假绿）；CLI 级：坏值 → 进程 exit 1	cli-check 聚合矩阵	没测该层	keep	keep	—
解析器：配置面裸字符串 / 数组元素内逗号都被切开；CLI：配置写裸字符串 "TypeError" ⇒ L2 被忽略（门禁绿）；CLI：配置写 ["TypeError,RangeError"] ⇒ 数组元素内逗号被切开（门禁绿）；CLI：配置写 ["TypeError"]（旧口径，未回归）⇒ 门禁绿；CLI：形状非法（42）⇒ 回落默认 + stderr 一行告警（不静默假红）；CLI：CLI 旗标形态不变（--ignore-throws TypeError,RangeErr	cli-check 聚合矩阵	没测该层	keep	keep	—
--abs 面：诊断段上屏（旧行为：整段消失 ⇒ 屏幕上零提示）；三个面（默认 / --abs / --json）对同一文件的诊断条数一致；对照：check --abs 的既有口径不动（report ok 时不打 issues 列表）	cli-check 聚合矩阵	没测该层	keep	keep	—
`x>=1` ⇒ 谓词是 (x + 1) ≥ 2（不是 > 1.999…）；`x>1` ⇒ 谓词是 (x + 1) > 1.999…（与 >= 不同）	cli-check 聚合矩阵	没测该层	keep	keep	—
x>100 且 y>200 ⇒ 谓词 (x + y) > 300（两条都在场）；顺序无关（y 在前也一样合取）	cli-check 聚合矩阵	没测该层	keep	keep	—
组合 → 用法错误 + exit 1（且不回显 assume）；单独 --generalize 仍然可用（不误伤）；单独 --assume 仍然可用（不误伤）；CLI 级：组合 → 进程 exit 1	cli-check 聚合矩阵	没测该层	keep	keep	—
--assume 'x>-5' ⇒ x=-1 可达 ⇒ 结果含 "neg"；--assume 'x>=-5' ⇒ 同上（>= 运算符分派不被破坏）；负控制：--assume 'x>0' ⇒ 仍只有 "pos"（用户界与写死界一致时口径不变）；负控制：同一形参多条界取**合取**（x>-5 且 x>0 ⇒ 更强的 x>0 生效）	cli-check 聚合矩阵	没测该层	keep	keep	—
人类面：check 报 contract-load error + exit 1（旧行为：exit 0 假绿）；--json 面：信封 ok:false + issues 含 nudo:contract-load（且只一条）	cli-check 聚合矩阵	没测该层	keep	keep	—
含 internal 回落的文件 ⇒ exit ≠ 0（修前是 0 = 假绿）+ 人类面明确失败行；--json 面：机器可判定（ok:false + nudo:internal error issue）+ exit ≠ 0；假红防线：正常文件（零回落）仍 exit 0（不得误报）；假红防线：unsupported:*（能力边界）回落**不**变成闸门失败；check --fix 与 plain check 同口径：同一文件不得「check 红 / --fix 绿」	cli-check 聚合矩阵	没测该层	keep	keep	—
模块级原生异常不再是「分析失败」⇒ health 只看漂移，报 OK（口径变更）；正常文件 ⇒ Result: OK + exit 0（不得误报）；假红防线：unsupported:*（能力边界）回落 ⇒ health 仍 OK（不得误报）	cli-check 聚合矩阵	没测该层	keep	keep	—
`--json` 不再声称「仅 `--draft`」，且**提到** print / `--draft` / `--emit` 三形态；帮助文本不骗人：print 形态的 `--json` 顶层**恒为数组**（帮助说的三形态都成立）	cli-check 聚合矩阵	没测该层	keep	keep	—
拒绝覆盖时提示**同时**给出 `--force` 与 `NUDO_DRAFT_FORCE`（既有草稿逐字不变）；**人工改过的草稿永不被覆盖**（`--force` 也不放行）⇒ 拒绝仍然发生、文件逐字不变；提示里的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功	cli-check 聚合矩阵	没测该层	keep	keep	—
环内文件的签名 = 原生值（改前：unknown）；求值有界：无限递归的环被截断成 nudo:recursion-truncated（不挂死）；负控制：非环的跨模块调用不受影响（21 * 2 = 42）	cli-check 聚合矩阵	没测该层	keep	keep	—
contract-entry-only 不再被丢弃（info，不挡门禁）；负控制：contract-domain-exceeds 的既有映射不变（error → error）；负控制：白名单外的码仍被过滤（不放大诊断面）	cli-check 聚合矩阵	没测该层	keep	keep	—
check --from 打印 nudo:contract-entry-only（改前 infos: 0 / 静默丢弃）；check --json：summary.infos 计入 entry-only，ok 仍为 true	cli-check 聚合矩阵	没测该层	keep	keep	—
解析失败 → 明确报错 + exit 1（改前：静默 0 记录 + exit 0 假绿）；--json 面：pathErrors 收录该失败 + exit 1；负控制：现场文件可读但没有调用 → 不报错、exit 0；负控制：现场文件有调用 → 记录被采集（call@ 而非 entry@）、exit 0	cli-check 聚合矩阵	没测该层	keep	keep	—
contract 正常出结果（改前：裸 Do not know how to serialize a BigInt，exit 1）；同一份文件：check 面与 contract 面都不崩（跨 verb 一致）	cli-check 聚合矩阵	没测该层	keep	keep	—
"contract 印的形参 = 声明形参；契约里绑不上的参数另列并标注"	"本测试钉住产品面：同一份文件，`nudo contract` 印的形参表必须与 `nudo check` 的签名面一致（同一来源 = 声明形参表）； 契约里绑不上的参数 另列一栏并显式标注（不顶替形参名）。 断言：expect(contract.status).toBe(0);；expect(contract.stdout).toContain(\"(x: any)\");"	没测该层	keep	keep	—
方向 a：@nudo:mock 内联 —— 两条命令同绿（改前 check 绿 / --fix 红）；方向 b：autoBind:false —— 两条命令同红（改前 check 红 / --fix 绿）；方向 c：@nudo:mock from 缺文件 —— 两条命令的 error 条数一致；方向 d：--profile adoption —— --fix 不得为 warning 级诊断替用户写契约	cli-check 聚合矩阵	没测该层	keep	keep	—
① --from 现场文件（调用点在函数体内）⇒ 被调方门禁红（exit 1 + 恰一条跨文件域超限）；② --json 面同判：ok:false + summary.errors=1 + issues 恰一条；③ 违例归因到被调方的导出名（fn=f / actual=-1），不是现场文件的本地名；④ --from <目录> ⇒ 同判（现场文件集合按目录展开）；⑤ 控制组：直接 check 调用方 ⇒ 仍 1 条 nudo:constraint-violated（跨文件面不污	cli-check 聚合矩阵	没测该层	keep	keep	—
静态扫描：函数体内的调用点被判为被调方的调用点违例；runCheck 接线：带 --from 现场文件 ⇒ 被调方报告含 error 级调用点违例；控制组：不带 --from 现场文件 ⇒ 被调方报告不含该违例（不凭空造证据）；去重：执行态通道已报过的同一处事实不被静态通道重复上报	cli-check 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
dts 面：有调试见证与无证据的投影相同（形参是 unknown，不是 number）	dup:cli-check 聚合矩阵	commit:14f49e20
zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）	dup:cli-check 聚合矩阵	commit:14f49e20
与 nudo check 的签名同口径（发布面 = 门禁面）	dup:cli-check 聚合矩阵	commit:14f49e20
dts：有 case 与无 case 逐字相同（均门禁口径 x: unknown）	dup:cli-check 聚合矩阵	commit:14f49e20
schema：入参是宽松域（z.unknown），不是 case 的 z.number	dup:cli-check 聚合矩阵	commit:14f49e20
guard：入参接受 string（实现允许 f("s")）	dup:cli-check 聚合矩阵	commit:14f49e20
`nudo contract` 打印面与 check 同口径（x: any）	dup:cli-check 聚合矩阵	commit:14f49e20
计数器工厂：check 与 test 都给 1	dup:cli-check 聚合矩阵	commit:14f49e20
一次性抛：check 给 never（与 d.ts 一致），不是 1	dup:cli-check 聚合矩阵	commit:14f49e20
手写 lit(1) 生成段 ⇒ 不报 contract-drift（脏值会与生成段打架）	dup:cli-check 聚合矩阵	commit:14f49e20
clean 文件 ⇒ 恰好一行摘要（旧实现 3 行 OK 块 + 代数面）	dup:cli-check 聚合矩阵	commit:14f49e20
失败文件 ⇒ 不打 signatures 段（与单独 --quiet 同形）	dup:cli-check 聚合矩阵	commit:14f49e20
带 assume：--abs 与 --json 的 abs 面出现同一句 pred	dup:cli-check 聚合矩阵	commit:14f49e20
对照组（无 assume 行）：两面都不出现该 pred	dup:cli-check 聚合矩阵	commit:14f49e20
`nudo test --abs` 走同一观察面 ⇒ 前提同样可见	dup:cli-check 聚合矩阵	commit:14f49e20
zod / standard / guard 三面都保留 union（同一 zod 文件内 Input 与 Output 同口径）	dup:cli-check 聚合矩阵	commit:14f49e20
运行时：standard 面拒绝契约违约值、接受契约允许值	dup:cli-check 聚合矩阵	commit:14f49e20
空目录 ⇒ path-empty-dir 进 sink，且不返回记录	dup:cli-check 聚合矩阵	commit:14f49e20
对照组：非空目录现场照常采集（无路径错误）	dup:cli-check 聚合矩阵	commit:14f49e20
--gitlab 语法错文件 ⇒ stdout 是**可解析数组**且含该文件的条目	dup:cli-check 聚合矩阵	commit:14f49e20
--gitlab 路径不存在 ⇒ stdout 仍是可解析数组（不是 0 字节）	dup:cli-check 聚合矩阵	commit:14f49e20
--gha 语法错文件 ⇒ 至少一条 ::error 注解	dup:cli-check 聚合矩阵	commit:14f49e20
批量（坏 + 绿）⇒ 一份数组里同时有语法错行与绿文件无关行（不丢坏文件）	dup:cli-check 聚合矩阵	commit:14f49e20
三个同内容文件的载荷逐字相同（换序也不变）	dup:cli-check 聚合矩阵	commit:14f49e20
载荷三字段不含内部 id	dup:cli-check 聚合矩阵	commit:14f49e20
机器面 display 与人类面 signatures 行同源	dup:cli-check 聚合矩阵	commit:14f49e20
--verbose 人类面不得含内部 id	dup:cli-check 聚合矩阵	commit:14f49e20
zod 入参面：契约覆盖的位 + 未覆盖的形参位都在（不丢位）	dup:cli-check 聚合矩阵	commit:14f49e20
dts 面与 zod 面同口径：未覆盖的形参位在 dts 里也在	dup:cli-check 聚合矩阵	commit:14f49e20
zod 面：见证不进 Output 面，也不泄漏见证返回值	dup:cli-check 聚合矩阵	commit:14f49e20
standard 面：同样没有 Output 校验器	dup:cli-check 聚合矩阵	commit:14f49e20
zod 入参面：点路径 ⇒ 嵌套 obj（不是字面量点号键）	dup:cli-check 聚合矩阵	commit:14f49e20
dts 面保持嵌套形状（两面的节点形状一致）	dup:cli-check 聚合矩阵	commit:14f49e20
call@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
entry@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
--freeze 写回形态的名字（call@<file>:<line>）：仍是声明式见证 ⇒ 计入失败 + exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
普通名字的声明式见证：与前缀变体同构（同样计入失败 + exit 1）	dup:cli-check 聚合矩阵	commit:14f49e20
call@ 前缀的声明式见证：期望相符 ⇒ 计入通过、exit 0（不是 unchecked / synthetic）	dup:cli-check 聚合矩阵	commit:14f49e20
无函数文件：--abs 与非 --abs 同为 exit 0 + 同一句报告	dup:cli-check 聚合矩阵	commit:14f49e20
无函数文件：--json 面（另一条机器面）同样 exit 0	dup:cli-check 聚合矩阵	commit:14f49e20
对照：check --abs 的「无函数 ⇒ exit 1」是既有期望行为（Bug 669）不被本片改动	dup:cli-check 聚合矩阵	commit:14f49e20
拼错的函数名 → Function not found + exit 1（不再是 unknown/partial）	dup:cli-check 聚合矩阵	commit:14f49e20
真实函数名 → 正常观察面（不误伤）	dup:cli-check 聚合矩阵	commit:14f49e20
文件本身没有函数 → 既有口径不变（Function not found + exit 1）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI 级：拼错的函数名 → 进程 exit 1（check 报告段不把 exitCode 复位）	dup:cli-check 聚合矩阵	commit:14f49e20
`x=5` 这类坏值 → exit 1（旧行为 exit 0）	dup:cli-check 聚合矩阵	commit:14f49e20
好值仍然生效（不误伤）	dup:cli-check 聚合矩阵	commit:14f49e20
多个 --assume 里混一个坏值 → 仍然 exit 1（不得部分生效后假绿）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI 级：坏值 → 进程 exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
解析器：配置面裸字符串 / 数组元素内逗号都被切开	dup:cli-check 聚合矩阵	commit:14f49e20
CLI：配置写裸字符串 "TypeError" ⇒ L2 被忽略（门禁绿）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI：配置写 ["TypeError,RangeError"] ⇒ 数组元素内逗号被切开（门禁绿）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI：配置写 ["TypeError"]（旧口径，未回归）⇒ 门禁绿	dup:cli-check 聚合矩阵	commit:14f49e20
CLI：形状非法（42）⇒ 回落默认 + stderr 一行告警（不静默假红）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI：CLI 旗标形态不变（--ignore-throws TypeError,RangeError 仍绿）	dup:cli-check 聚合矩阵	commit:14f49e20
--abs 面：诊断段上屏（旧行为：整段消失 ⇒ 屏幕上零提示）	dup:cli-check 聚合矩阵	commit:14f49e20
三个面（默认 / --abs / --json）对同一文件的诊断条数一致	dup:cli-check 聚合矩阵	commit:14f49e20
对照：check --abs 的既有口径不动（report ok 时不打 issues 列表）	dup:cli-check 聚合矩阵	commit:14f49e20
`x>=1` ⇒ 谓词是 (x + 1) ≥ 2（不是 > 1.999…）	dup:cli-check 聚合矩阵	commit:14f49e20
`x>1` ⇒ 谓词是 (x + 1) > 1.999…（与 >= 不同）	dup:cli-check 聚合矩阵	commit:14f49e20
x>100 且 y>200 ⇒ 谓词 (x + y) > 300（两条都在场）	dup:cli-check 聚合矩阵	commit:14f49e20
顺序无关（y 在前也一样合取）	dup:cli-check 聚合矩阵	commit:14f49e20
组合 → 用法错误 + exit 1（且不回显 assume）	dup:cli-check 聚合矩阵	commit:14f49e20
单独 --generalize 仍然可用（不误伤）	dup:cli-check 聚合矩阵	commit:14f49e20
单独 --assume 仍然可用（不误伤）	dup:cli-check 聚合矩阵	commit:14f49e20
CLI 级：组合 → 进程 exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
--assume 'x>-5' ⇒ x=-1 可达 ⇒ 结果含 "neg"	dup:cli-check 聚合矩阵	commit:14f49e20
--assume 'x>=-5' ⇒ 同上（>= 运算符分派不被破坏）	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：--assume 'x>0' ⇒ 仍只有 "pos"（用户界与写死界一致时口径不变）	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：同一形参多条界取**合取**（x>-5 且 x>0 ⇒ 更强的 x>0 生效）	dup:cli-check 聚合矩阵	commit:14f49e20
人类面：check 报 contract-load error + exit 1（旧行为：exit 0 假绿）	dup:cli-check 聚合矩阵	commit:14f49e20
--json 面：信封 ok:false + issues 含 nudo:contract-load（且只一条）	dup:cli-check 聚合矩阵	commit:14f49e20
含 internal 回落的文件 ⇒ exit ≠ 0（修前是 0 = 假绿）+ 人类面明确失败行	dup:cli-check 聚合矩阵	commit:14f49e20
--json 面：机器可判定（ok:false + nudo:internal error issue）+ exit ≠ 0	dup:cli-check 聚合矩阵	commit:14f49e20
假红防线：正常文件（零回落）仍 exit 0（不得误报）	dup:cli-check 聚合矩阵	commit:14f49e20
假红防线：unsupported:*（能力边界）回落**不**变成闸门失败	dup:cli-check 聚合矩阵	commit:14f49e20
check --fix 与 plain check 同口径：同一文件不得「check 红 / --fix 绿」	dup:cli-check 聚合矩阵	commit:14f49e20
模块级原生异常不再是「分析失败」⇒ health 只看漂移，报 OK（口径变更）	dup:cli-check 聚合矩阵	commit:14f49e20
正常文件 ⇒ Result: OK + exit 0（不得误报）	dup:cli-check 聚合矩阵	commit:14f49e20
假红防线：unsupported:*（能力边界）回落 ⇒ health 仍 OK（不得误报）	dup:cli-check 聚合矩阵	commit:14f49e20
`--json` 不再声称「仅 `--draft`」，且**提到** print / `--draft` / `--emit` 三形态	dup:cli-check 聚合矩阵	commit:14f49e20
帮助文本不骗人：print 形态的 `--json` 顶层**恒为数组**（帮助说的三形态都成立）	dup:cli-check 聚合矩阵	commit:14f49e20
拒绝覆盖时提示**同时**给出 `--force` 与 `NUDO_DRAFT_FORCE`（既有草稿逐字不变）	dup:cli-check 聚合矩阵	commit:14f49e20
**人工改过的草稿永不被覆盖**（`--force` 也不放行）⇒ 拒绝仍然发生、文件逐字不变	dup:cli-check 聚合矩阵	commit:14f49e20
提示里的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功	dup:cli-check 聚合矩阵	commit:14f49e20
环内文件的签名 = 原生值（改前：unknown）	dup:cli-check 聚合矩阵	commit:14f49e20
求值有界：无限递归的环被截断成 nudo:recursion-truncated（不挂死）	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：非环的跨模块调用不受影响（21 * 2 = 42）	dup:cli-check 聚合矩阵	commit:14f49e20
contract-entry-only 不再被丢弃（info，不挡门禁）	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：contract-domain-exceeds 的既有映射不变（error → error）	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：白名单外的码仍被过滤（不放大诊断面）	dup:cli-check 聚合矩阵	commit:14f49e20
check --from 打印 nudo:contract-entry-only（改前 infos: 0 / 静默丢弃）	dup:cli-check 聚合矩阵	commit:14f49e20
check --json：summary.infos 计入 entry-only，ok 仍为 true	dup:cli-check 聚合矩阵	commit:14f49e20
解析失败 → 明确报错 + exit 1（改前：静默 0 记录 + exit 0 假绿）	dup:cli-check 聚合矩阵	commit:14f49e20
--json 面：pathErrors 收录该失败 + exit 1	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：现场文件可读但没有调用 → 不报错、exit 0	dup:cli-check 聚合矩阵	commit:14f49e20
负控制：现场文件有调用 → 记录被采集（call@ 而非 entry@）、exit 0	dup:cli-check 聚合矩阵	commit:14f49e20
contract 正常出结果（改前：裸 Do not know how to serialize a BigInt，exit 1）	dup:cli-check 聚合矩阵	commit:14f49e20
同一份文件：check 面与 contract 面都不崩（跨 verb 一致）	dup:cli-check 聚合矩阵	commit:14f49e20
方向 a：@nudo:mock 内联 —— 两条命令同绿（改前 check 绿 / --fix 红）	dup:cli-check 聚合矩阵	commit:14f49e20
方向 b：autoBind:false —— 两条命令同红（改前 check 红 / --fix 绿）	dup:cli-check 聚合矩阵	commit:14f49e20
方向 c：@nudo:mock from 缺文件 —— 两条命令的 error 条数一致	dup:cli-check 聚合矩阵	commit:14f49e20
方向 d：--profile adoption —— --fix 不得为 warning 级诊断替用户写契约	dup:cli-check 聚合矩阵	commit:14f49e20
① --from 现场文件（调用点在函数体内）⇒ 被调方门禁红（exit 1 + 恰一条跨文件域超限）	dup:cli-check 聚合矩阵	commit:14f49e20
② --json 面同判：ok:false + summary.errors=1 + issues 恰一条	dup:cli-check 聚合矩阵	commit:14f49e20
③ 违例归因到被调方的导出名（fn=f / actual=-1），不是现场文件的本地名	dup:cli-check 聚合矩阵	commit:14f49e20
④ --from <目录> ⇒ 同判（现场文件集合按目录展开）	dup:cli-check 聚合矩阵	commit:14f49e20
⑤ 控制组：直接 check 调用方 ⇒ 仍 1 条 nudo:constraint-violated（跨文件面不污染同文件面）	dup:cli-check 聚合矩阵	commit:14f49e20
⑥ 控制组：不带 --from ⇒ 被调方绿（不凭空造证据）	dup:cli-check 聚合矩阵	commit:14f49e20
⑦ 不重复报告：顶层调用点（执行态 + 静态两通道同时命中）⇒ 恰一条	dup:cli-check 聚合矩阵	commit:14f49e20
静态扫描：函数体内的调用点被判为被调方的调用点违例	dup:cli-check 聚合矩阵	commit:14f49e20
runCheck 接线：带 --from 现场文件 ⇒ 被调方报告含 error 级调用点违例	dup:cli-check 聚合矩阵	commit:14f49e20
控制组：不带 --from 现场文件 ⇒ 被调方报告不含该违例（不凭空造证据）	dup:cli-check 聚合矩阵	commit:14f49e20
去重：执行态通道已报过的同一处事实不被静态通道重复上报	dup:cli-check 聚合矩阵	commit:14f49e20
```
