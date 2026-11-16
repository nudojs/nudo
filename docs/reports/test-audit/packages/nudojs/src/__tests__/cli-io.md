# packages/nudojs/src/__tests__/cli-io.test.ts

模块套件：nudojs IO/格式/路径/artifact/fix/whatif 面。

审计：221 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
module-missing（error）⇒ exit 1 且诊断上屏；--json：ok=false 且 summary.errors 反映 error 计数；干净文件：ok=true、errors=0、exit 0；warning 级诊断（模块环）不得把 test 判红	cli-io 聚合矩阵	没测该层	keep	keep	—
zod 入参槽 = z.array(z.unknown())（不是数组的数组）；standard 面 rest 槽节点只有一层 arr（与 dts 的 ...rest: unknown[] 同形）	cli-io 聚合矩阵	没测该层	keep	keep	—
`check clean.js --only <code> broken.js` ⇒ 定向 usage error + exit 1；对照：把 variadic 旗标放在 `--` 前、路径放后面 ⇒ 正常检查（不误报）	cli-io 聚合矩阵	没测该层	keep	keep	—
第二份 diff 以第一份为基准（累积），不是又一份「新建文件」；dry-run 的 diff 可被 `git apply --check -p1` 消费；dry-run 与 --write 得到同一份侧车内容	cli-io 聚合矩阵	没测该层	keep	keep	—
拼错的码 ⇒ usage error + exit 1（不再静默 no-op）；合法码但本次无该诊断 ⇒ 末尾报「matched no diagnostic」	cli-io 聚合矩阵	没测该层	keep	keep	—
"不可写目录 ⇒ 有措辞的 error + 其余目标仍被处理"	"`nudo check --fix --write` 写盘失败抛**裸 Node 异常**（EACCES） 且**不再处理其余文件**（整次运行中断）。 断言：expect(r.stderr).toContain(\"error: check --fix cannot write\");；expect(r.stderr).toContain(\"EACCES\");"	没测该层	keep	keep	—
"foo.js + foo.mjs 共存 ⇒ 拒绝落盘、兄弟模块错误数不变"	"`nudo check --fix --write` 写的侧车污染同目录**共享同一侧车 路径**的兄弟模块（`foo.js` 与 `foo.mjs` 都映射到 `foo.nudo.js`）： 给未被修复的兄弟**新增** error，且自己的 fix 被静默丢弃。 现在：检测到共享 ⇒ **拒绝落盘**（可见 error + 点名共享者 + 汇总计数）， 不再新写入任何共享侧车 ⇒ 兄弟模块的错误数不增加。 断言：expect(errorCount(before.stdout)).toBe(1);；expect(fix.stderr).toContain(\"refuses to write sidecar\");"	没测该层	keep	keep	—
用户导出 `z` + zod 段 import ⇒ 产物可编译（tsc --strict rc 0）；用户导出 `__nudoCheck`（standard 段的非导出 helper 同名）⇒ 不重复声明	cli-io 聚合矩阵	没测该层	keep	keep	—
主路径：完全无证据的导出函数 ⇒ 参数 unknown，stderr 点名提示；主路径：契约只覆盖部分形参时，未覆盖位同样是 unknown；窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示	cli-io 聚合矩阵	没测该层	keep	keep	—
test 文本面与 --json 面都带 nudo:recursion-truncated；check 面同码同源（跨面口径一致，info 不挡门禁）	cli-io 聚合矩阵	没测该层	keep	keep	—
collectNudoFiles 不收 dist/ 与 coverage/ 下的文件（改前：收进来）；CLI check <pkg> 的文件集合里没有 dist/（改前：多出 dist/lib.js）；CLI test <pkg> 不因陈旧构建产物而红（改前：exit 1 假红）；跨面一致：CLI 目录发现与 IDE/vite 的 service 闸门对同一批文件给出相同结论	cli-io 聚合矩阵	没测该层	keep	keep	—
--format standard：台账标题不再宣称 zod（没有 zod 产物）；--format all：zod 台账与 standard 台账各一次（标题不再同名重复）；--format dts：无台账（dts 面不携带 dropped 记录）	cli-io 聚合矩阵	没测该层	keep	keep	—
路径不存在 ⇒ ok:false + summary.pathErrors = 1（summary.errors 仍只数诊断）；绿运行 ⇒ 不带 pathErrors 字段（JSON 形态不漂移）	cli-io 聚合矩阵	没测该层	keep	keep	—
zod：解构形参按**字段名**建顶层键（不再是内部占位 `_p0`）；standard：解构形参的顶层槽是字段名（无占位名）；负控制：数组解构的字段级契约仍是元组（Bug 394 口径不变）	cli-io 聚合矩阵	没测该层	keep	keep	—
同一缺失路径给两次 ⇒ 只登记一条错误；同一现场文件给两次 ⇒ 记录不重复（按调用点身份各一条）	cli-io 聚合矩阵	没测该层	keep	keep	—
standard 段的槽键是原形参名（导出名让位，数据不动）；负控制：--out 落盘的 standard 产物槽键同样是原形参名（两条投递路径同结论）	cli-io 聚合矩阵	没测该层	keep	keep	—
同名两个模块 + 同模块重导 ⇒ 无编号副本、无陈旧内容；幂等重导：内容不变时仍是一份产物	cli-io 聚合矩阵	没测该层	keep	keep	—
"写出的 .d.ts 里的相对说明符从输出目录可解析（不再指向源目录）"	"`nudo export --format dts --out <dir>` 不重基相对模块说明符。 不再指向源目录）。 断言：expect(r.status, name).toBe(0);；expect(existsSync(produced)).toBe(true);"	没测该层	keep	keep	—
optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` ⇒ exit 0、无 constraint-violated；required 对照 + `{ a: undefined }` ⇒ exit 1 且报 nudo:constraint-violated；required 对照 + `{ a: 'x' }` ⇒ exit 0（对照组正例）	cli-io 聚合矩阵	没测该层	keep	keep	—
A 组（无调用点）：zod / standard 槽是一层数组，dts 同形；A 组 standard 校验器**接受**该函数自己的合法调用 `{args:[1,2]}`；对照组（有调用点证据）：同样是**一层**数组，接受集与 A 组一致	cli-io 聚合矩阵	没测该层	keep	keep	—
--gha 单独 ⇒ 注解在 stdout（不回归）；--gha --gitlab ⇒ stdout 仍是 GitLab 数组、stderr 有 ::error（不被丢弃）；单变量对照：加 --json 后 GHA 计数不变（不再取决于无关旗标）	cli-io 聚合矩阵	没测该层	keep	keep	—
check --from <使用现场> -- <被检查文件> ⇒ 报 nudo:contract-drift（改前 0 条）；控制组：没有跨文件证据 ⇒ 不报 drift（无证据不判）；归因闸：别的模块的同名调用点证据不得污染本文件的判定	cli-io 聚合矩阵	没测该层	keep	keep	—
zod 入参面：数组解构 + 字段级契约 ⇒ 元组槽（改前是对象槽 `a`）；standard 面：数组解构形参的槽节点是元组；负控制：对象解构 + 字段级契约仍摊成对象槽（既有口径不变）；负控制：无契约的数组解构仍是观测元组（既有口径不变）	cli-io 聚合矩阵	没测该层	keep	keep	—
--target 指向函数名：返回域取自函数面（不再是 `() => ?`）；两条面不再互相矛盾：--target 的返回域与签名表一致；控制：--target 指向非函数绑定时行为不变；控制：--target 指向不存在的名字时仍是 unknown	cli-io 聚合矩阵	没测该层	keep	keep	—
类型专用的值位置 import 被消掉 ⇒ 产物 `node --check` 过且真 import() 成功；产物里的 import 不得指向「没有该运行时导出」的模块（链接面）	cli-io 聚合矩阵	没测该层	keep	keep	—
字段的 `x!` / `y?` 被剥 ⇒ 产物 `node --check` 过；可选方法 `m?()` 被剥 ⇒ 产物 `node --check` 过	cli-io 聚合矩阵	没测该层	keep	keep	—
`this` 形参被剥 ⇒ 产物 `node --check` 过且形参表只剩 `a`；函数体里的 `this` **表达式**必须保留（只有形参位被删）	cli-io 聚合矩阵	没测该层	keep	keep	—
第 1 条：排除清单上 stdout（--json 面可解析；文本面 stdout 不含被排除的包）；第 1 条：retire --all --json 同样带排除清单（机器面统一口径）；第 1 条 · 负控：无排除的 workspace ⇒ --json 逐字不变（不出现 excluded 键）；第 2 条：多个目标失败 ⇒ 消息列出**全部**失败目标，且整批零写盘；第 2 条：CLI 面 —— 失败目标全部可见（文本面 + --json 的 failedTargets）	cli-io 聚合矩阵	没测该层	keep	keep	—
同目标内一个文件语法错 ⇒ 库面不 throw + 成功文件的结果仍返回；原子性仍成立 ⇒ 有失败时一个字节都不落盘（含好文件）；失败行带文件名 + 失败码与 migrateVerify 同码（同款结构）；负控：全部成功 ⇒ 返回行的字段逐字不变（无 code / error 键）；CLI 面：失败目标的 stdout/stderr 与旧版逐字同形（失败详情带文件名）	cli-io 聚合矩阵	没测该层	keep	keep	—
stdout 里 helper / 类型别名各只出现一次（两个函数 ⇒ 两块）；剥前导不丢内容：两个函数的导出体都在；--out 落盘不变（每函数一份文件，各带一份 helper ⇒ 互不冲突）	cli-io 聚合矩阵	没测该层	keep	keep	—
stdout 里 `fooOutput` 只声明一次（standard 段改名）；stdout 流里没有重复的顶层声明（产物可编译）；--out 落盘不变（各方言各占一个文件 ⇒ 产品名不漂移）	cli-io 聚合矩阵	没测该层	keep	keep	—
stdout 里 `fooInput` 只声明一次（standard 段改名）；dts 段不产 `<fn>Input`（报告的撞名对不存在 ⇒ 治的是 zod ↔ standard）；--format standard 单方言时导出名不漂移（无冲突 ⇒ 不改名）	cli-io 聚合矩阵	没测该层	keep	keep	—
zod 入参面：槽名取裸名、槽值是数组、不凭空造 argN 槽；standard 面：剩余参数位导出名取裸名，节点是数组	cli-io 聚合矩阵	没测该层	keep	keep	—
槽表把 `__proto__` 落为自有键（改前：普通对象 ⇒ 被原型 setter 吞掉）；继承键（constructor / toString）同样不被原型吞掉；产品面 zod Input 含 `__proto__` 形参（core 两处补丁后：projection 字段表无原型 + 键走计算键）	cli-io 聚合矩阵	没测该层	keep	keep	—
同名函数在两个模块里 ⇒ 两份 standard 产物都在（先导出的不被覆盖）；同名函数的第二份产物名带模块键后缀（不是同一个路径）	cli-io 聚合矩阵	没测该层	keep	keep	—
zod 入参面：带默认值的形参位是可选槽（与 dts 面同口径）；dts 面仍声明可选位 `b?`（两面的可选性口径一致）	cli-io 聚合矩阵	没测该层	keep	keep	—
"写失败 ⇒ stdout 回放已落盘产物 + stderr 点名失败文件"	"`nudo export --out` **写失败**时：产物已经部分落盘，但 stdout 一行「wrote」都没有 ⇒ 用户以为「什么都没写」，实际磁盘上多了半个产物集； 错误文案也不带**是哪个文件**失败。 断言：expect(r.status).toBe(1);；expect(wrote.length).toBeGreaterThan(0);"	没测该层	keep	keep	—
zod 返回面保留 promise 包装；dts 面返回类型是 Promise<number>（不是 number）	cli-io 聚合矩阵	没测该层	keep	keep	—
两个目录下的同名模块 ⇒ 两份 .d.ts 都在（先导出的不被覆盖）；同 stem 模块 ⇒ zod / guard 面同样不互相覆盖	cli-io 聚合矩阵	没测该层	keep	keep	—
"同一文件里两个同名方法 ⇒ 两份 standard 产物都在"	"钉（写盘面）：同一个类里两个同名方法 ⇒ standard 产物**两份都在** （`C.m.nudo.standard.ts` + `C.m.2.nudo.standard.ts`），先写的那份不被覆盖。 断言：expect(r.status).toBe(0);；expect(files).toHaveLength(2);"	夹具漏形态	keep	keep	—
--out 指向已有文件 ⇒ 提示不再指向不存在的 check --out；目标路径是目录 ⇒ 写失败提示点名该文件且指向本命令（EISDIR 走写失败通道）	cli-io 聚合矩阵	没测该层	keep	keep	—
分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]（它是精确入口，不是副本）；闸门错误 + `--from` 错误并存：pathErrors[] 全集（顺序不变）+ targetErrors[] 只装闸门	cli-io 聚合矩阵	没测该层	keep	keep	—
分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]	cli-io 聚合矩阵	没测该层	keep	keep	—
分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]	cli-io 聚合矩阵	没测该层	keep	keep	—
check --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；test --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；contract --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；人类面（闸门错误）：stderr 文案与改前逐字一致（机器面改动不外溢）	cli-io 聚合矩阵	没测该层	keep	keep	—
人类面：文件名 + 行:列 + 摘录 + ^ 指位（不再是无路径的裸 message）；--json 面：stdout 是 CaseJson 失败信封（pathErrors[{code:"syntax-error"}]）+ exit 1；对照面：nudo check 对同一文件给同码 pathErrors（两个 verb 机器面同形）	cli-io 聚合矩阵	没测该层	keep	keep	—
无 --freeze：报用法错误 + exit 1（旧行为：静默忽略 + exit 0）；有 --freeze 无 --dry-run：仍是既有的「requires --dry-run」用法错误；合法组合 --freeze --dry-run --exit-on-diff：照常跑（不误伤）	cli-io 聚合矩阵	没测该层	keep	keep	—
print 形态 + 缺失路径：stdout 是合法 JSON 且带 pathErrors[] + exit 1；draft 形态 + 缺失路径：同一套 pathErrors[]（三形态统一）；全部路径都缺失（无 root）：stdout 仍是**非空**合法 JSON + pathErrors[] + exit 1；对照面：非 --json 的人类面仍在 stderr（不因 --json 消失）	cli-io 聚合矩阵	没测该层	keep	keep	—
进程内：CLI 半 + service 半（都走 src）⇒ `..data/f.js` 的草稿**写出来了**；CLI 级：CLI 半**不再**用那句「is outside project root」拒写文案；负控制：同一项目根下的普通文件照常写出（不误伤）	cli-io 聚合矩阵	没测该层	keep	keep	—
migrate status <a> <b> ⇒ 两个包都被审计（不得只报第一个）；migrate status --json <a> <b> ⇒ 顶层数组含两个 root；单路径时行为不变（不得因多路径支持而破坏单路径）	cli-io 聚合矩阵	没测该层	keep	keep	—
collectNudoFiles 收进链接进来的 .js（改前：静默跳过）；符号链接目录被递归进入（改前：整棵链接目录被跳过）；CLI check <dir>：链接进来的坏文件参与门禁（改前：exit 0 假绿）；同一文件直传与目录扫描结论一致（不再一个绿一个红）	cli-io 聚合矩阵	没测该层	keep	keep	—
产物必须落盘且能被 `node --check` 解析（成员修饰符已剥、参数属性已降级）；命令层闸门是**兜底**：真源修好后常规路径不再触发它（不得误拦合法产物）；对照：纯类型注解的 TS 源照常 strip（闸门不得过度拦截）	cli-io 聚合矩阵	没测该层	keep	keep	—
解析器：等号形态切出 name/type（不是整串当绑定名）；解析器：冒号形态不变（旧口径不回归）；解析器：分隔符取最先出现的那个；无分隔符仍是 name=整串 / type=any；CLI：等号形态的假设真的生效（绑定被应用，类型按假设打印）；CLI：冒号形态仍然生效（两种写法同结果）	cli-io 聚合矩阵	没测该层	keep	keep	—
1 个可退役包 ⇒ 顶层仍是数组（不得退化为对象）；2 个可退役包 ⇒ 顶层同样是数组（形状不随条数漂移）；两个场景的顶层形状一致（都是数组）	cli-io 聚合矩阵	没测该层	keep	keep	—
产物含运行时 enum 对象 ⇒ `node --check` 过且 `E.A === 1`；门禁行为正确：`.ts` 源与 `.js` 产物都绿，签名是 `f() => 1`（不再是 never）	cli-io 聚合矩阵	没测该层	keep	keep	—
推导失败 + 期望 number() ⇒ unchecked + exit 0（改前：FAIL + exit 1）；推导失败 + 期望 any() ⇒ 同样 unchecked（改前：空洞 ok「1 passed」）；诊断文本区分「无法判定」与「类型不匹配」，并指向 nudo:opaque-result 的补证据路径；--json 面：assertions = {passed: 0, failed: 0, unchecked: 1}；负控制：推导成功 + 期望不符 ⇒ 仍是	cli-io 聚合矩阵	没测该层	keep	keep	—
CLI：非 --json 面的人读文案不变（stderr 一行 + stdout 空 + exit 1）；CLI：非 --json 面的其它用法错误文案不变（--exit-on-diff 无 --freeze）；CLI：路径错误信封（对照）仍是 pathErrors 机器码，两条通道同形	cli-io 聚合矩阵	没测该层	keep	keep	—
挂在被删语句上的 `/// @nudo:import` 必须在产物里存活；门禁行为正确：源红 / 产物**同样红**（契约仍被绑定 ⇒ 不是假绿）	cli-io 聚合矩阵	没测该层	keep	keep	—
import 不存在的模块 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）；import 不存在的导出 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）；--json 面：pathErrors 收录该失败 + exit 1（改前：pathErrors 为空 + exit 0）；负控制：现场文件模块可解析且有调用 ⇒ call@ 而非 entry@ + exit 0；负控制：现场文件模块可解析但没有调用 ⇒ 不报错 + exit 0	cli-io 聚合矩阵	没测该层	keep	keep	—
混合目录 ⇒ results 保留成功文件的逐文件结果（不再整目标丢弃）；失败条目的 path 是**失败文件**（不是目标目录）⇒ 与 TS-only 闸门同量纲；pathErrors[] 内所有 path 量纲一致（都是文件，不是目录）；--write：成功行带库面的「未写盘」注记，且原子性不变（一个字节都不落盘）；负控：全部成功 ⇒ stdout 仍是顶层数组（形状不变）	cli-io 聚合矩阵	没测该层	keep	keep	—
"负控：非 --json 面仍是 stderr 文案 + exit 1（人读面不回归）"	"各动词的 `--json` 文档形状不同（check/test = 单文档； 断言：expect(r.status, `${verb}: ${r.stderr}`).toBe(1);；expect(r.stdout).toBe(\"\");"	夹具漏形态	keep	keep	—
验收 1：批内有失败文件 + --write ⇒ 人类面**不打** `wrote`，且磁盘上零产出；验收 2：同场景 --json ⇒ results[] 的该行带**机器可判定**的「未写盘」标记；验收 3：全部成功 + --write ⇒ 人类面照旧打 `wrote`，产物真实落盘，标记为「已写盘」；验收 4：退出码语义不变（有失败 ⇒ 非 0；全成功 ⇒ 0）；负控：dry-run（不带 --write）⇒ 人类面是 `dry`（不是 `wrote`），标记为「计划」	cli-io 聚合矩阵	没测该层	keep	keep	—
注册表里存在该码（键名 migrateStripFailed）；产出的 pathErrors[].code 等于注册表常量（不是另写的字面量）；生产 src 不再残留该码的裸字面量赋值（`code: "nudo:…"` 形态）	cli-io 聚合矩阵	没测该层	keep	keep	—
"负控制：依赖可读 ⇒ 无「cannot read module」诊断，门禁绿"	"回归（CLI 面）：**依赖模块不可读（EACCES）**不得被说成「文件不存在」， 也不得让异常冒到整轮外面。 口径（core 侧 load-guard + service 侧 ModuleReadError 同源）： - 不可读 ⇒ 一条明确诊断（写明「读不到」+ errno），严重级 error ⇒ 非零退出； 断言：expect(r.stdout).not.toContain(\"cannot read module\");；expect(r.stdout).toContain(\"run() => 0\");"	没测该层	keep	keep	—
export --format standard：Infinity 放行、null 拒绝（不再折成 null）；export --format all：bigint 字面量契约不再让整条命令崩溃（零产物）	cli-io 聚合矩阵	没测该层	keep	keep	—
CLI：--fix --write --dry-run 只打印计划、**不落盘**；CLI：--fix --write（不带 --dry-run）仍落盘（旧口径不回归）；CLI：--fix（不带 --write）只打印计划、不落盘（默认值不回归）	cli-io 聚合矩阵	没测该层	keep	keep	—
--json 面：stdout 非空 + 信封 ok:false + pathErrors[nudo:path-io] + exit 1；人类面：message + fix: 提示（不是裸 errno）+ exit 1；对照：缺文件走既有 nudo:path-not-found 信封（不被本次改动影响）	cli-io 聚合矩阵	没测该层	keep	keep	—
--json --gitlab：stdout 是 CheckJson 契约，stderr 是 Code Quality 数组；--json（无 --gitlab）：stderr 不含任何 CI 注解（不回归泄漏）；--gitlab（无 --json）：stdout 仍是恰好一份 Code Quality 数组（旧口径不变）	cli-io 聚合矩阵	没测该层	keep	keep	—
依赖文件缺失 ⇒ nudo:module-missing 上屏 + 门禁红（exit 1）；依赖文件存在但缺导出 ⇒ nudo:missing-export 上屏 + 门禁红（exit 1）；--json 面同码同 severity（error）且 ok=false；不双报：mock 文件缺失（mock 通道 + 模块图通道同码同文）只报一条	cli-io 聚合矩阵	没测该层	keep	keep	—
人类面：语法错块 + exit 1（此前 OK / exit 0）；--json 面：信封 ok:false + pathErrors[0].code=syntax-error；check --fix 不得静默跳过：残余 error ⇒ exit 1；磁盘缓存不得把「假绿」固化：连跑两轮都判红；纯 JS 文件不受影响：仍判绿（exit 0）；`.ts` 文件仍允许 TS 语法（按扩展名收紧，不误伤 TS 面）	cli-io 聚合矩阵	没测该层	keep	keep	—
profile:"bogus" + entryThrows:"warning" ⇒ 告警说 using warning（且不说 default strict）；profile:"bogus" 单独 ⇒ 仍是 using default strict（默认档文案不变）+ strict 门禁 exit 1；CLI --entry-throws warning 压过配置 profile typo ⇒ 告警说 using warning	cli-io 聚合矩阵	没测该层	keep	keep	—
--json 面：冷/热/热三轮 issues 逐条相同（dual-entry 各 1 条）；人类面：热轮的 issues 段只有一行 dual-entry；写盘口径：磁盘缓存条目里不含 nudo:dual-entry	cli-io 聚合矩阵	没测该层	keep	keep	—
CLI：--json --what-if ⇒ 显式 usage error（stdout 是机器可读信封）；CLI：--abs / --gha / --gitlab / --from / --watch 与 --what-if ⇒ 显式拒绝（exit 1）；CLI：多文件 --what-if 不再静默塌缩成第 1 个（显式报错）；CLI：单文件 + 无机器旗标的 --what-if 仍正常回答（旧口径不回归）	cli-io 聚合矩阵	没测该层	keep	keep	—
有环 / 无环：nudo check 的 exit code 逐字一致（门禁同判）；有环 / 无环：nudo check 的诊断文本逐字一致（归一化模块图形状诊断后）；一致结果里仍有 constraint-violated（跨模块的值没有塌成 unknown）；夹具非空转：有环夹具真被检出环（nudo test 面），无环夹具没有	cli-io 聚合矩阵	没测该层	keep	keep	—
单份 ---/+++ 头 + 路径字段无说明文字 + 相对路径（无 a// 双斜杠）；diff 可被 `git apply --check -p1` 消费（相对路径 ⇒ 剥掉 a/ 后是仓库内相对路径）	cli-io 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
module-missing（error）⇒ exit 1 且诊断上屏	dup:cli-io 聚合矩阵	commit:13806366
--json：ok=false 且 summary.errors 反映 error 计数	dup:cli-io 聚合矩阵	commit:13806366
干净文件：ok=true、errors=0、exit 0	dup:cli-io 聚合矩阵	commit:13806366
warning 级诊断（模块环）不得把 test 判红	dup:cli-io 聚合矩阵	commit:13806366
zod 入参槽 = z.array(z.unknown())（不是数组的数组）	dup:cli-io 聚合矩阵	commit:13806366
standard 面 rest 槽节点只有一层 arr（与 dts 的 ...rest: unknown[] 同形）	dup:cli-io 聚合矩阵	commit:13806366
`check clean.js --only <code> broken.js` ⇒ 定向 usage error + exit 1	dup:cli-io 聚合矩阵	commit:13806366
对照：把 variadic 旗标放在 `--` 前、路径放后面 ⇒ 正常检查（不误报）	dup:cli-io 聚合矩阵	commit:13806366
第二份 diff 以第一份为基准（累积），不是又一份「新建文件」	dup:cli-io 聚合矩阵	commit:13806366
dry-run 的 diff 可被 `git apply --check -p1` 消费	dup:cli-io 聚合矩阵	commit:13806366
dry-run 与 --write 得到同一份侧车内容	dup:cli-io 聚合矩阵	commit:13806366
拼错的码 ⇒ usage error + exit 1（不再静默 no-op）	dup:cli-io 聚合矩阵	commit:13806366
合法码但本次无该诊断 ⇒ 末尾报「matched no diagnostic」	dup:cli-io 聚合矩阵	commit:13806366
用户导出 `z` + zod 段 import ⇒ 产物可编译（tsc --strict rc 0）	dup:cli-io 聚合矩阵	commit:13806366
用户导出 `__nudoCheck`（standard 段的非导出 helper 同名）⇒ 不重复声明	dup:cli-io 聚合矩阵	commit:13806366
主路径：完全无证据的导出函数 ⇒ 参数 unknown，stderr 点名提示	dup:cli-io 聚合矩阵	commit:13806366
主路径：契约只覆盖部分形参时，未覆盖位同样是 unknown	dup:cli-io 聚合矩阵	commit:13806366
窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示	dup:cli-io 聚合矩阵	commit:13806366
test 文本面与 --json 面都带 nudo:recursion-truncated	dup:cli-io 聚合矩阵	commit:13806366
check 面同码同源（跨面口径一致，info 不挡门禁）	dup:cli-io 聚合矩阵	commit:13806366
collectNudoFiles 不收 dist/ 与 coverage/ 下的文件（改前：收进来）	dup:cli-io 聚合矩阵	commit:13806366
CLI check <pkg> 的文件集合里没有 dist/（改前：多出 dist/lib.js）	dup:cli-io 聚合矩阵	commit:13806366
CLI test <pkg> 不因陈旧构建产物而红（改前：exit 1 假红）	dup:cli-io 聚合矩阵	commit:13806366
跨面一致：CLI 目录发现与 IDE/vite 的 service 闸门对同一批文件给出相同结论	dup:cli-io 聚合矩阵	commit:13806366
--format standard：台账标题不再宣称 zod（没有 zod 产物）	dup:cli-io 聚合矩阵	commit:13806366
--format all：zod 台账与 standard 台账各一次（标题不再同名重复）	dup:cli-io 聚合矩阵	commit:13806366
--format dts：无台账（dts 面不携带 dropped 记录）	dup:cli-io 聚合矩阵	commit:13806366
路径不存在 ⇒ ok:false + summary.pathErrors = 1（summary.errors 仍只数诊断）	dup:cli-io 聚合矩阵	commit:13806366
绿运行 ⇒ 不带 pathErrors 字段（JSON 形态不漂移）	dup:cli-io 聚合矩阵	commit:13806366
zod：解构形参按**字段名**建顶层键（不再是内部占位 `_p0`）	dup:cli-io 聚合矩阵	commit:13806366
standard：解构形参的顶层槽是字段名（无占位名）	dup:cli-io 聚合矩阵	commit:13806366
负控制：数组解构的字段级契约仍是元组（Bug 394 口径不变）	dup:cli-io 聚合矩阵	commit:13806366
同一缺失路径给两次 ⇒ 只登记一条错误	dup:cli-io 聚合矩阵	commit:13806366
同一现场文件给两次 ⇒ 记录不重复（按调用点身份各一条）	dup:cli-io 聚合矩阵	commit:13806366
standard 段的槽键是原形参名（导出名让位，数据不动）	dup:cli-io 聚合矩阵	commit:13806366
负控制：--out 落盘的 standard 产物槽键同样是原形参名（两条投递路径同结论）	dup:cli-io 聚合矩阵	commit:13806366
同名两个模块 + 同模块重导 ⇒ 无编号副本、无陈旧内容	dup:cli-io 聚合矩阵	commit:13806366
幂等重导：内容不变时仍是一份产物	dup:cli-io 聚合矩阵	commit:13806366
optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` ⇒ exit 0、无 constraint-violated	dup:cli-io 聚合矩阵	commit:13806366
required 对照 + `{ a: undefined }` ⇒ exit 1 且报 nudo:constraint-violated	dup:cli-io 聚合矩阵	commit:13806366
required 对照 + `{ a: 'x' }` ⇒ exit 0（对照组正例）	dup:cli-io 聚合矩阵	commit:13806366
A 组（无调用点）：zod / standard 槽是一层数组，dts 同形	dup:cli-io 聚合矩阵	commit:13806366
A 组 standard 校验器**接受**该函数自己的合法调用 `{args:[1,2]}`	dup:cli-io 聚合矩阵	commit:13806366
对照组（有调用点证据）：同样是**一层**数组，接受集与 A 组一致	dup:cli-io 聚合矩阵	commit:13806366
--gha 单独 ⇒ 注解在 stdout（不回归）	dup:cli-io 聚合矩阵	commit:13806366
--gha --gitlab ⇒ stdout 仍是 GitLab 数组、stderr 有 ::error（不被丢弃）	dup:cli-io 聚合矩阵	commit:13806366
单变量对照：加 --json 后 GHA 计数不变（不再取决于无关旗标）	dup:cli-io 聚合矩阵	commit:13806366
check --from <使用现场> -- <被检查文件> ⇒ 报 nudo:contract-drift（改前 0 条）	dup:cli-io 聚合矩阵	commit:13806366
控制组：没有跨文件证据 ⇒ 不报 drift（无证据不判）	dup:cli-io 聚合矩阵	commit:13806366
归因闸：别的模块的同名调用点证据不得污染本文件的判定	dup:cli-io 聚合矩阵	commit:13806366
zod 入参面：数组解构 + 字段级契约 ⇒ 元组槽（改前是对象槽 `a`）	dup:cli-io 聚合矩阵	commit:13806366
standard 面：数组解构形参的槽节点是元组	dup:cli-io 聚合矩阵	commit:13806366
负控制：对象解构 + 字段级契约仍摊成对象槽（既有口径不变）	dup:cli-io 聚合矩阵	commit:13806366
负控制：无契约的数组解构仍是观测元组（既有口径不变）	dup:cli-io 聚合矩阵	commit:13806366
--target 指向函数名：返回域取自函数面（不再是 `() => ?`）	dup:cli-io 聚合矩阵	commit:13806366
两条面不再互相矛盾：--target 的返回域与签名表一致	dup:cli-io 聚合矩阵	commit:13806366
控制：--target 指向非函数绑定时行为不变	dup:cli-io 聚合矩阵	commit:13806366
控制：--target 指向不存在的名字时仍是 unknown	dup:cli-io 聚合矩阵	commit:13806366
类型专用的值位置 import 被消掉 ⇒ 产物 `node --check` 过且真 import() 成功	dup:cli-io 聚合矩阵	commit:13806366
产物里的 import 不得指向「没有该运行时导出」的模块（链接面）	dup:cli-io 聚合矩阵	commit:13806366
字段的 `x!` / `y?` 被剥 ⇒ 产物 `node --check` 过	dup:cli-io 聚合矩阵	commit:13806366
可选方法 `m?()` 被剥 ⇒ 产物 `node --check` 过	dup:cli-io 聚合矩阵	commit:13806366
`this` 形参被剥 ⇒ 产物 `node --check` 过且形参表只剩 `a`	dup:cli-io 聚合矩阵	commit:13806366
函数体里的 `this` **表达式**必须保留（只有形参位被删）	dup:cli-io 聚合矩阵	commit:13806366
第 1 条：排除清单上 stdout（--json 面可解析；文本面 stdout 不含被排除的包）	dup:cli-io 聚合矩阵	commit:13806366
第 1 条：retire --all --json 同样带排除清单（机器面统一口径）	dup:cli-io 聚合矩阵	commit:13806366
第 1 条 · 负控：无排除的 workspace ⇒ --json 逐字不变（不出现 excluded 键）	dup:cli-io 聚合矩阵	commit:13806366
第 2 条：多个目标失败 ⇒ 消息列出**全部**失败目标，且整批零写盘	dup:cli-io 聚合矩阵	commit:13806366
第 2 条：CLI 面 —— 失败目标全部可见（文本面 + --json 的 failedTargets）	dup:cli-io 聚合矩阵	commit:13806366
第 2 条：真错误与「无可退役」混在一批 ⇒ 报红（不再被当成正常结果吞成 exit 0）	dup:cli-io 聚合矩阵	commit:13806366
第 2 条 · 反向闸：单个失败 ⇒ 消息与旧实现逐字同形	dup:cli-io 聚合矩阵	commit:13806366
第 3 条：verify 的目标集合含 `.jsx`（JSX 产物不再对迁移闸门隐形）	dup:cli-io 聚合矩阵	commit:13806366
第 3 条 · 反向闸：声明文件 / 侧车**仍不是** verify 的目标（Bug 566 同口径不变）	dup:cli-io 聚合矩阵	commit:13806366
同目标内一个文件语法错 ⇒ 库面不 throw + 成功文件的结果仍返回	dup:cli-io 聚合矩阵	commit:13806366
原子性仍成立 ⇒ 有失败时一个字节都不落盘（含好文件）	dup:cli-io 聚合矩阵	commit:13806366
失败行带文件名 + 失败码与 migrateVerify 同码（同款结构）	dup:cli-io 聚合矩阵	commit:13806366
负控：全部成功 ⇒ 返回行的字段逐字不变（无 code / error 键）	dup:cli-io 聚合矩阵	commit:13806366
CLI 面：失败目标的 stdout/stderr 与旧版逐字同形（失败详情带文件名）	dup:cli-io 聚合矩阵	commit:13806366
stdout 里 helper / 类型别名各只出现一次（两个函数 ⇒ 两块）	dup:cli-io 聚合矩阵	commit:13806366
剥前导不丢内容：两个函数的导出体都在	dup:cli-io 聚合矩阵	commit:13806366
--out 落盘不变（每函数一份文件，各带一份 helper ⇒ 互不冲突）	dup:cli-io 聚合矩阵	commit:13806366
stdout 里 `fooOutput` 只声明一次（standard 段改名）	dup:cli-io 聚合矩阵	commit:13806366
stdout 流里没有重复的顶层声明（产物可编译）	dup:cli-io 聚合矩阵	commit:13806366
--out 落盘不变（各方言各占一个文件 ⇒ 产品名不漂移）	dup:cli-io 聚合矩阵	commit:13806366
stdout 里 `fooInput` 只声明一次（standard 段改名）	dup:cli-io 聚合矩阵	commit:13806366
dts 段不产 `<fn>Input`（报告的撞名对不存在 ⇒ 治的是 zod ↔ standard）	dup:cli-io 聚合矩阵	commit:13806366
--format standard 单方言时导出名不漂移（无冲突 ⇒ 不改名）	dup:cli-io 聚合矩阵	commit:13806366
zod 入参面：槽名取裸名、槽值是数组、不凭空造 argN 槽	dup:cli-io 聚合矩阵	commit:13806366
standard 面：剩余参数位导出名取裸名，节点是数组	dup:cli-io 聚合矩阵	commit:13806366
槽表把 `__proto__` 落为自有键（改前：普通对象 ⇒ 被原型 setter 吞掉）	dup:cli-io 聚合矩阵	commit:13806366
继承键（constructor / toString）同样不被原型吞掉	dup:cli-io 聚合矩阵	commit:13806366
产品面 zod Input 含 `__proto__` 形参（core 两处补丁后：projection 字段表无原型 + 键走计算键）	dup:cli-io 聚合矩阵	commit:13806366
同名函数在两个模块里 ⇒ 两份 standard 产物都在（先导出的不被覆盖）	dup:cli-io 聚合矩阵	commit:13806366
同名函数的第二份产物名带模块键后缀（不是同一个路径）	dup:cli-io 聚合矩阵	commit:13806366
zod 入参面：带默认值的形参位是可选槽（与 dts 面同口径）	dup:cli-io 聚合矩阵	commit:13806366
dts 面仍声明可选位 `b?`（两面的可选性口径一致）	dup:cli-io 聚合矩阵	commit:13806366
zod 返回面保留 promise 包装	dup:cli-io 聚合矩阵	commit:13806366
dts 面返回类型是 Promise<number>（不是 number）	dup:cli-io 聚合矩阵	commit:13806366
两个目录下的同名模块 ⇒ 两份 .d.ts 都在（先导出的不被覆盖）	dup:cli-io 聚合矩阵	commit:13806366
同 stem 模块 ⇒ zod / guard 面同样不互相覆盖	dup:cli-io 聚合矩阵	commit:13806366
--out 指向已有文件 ⇒ 提示不再指向不存在的 check --out	dup:cli-io 聚合矩阵	commit:13806366
目标路径是目录 ⇒ 写失败提示点名该文件且指向本命令（EISDIR 走写失败通道）	dup:cli-io 聚合矩阵	commit:13806366
分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误	dup:cli-io 聚合矩阵	commit:13806366
--from 路径错误**不**进 targetErrors[]（它是精确入口，不是副本）	dup:cli-io 聚合矩阵	commit:13806366
闸门错误 + `--from` 错误并存：pathErrors[] 全集（顺序不变）+ targetErrors[] 只装闸门	dup:cli-io 聚合矩阵	commit:13806366
--from 路径错误**不**进 targetErrors[]	dup:cli-io 聚合矩阵	commit:13806366
check --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors	dup:cli-io 聚合矩阵	commit:13806366
test --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors	dup:cli-io 聚合矩阵	commit:13806366
contract --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors	dup:cli-io 聚合矩阵	commit:13806366
人类面（闸门错误）：stderr 文案与改前逐字一致（机器面改动不外溢）	dup:cli-io 聚合矩阵	commit:13806366
人类面：文件名 + 行:列 + 摘录 + ^ 指位（不再是无路径的裸 message）	dup:cli-io 聚合矩阵	commit:13806366
--json 面：stdout 是 CaseJson 失败信封（pathErrors[{code:"syntax-error"}]）+ exit 1	dup:cli-io 聚合矩阵	commit:13806366
对照面：nudo check 对同一文件给同码 pathErrors（两个 verb 机器面同形）	dup:cli-io 聚合矩阵	commit:13806366
无 --freeze：报用法错误 + exit 1（旧行为：静默忽略 + exit 0）	dup:cli-io 聚合矩阵	commit:13806366
有 --freeze 无 --dry-run：仍是既有的「requires --dry-run」用法错误	dup:cli-io 聚合矩阵	commit:13806366
合法组合 --freeze --dry-run --exit-on-diff：照常跑（不误伤）	dup:cli-io 聚合矩阵	commit:13806366
print 形态 + 缺失路径：stdout 是合法 JSON 且带 pathErrors[] + exit 1	dup:cli-io 聚合矩阵	commit:13806366
draft 形态 + 缺失路径：同一套 pathErrors[]（三形态统一）	dup:cli-io 聚合矩阵	commit:13806366
全部路径都缺失（无 root）：stdout 仍是**非空**合法 JSON + pathErrors[] + exit 1	dup:cli-io 聚合矩阵	commit:13806366
对照面：非 --json 的人类面仍在 stderr（不因 --json 消失）	dup:cli-io 聚合矩阵	commit:13806366
进程内：CLI 半 + service 半（都走 src）⇒ `..data/f.js` 的草稿**写出来了**	dup:cli-io 聚合矩阵	commit:13806366
CLI 级：CLI 半**不再**用那句「is outside project root」拒写文案	dup:cli-io 聚合矩阵	commit:13806366
负控制：同一项目根下的普通文件照常写出（不误伤）	dup:cli-io 聚合矩阵	commit:13806366
migrate status <a> <b> ⇒ 两个包都被审计（不得只报第一个）	dup:cli-io 聚合矩阵	commit:13806366
migrate status --json <a> <b> ⇒ 顶层数组含两个 root	dup:cli-io 聚合矩阵	commit:13806366
单路径时行为不变（不得因多路径支持而破坏单路径）	dup:cli-io 聚合矩阵	commit:13806366
collectNudoFiles 收进链接进来的 .js（改前：静默跳过）	dup:cli-io 聚合矩阵	commit:13806366
符号链接目录被递归进入（改前：整棵链接目录被跳过）	dup:cli-io 聚合矩阵	commit:13806366
CLI check <dir>：链接进来的坏文件参与门禁（改前：exit 0 假绿）	dup:cli-io 聚合矩阵	commit:13806366
同一文件直传与目录扫描结论一致（不再一个绿一个红）	dup:cli-io 聚合矩阵	commit:13806366
产物必须落盘且能被 `node --check` 解析（成员修饰符已剥、参数属性已降级）	dup:cli-io 聚合矩阵	commit:13806366
命令层闸门是**兜底**：真源修好后常规路径不再触发它（不得误拦合法产物）	dup:cli-io 聚合矩阵	commit:13806366
对照：纯类型注解的 TS 源照常 strip（闸门不得过度拦截）	dup:cli-io 聚合矩阵	commit:13806366
解析器：等号形态切出 name/type（不是整串当绑定名）	dup:cli-io 聚合矩阵	commit:13806366
解析器：冒号形态不变（旧口径不回归）	dup:cli-io 聚合矩阵	commit:13806366
解析器：分隔符取最先出现的那个；无分隔符仍是 name=整串 / type=any	dup:cli-io 聚合矩阵	commit:13806366
CLI：等号形态的假设真的生效（绑定被应用，类型按假设打印）	dup:cli-io 聚合矩阵	commit:13806366
CLI：冒号形态仍然生效（两种写法同结果）	dup:cli-io 聚合矩阵	commit:13806366
1 个可退役包 ⇒ 顶层仍是数组（不得退化为对象）	dup:cli-io 聚合矩阵	commit:13806366
2 个可退役包 ⇒ 顶层同样是数组（形状不随条数漂移）	dup:cli-io 聚合矩阵	commit:13806366
两个场景的顶层形状一致（都是数组）	dup:cli-io 聚合矩阵	commit:13806366
产物含运行时 enum 对象 ⇒ `node --check` 过且 `E.A === 1`	dup:cli-io 聚合矩阵	commit:13806366
门禁行为正确：`.ts` 源与 `.js` 产物都绿，签名是 `f() => 1`（不再是 never）	dup:cli-io 聚合矩阵	commit:13806366
推导失败 + 期望 number() ⇒ unchecked + exit 0（改前：FAIL + exit 1）	dup:cli-io 聚合矩阵	commit:13806366
推导失败 + 期望 any() ⇒ 同样 unchecked（改前：空洞 ok「1 passed」）	dup:cli-io 聚合矩阵	commit:13806366
诊断文本区分「无法判定」与「类型不匹配」，并指向 nudo:opaque-result 的补证据路径	dup:cli-io 聚合矩阵	commit:13806366
--json 面：assertions = {passed: 0, failed: 0, unchecked: 1}	dup:cli-io 聚合矩阵	commit:13806366
负控制：推导成功 + 期望不符 ⇒ 仍是 FAIL / exit 1（既有行为不变）	dup:cli-io 聚合矩阵	commit:13806366
CLI：非 --json 面的人读文案不变（stderr 一行 + stdout 空 + exit 1）	dup:cli-io 聚合矩阵	commit:13806366
CLI：非 --json 面的其它用法错误文案不变（--exit-on-diff 无 --freeze）	dup:cli-io 聚合矩阵	commit:13806366
CLI：路径错误信封（对照）仍是 pathErrors 机器码，两条通道同形	dup:cli-io 聚合矩阵	commit:13806366
挂在被删语句上的 `/// @nudo:import` 必须在产物里存活	dup:cli-io 聚合矩阵	commit:13806366
门禁行为正确：源红 / 产物**同样红**（契约仍被绑定 ⇒ 不是假绿）	dup:cli-io 聚合矩阵	commit:13806366
import 不存在的模块 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）	dup:cli-io 聚合矩阵	commit:13806366
import 不存在的导出 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）	dup:cli-io 聚合矩阵	commit:13806366
--json 面：pathErrors 收录该失败 + exit 1（改前：pathErrors 为空 + exit 0）	dup:cli-io 聚合矩阵	commit:13806366
负控制：现场文件模块可解析且有调用 ⇒ call@ 而非 entry@ + exit 0	dup:cli-io 聚合矩阵	commit:13806366
负控制：现场文件模块可解析但没有调用 ⇒ 不报错 + exit 0	dup:cli-io 聚合矩阵	commit:13806366
回归锁：语法错现场仍是 parse failed + exit 1（口径不得被第三档改写）	dup:cli-io 聚合矩阵	commit:13806366
回归锁：顶层抛错现场仍是 evaluation failed + exit 1（口径不得被第三档改写）	dup:cli-io 聚合矩阵	commit:13806366
混合目录 ⇒ results 保留成功文件的逐文件结果（不再整目标丢弃）	dup:cli-io 聚合矩阵	commit:13806366
失败条目的 path 是**失败文件**（不是目标目录）⇒ 与 TS-only 闸门同量纲	dup:cli-io 聚合矩阵	commit:13806366
pathErrors[] 内所有 path 量纲一致（都是文件，不是目录）	dup:cli-io 聚合矩阵	commit:13806366
--write：成功行带库面的「未写盘」注记，且原子性不变（一个字节都不落盘）	dup:cli-io 聚合矩阵	commit:13806366
负控：全部成功 ⇒ stdout 仍是顶层数组（形状不变）	dup:cli-io 聚合矩阵	commit:13806366
验收 1：批内有失败文件 + --write ⇒ 人类面**不打** `wrote`，且磁盘上零产出	dup:cli-io 聚合矩阵	commit:13806366
验收 2：同场景 --json ⇒ results[] 的该行带**机器可判定**的「未写盘」标记	dup:cli-io 聚合矩阵	commit:13806366
验收 3：全部成功 + --write ⇒ 人类面照旧打 `wrote`，产物真实落盘，标记为「已写盘」	dup:cli-io 聚合矩阵	commit:13806366
验收 4：退出码语义不变（有失败 ⇒ 非 0；全成功 ⇒ 0）	dup:cli-io 聚合矩阵	commit:13806366
负控：dry-run（不带 --write）⇒ 人类面是 `dry`（不是 `wrote`），标记为「计划」	dup:cli-io 聚合矩阵	commit:13806366
库面：写盘轮逐行给写盘状态（有失败 ⇒ not-written；全成功 ⇒ written）	dup:cli-io 聚合矩阵	commit:13806366
注册表里存在该码（键名 migrateStripFailed）	dup:cli-io 聚合矩阵	commit:13806366
产出的 pathErrors[].code 等于注册表常量（不是另写的字面量）	dup:cli-io 聚合矩阵	commit:13806366
生产 src 不再残留该码的裸字面量赋值（`code: "nudo:…"` 形态）	dup:cli-io 聚合矩阵	commit:13806366
export --format standard：Infinity 放行、null 拒绝（不再折成 null）	dup:cli-io 聚合矩阵	commit:13806366
export --format all：bigint 字面量契约不再让整条命令崩溃（零产物）	dup:cli-io 聚合矩阵	commit:13806366
CLI：--fix --write --dry-run 只打印计划、**不落盘**	dup:cli-io 聚合矩阵	commit:13806366
CLI：--fix --write（不带 --dry-run）仍落盘（旧口径不回归）	dup:cli-io 聚合矩阵	commit:13806366
CLI：--fix（不带 --write）只打印计划、不落盘（默认值不回归）	dup:cli-io 聚合矩阵	commit:13806366
--json 面：stdout 非空 + 信封 ok:false + pathErrors[nudo:path-io] + exit 1	dup:cli-io 聚合矩阵	commit:13806366
人类面：message + fix: 提示（不是裸 errno）+ exit 1	dup:cli-io 聚合矩阵	commit:13806366
对照：缺文件走既有 nudo:path-not-found 信封（不被本次改动影响）	dup:cli-io 聚合矩阵	commit:13806366
--json --gitlab：stdout 是 CheckJson 契约，stderr 是 Code Quality 数组	dup:cli-io 聚合矩阵	commit:13806366
--json（无 --gitlab）：stderr 不含任何 CI 注解（不回归泄漏）	dup:cli-io 聚合矩阵	commit:13806366
--gitlab（无 --json）：stdout 仍是恰好一份 Code Quality 数组（旧口径不变）	dup:cli-io 聚合矩阵	commit:13806366
依赖文件缺失 ⇒ nudo:module-missing 上屏 + 门禁红（exit 1）	dup:cli-io 聚合矩阵	commit:13806366
依赖文件存在但缺导出 ⇒ nudo:missing-export 上屏 + 门禁红（exit 1）	dup:cli-io 聚合矩阵	commit:13806366
--json 面同码同 severity（error）且 ok=false	dup:cli-io 聚合矩阵	commit:13806366
不双报：mock 文件缺失（mock 通道 + 模块图通道同码同文）只报一条	dup:cli-io 聚合矩阵	commit:13806366
人类面：语法错块 + exit 1（此前 OK / exit 0）	dup:cli-io 聚合矩阵	commit:13806366
--json 面：信封 ok:false + pathErrors[0].code=syntax-error	dup:cli-io 聚合矩阵	commit:13806366
check --fix 不得静默跳过：残余 error ⇒ exit 1	dup:cli-io 聚合矩阵	commit:13806366
磁盘缓存不得把「假绿」固化：连跑两轮都判红	dup:cli-io 聚合矩阵	commit:13806366
纯 JS 文件不受影响：仍判绿（exit 0）	dup:cli-io 聚合矩阵	commit:13806366
`.ts` 文件仍允许 TS 语法（按扩展名收紧，不误伤 TS 面）	dup:cli-io 聚合矩阵	commit:13806366
profile:"bogus" + entryThrows:"warning" ⇒ 告警说 using warning（且不说 default strict）	dup:cli-io 聚合矩阵	commit:13806366
profile:"bogus" 单独 ⇒ 仍是 using default strict（默认档文案不变）+ strict 门禁 exit 1	dup:cli-io 聚合矩阵	commit:13806366
CLI --entry-throws warning 压过配置 profile typo ⇒ 告警说 using warning	dup:cli-io 聚合矩阵	commit:13806366
--json 面：冷/热/热三轮 issues 逐条相同（dual-entry 各 1 条）	dup:cli-io 聚合矩阵	commit:13806366
人类面：热轮的 issues 段只有一行 dual-entry	dup:cli-io 聚合矩阵	commit:13806366
写盘口径：磁盘缓存条目里不含 nudo:dual-entry	dup:cli-io 聚合矩阵	commit:13806366
CLI：--json --what-if ⇒ 显式 usage error（stdout 是机器可读信封）	dup:cli-io 聚合矩阵	commit:13806366
CLI：--abs / --gha / --gitlab / --from / --watch 与 --what-if ⇒ 显式拒绝（exit 1）	dup:cli-io 聚合矩阵	commit:13806366
CLI：多文件 --what-if 不再静默塌缩成第 1 个（显式报错）	dup:cli-io 聚合矩阵	commit:13806366
CLI：单文件 + 无机器旗标的 --what-if 仍正常回答（旧口径不回归）	dup:cli-io 聚合矩阵	commit:13806366
有环 / 无环：nudo check 的 exit code 逐字一致（门禁同判）	dup:cli-io 聚合矩阵	commit:13806366
有环 / 无环：nudo check 的诊断文本逐字一致（归一化模块图形状诊断后）	dup:cli-io 聚合矩阵	commit:13806366
一致结果里仍有 constraint-violated（跨模块的值没有塌成 unknown）	dup:cli-io 聚合矩阵	commit:13806366
夹具非空转：有环夹具真被检出环（nudo test 面），无环夹具没有	dup:cli-io 聚合矩阵	commit:13806366
单份 ---/+++ 头 + 路径字段无说明文字 + 相对路径（无 a// 双斜杠）	dup:cli-io 聚合矩阵	commit:13806366
diff 可被 `git apply --check -p1` 消费（相对路径 ⇒ 剥掉 a/ 后是仓库内相对路径）	dup:cli-io 聚合矩阵	commit:13806366
```
