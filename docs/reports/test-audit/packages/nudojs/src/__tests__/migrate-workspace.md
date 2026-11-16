# packages/nudojs/src/__tests__/migrate-workspace.test.ts

migrate workspace 面（pnpm/npm/yaml/GHA/workflow/脚本定位）。

审计：100 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
两处相同命令 ⇒ 报告 2 条（带位置）、落盘 2 处、status 数到 0（已改写）；反向闸：单处改写仍只记 1 条（不得因加位置而重复计数）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
rewriteWorkflowText 把块标量当成一条命令改写；retire 后落盘的 workflow 仍是合法 YAML 形态且命令语义正确	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
子包：不继承仓库根共享 workflow 的 tsc 行；根包：共享 workflow 的 tsc 行算在它头上（只算一次）；子包 retire 成功后 blocker 清空（status 与 retire 不再矛盾）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
stdout 非空、可解析、ok:false、error 点名 action；人类面（无 --json）：错误仍进 stderr；反向闸：合法 action 的 --json 仍是合法 JSON	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
数值 enum：`A = 1, B = A * 10, C` ⇒ [1,10,11]；混合 enum：`A = 1, B = 'b', C = A + 5` ⇒ [1,"b",6]；字符串 enum：`A = 'a', B = A + 'b'` ⇒ ["a","ab"] 且不建反向映射；const enum：`A = 1, B = A * 3` ⇒ [1,3]；strip 的 note 仍声明语义已保住（现在与事实一致）；反向闸：无计算成员的 enum 产物不变（不引入多余改	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
脚本名不含 check/test、命令是 nudo check ⇒ 不得报「no nudo check/test script yet」；retire 改写后的形态 `npx nudojs check .` 同样算已有门禁（旧口径匹配不到 nudojs）；`nudo test` 也是门禁；反向闸：命令里没有 nudo 门禁 ⇒ 仍必须报该阻塞（判定不是恒假）；字符串里的 nudo check 不算门禁（shell 掩码口径不变）；文本面不再出现该假阻塞	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
peerDependencies.typescript ⇒ typescriptDep 为 true 且报出阻塞；devDependencies / dependencies 口径不回退；optionalDependencies.typescript 也算（四个来源同一口径）；反向闸：没有 typescript 依赖 ⇒ typescriptDep 为 false（判定不是恒真）；mergePackageDeps 合并四个依赖来源，且忽略非对象字段	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
根包自己 0 个 .ts ⇒ 根行 tsFiles 为 0（不重复计入子包）；反向闸：根包自己有 .ts 时，根行仍要数到自己的文件；子包的 .tsx 也只算在子包行	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
库面：package.json 出现 scripts.check:nudo（报告与落盘一致）；CLI 面：--json 报文里报改了，落盘也得有；反向闸：已有 scripts 键的包，注入也落进**既有** scripts 对象（不丢原有脚本）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
status 的 tsc 行数只数真正的命令行（1 条，不是 3 条）；retire 后 env 值 / 描述文字逐字未变，只有 run: 那条被改写；status 的 workflow blocker 计数与改写口径一致	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
rewriteWorkflowText 改写引号标量里的 tsc（保留原引号风格）；status 的 tsc 行数与真实条数一致（3 条，不是 1 条）；retire 后 CI 里不再残留 tsc 门禁	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
status 能看到对象式 workspaces 的子包（改前：整行消失）；retire --all 把对象式 workspaces 的子包纳入作用域并真的退役（落盘可见）；CLI：migrate status 的 stdout 列出对象式 workspaces 的子包（exit 0）；对照组：数组式 workspaces 仍然可见（回归护栏，不被本次改动带坏）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
status 不列出被 pnpm 排除的包（改前：legacy 占一行）；retire --all 只退役未被排除的包；retire --all 不改写被排除的包：package.json 逐字不变、不写 marker；CLI：retire --all --dry-run 的 stdout 不含被排除的包，stderr 显式说明跳过；CLI：retire --all 不落盘到被排除的包（package.json 不变）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
build（tsc -p tsconfig.build.json）原样保留，门禁脚本照常改写；只有编译脚本的包：明确拒绝退役，脚本零改动；CLI 面：build 不被改写；反向闸：纯门禁脚本照常改写 + 摘依赖（断言非永真）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
import "./helper" ⇒ 产物写 "./helper.js"；export … from 也被改写；包说明符不动（非相对说明符不在 ESM 扩展名规则的范围内）；相对说明符指向目录 ⇒ 补成目录索引（./dir → ./dir/index.js）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
解析失败 ⇒ blockers 显式报出 + packageJsonError 字段；文本面出现解析失败行；JSON 面带 packageJsonError 且 stdout 是合法 JSON；反向闸：合法 package.json ⇒ 无 packageJsonError、无该阻塞；反向闸：package.json 不存在 ≠ 解析失败（missing 不算错误）；readPackageJsonDetailed 分类：missing / ok / invalid	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
blockers 数组里没有「—」元素；文本面只有真 blocker，不带占位符；反向闸：真有 blocker 时占位符也不得混入（防御性过滤）；反向闸：只有占位符 ⇒ 文本面不出现 blockers 行	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
已有 keep.ts.bak ⇒ 换名留底（keep.ts.1.bak），且旧备份原样保留；备份动作在输出里有一行明确交代（源是否被改名是可观测事实）；没有撞名时备份名仍是 <file>.bak	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
JSON 面 blockers 为空数组（不是 ['—']）；API 面同样为空数组；反向闸：真有 blocker 时数组里是那条 blocker（判定不是恒空）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
status 列出嵌套成员（一层与深层都在）；retire --all 把嵌套成员纳入作用域并真的退役（落盘可见）；多段 pattern（两层 `*`）不再被整条丢弃；CLI：migrate status 的 stdout 列出嵌套成员（改前：整行缺席）；CLI：retire --all --dry-run 不再报 nothing to retire（改前：假绿 exit 0）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
API 面不抛，null 脚本不算 tsc；CLI 面 exit 0 且不出现裸 TypeError；CLI --json 面也正常（exit 0 + 合法 JSON）；反向闸：字符串脚本照常被识别（判定不是恒空）；scriptCommandEntries 只收字符串值	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
库面：仓库根的共享 workflow 零改动，根包 package.json 零改动；CLI 面：仓库根的共享 workflow 零改动，且不被报告；反向闸：被退役包**自有**的 workflow 照常改写	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
strip --write 后：目录级分析只收一份（源 .ts 与产物 .js 是同一模块）；check --json 的计数：默认路径与 --backup 路径相同（都等于模块数）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
rewriteTscCommand 不把 ${{ … }} 切开；shell 变量 / glob 不被单引号封死（展开仍由 shell / CI 负责）；retire 后 CI 步骤里不再有被截断的表达式路径	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
旗标值里的命令替换被整体消费（不留尾巴）；-p 的值是命令替换时不得产出 '$'( … ) 这种坏语法；算术替换 / 进程替换同样整体消费；命令替换内部的 tsc 调用同样被退役（独立命令上下文）；tsc 之后的独立命令（&& 之后）原样保留；retire 落盘的脚本是合法命令（无悬空 $() / 反引号）	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
非命令位置的 tsc 一律不改写；命令位置的 tsc 仍然改写（含透明包装器后的首个参数）；status 不把非命令位的 tsc 计入 tsc scripts；retire 后非命令位的 tsc 逐字未变	migrate-workspace 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
两处相同命令 ⇒ 报告 2 条（带位置）、落盘 2 处、status 数到 0（已改写）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：单处改写仍只记 1 条（不得因加位置而重复计数）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
rewriteWorkflowText 把块标量当成一条命令改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 后落盘的 workflow 仍是合法 YAML 形态且命令语义正确	dup:migrate-workspace 聚合矩阵	commit:14f49e20
子包：不继承仓库根共享 workflow 的 tsc 行	dup:migrate-workspace 聚合矩阵	commit:14f49e20
根包：共享 workflow 的 tsc 行算在它头上（只算一次）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
子包 retire 成功后 blocker 清空（status 与 retire 不再矛盾）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
stdout 非空、可解析、ok:false、error 点名 action	dup:migrate-workspace 聚合矩阵	commit:14f49e20
人类面（无 --json）：错误仍进 stderr	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：合法 action 的 --json 仍是合法 JSON	dup:migrate-workspace 聚合矩阵	commit:14f49e20
数值 enum：`A = 1, B = A * 10, C` ⇒ [1,10,11]	dup:migrate-workspace 聚合矩阵	commit:14f49e20
混合 enum：`A = 1, B = 'b', C = A + 5` ⇒ [1,"b",6]	dup:migrate-workspace 聚合矩阵	commit:14f49e20
字符串 enum：`A = 'a', B = A + 'b'` ⇒ ["a","ab"] 且不建反向映射	dup:migrate-workspace 聚合矩阵	commit:14f49e20
const enum：`A = 1, B = A * 3` ⇒ [1,3]	dup:migrate-workspace 聚合矩阵	commit:14f49e20
strip 的 note 仍声明语义已保住（现在与事实一致）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：无计算成员的 enum 产物不变（不引入多余改写）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
脚本名不含 check/test、命令是 nudo check ⇒ 不得报「no nudo check/test script yet」	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 改写后的形态 `npx nudojs check .` 同样算已有门禁（旧口径匹配不到 nudojs）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
`nudo test` 也是门禁	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：命令里没有 nudo 门禁 ⇒ 仍必须报该阻塞（判定不是恒假）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
字符串里的 nudo check 不算门禁（shell 掩码口径不变）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
文本面不再出现该假阻塞	dup:migrate-workspace 聚合矩阵	commit:14f49e20
peerDependencies.typescript ⇒ typescriptDep 为 true 且报出阻塞	dup:migrate-workspace 聚合矩阵	commit:14f49e20
devDependencies / dependencies 口径不回退	dup:migrate-workspace 聚合矩阵	commit:14f49e20
optionalDependencies.typescript 也算（四个来源同一口径）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：没有 typescript 依赖 ⇒ typescriptDep 为 false（判定不是恒真）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
mergePackageDeps 合并四个依赖来源，且忽略非对象字段	dup:migrate-workspace 聚合矩阵	commit:14f49e20
根包自己 0 个 .ts ⇒ 根行 tsFiles 为 0（不重复计入子包）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：根包自己有 .ts 时，根行仍要数到自己的文件	dup:migrate-workspace 聚合矩阵	commit:14f49e20
子包的 .tsx 也只算在子包行	dup:migrate-workspace 聚合矩阵	commit:14f49e20
库面：package.json 出现 scripts.check:nudo（报告与落盘一致）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI 面：--json 报文里报改了，落盘也得有	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：已有 scripts 键的包，注入也落进**既有** scripts 对象（不丢原有脚本）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 的 tsc 行数只数真正的命令行（1 条，不是 3 条）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 后 env 值 / 描述文字逐字未变，只有 run: 那条被改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 的 workflow blocker 计数与改写口径一致	dup:migrate-workspace 聚合矩阵	commit:14f49e20
rewriteWorkflowText 改写引号标量里的 tsc（保留原引号风格）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 的 tsc 行数与真实条数一致（3 条，不是 1 条）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 后 CI 里不再残留 tsc 门禁	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 能看到对象式 workspaces 的子包（改前：整行消失）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire --all 把对象式 workspaces 的子包纳入作用域并真的退役（落盘可见）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI：migrate status 的 stdout 列出对象式 workspaces 的子包（exit 0）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
对照组：数组式 workspaces 仍然可见（回归护栏，不被本次改动带坏）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 不列出被 pnpm 排除的包（改前：legacy 占一行）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire --all 只退役未被排除的包	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire --all 不改写被排除的包：package.json 逐字不变、不写 marker	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI：retire --all --dry-run 的 stdout 不含被排除的包，stderr 显式说明跳过	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI：retire --all 不落盘到被排除的包（package.json 不变）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
build（tsc -p tsconfig.build.json）原样保留，门禁脚本照常改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
只有编译脚本的包：明确拒绝退役，脚本零改动	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI 面：build 不被改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：纯门禁脚本照常改写 + 摘依赖（断言非永真）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
import "./helper" ⇒ 产物写 "./helper.js"	dup:migrate-workspace 聚合矩阵	commit:14f49e20
export … from 也被改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
包说明符不动（非相对说明符不在 ESM 扩展名规则的范围内）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
相对说明符指向目录 ⇒ 补成目录索引（./dir → ./dir/index.js）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
解析失败 ⇒ blockers 显式报出 + packageJsonError 字段	dup:migrate-workspace 聚合矩阵	commit:14f49e20
文本面出现解析失败行	dup:migrate-workspace 聚合矩阵	commit:14f49e20
JSON 面带 packageJsonError 且 stdout 是合法 JSON	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：合法 package.json ⇒ 无 packageJsonError、无该阻塞	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：package.json 不存在 ≠ 解析失败（missing 不算错误）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
readPackageJsonDetailed 分类：missing / ok / invalid	dup:migrate-workspace 聚合矩阵	commit:14f49e20
blockers 数组里没有「—」元素	dup:migrate-workspace 聚合矩阵	commit:14f49e20
文本面只有真 blocker，不带占位符	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：真有 blocker 时占位符也不得混入（防御性过滤）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：只有占位符 ⇒ 文本面不出现 blockers 行	dup:migrate-workspace 聚合矩阵	commit:14f49e20
已有 keep.ts.bak ⇒ 换名留底（keep.ts.1.bak），且旧备份原样保留	dup:migrate-workspace 聚合矩阵	commit:14f49e20
备份动作在输出里有一行明确交代（源是否被改名是可观测事实）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
没有撞名时备份名仍是 <file>.bak	dup:migrate-workspace 聚合矩阵	commit:14f49e20
JSON 面 blockers 为空数组（不是 ['—']）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
API 面同样为空数组	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：真有 blocker 时数组里是那条 blocker（判定不是恒空）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 列出嵌套成员（一层与深层都在）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire --all 把嵌套成员纳入作用域并真的退役（落盘可见）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
多段 pattern（两层 `*`）不再被整条丢弃	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI：migrate status 的 stdout 列出嵌套成员（改前：整行缺席）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI：retire --all --dry-run 不再报 nothing to retire（改前：假绿 exit 0）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
API 面不抛，null 脚本不算 tsc	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI 面 exit 0 且不出现裸 TypeError	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI --json 面也正常（exit 0 + 合法 JSON）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：字符串脚本照常被识别（判定不是恒空）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
scriptCommandEntries 只收字符串值	dup:migrate-workspace 聚合矩阵	commit:14f49e20
库面：仓库根的共享 workflow 零改动，根包 package.json 零改动	dup:migrate-workspace 聚合矩阵	commit:14f49e20
CLI 面：仓库根的共享 workflow 零改动，且不被报告	dup:migrate-workspace 聚合矩阵	commit:14f49e20
反向闸：被退役包**自有**的 workflow 照常改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
strip --write 后：目录级分析只收一份（源 .ts 与产物 .js 是同一模块）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
check --json 的计数：默认路径与 --backup 路径相同（都等于模块数）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
rewriteTscCommand 不把 ${{ … }} 切开	dup:migrate-workspace 聚合矩阵	commit:14f49e20
shell 变量 / glob 不被单引号封死（展开仍由 shell / CI 负责）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 后 CI 步骤里不再有被截断的表达式路径	dup:migrate-workspace 聚合矩阵	commit:14f49e20
旗标值里的命令替换被整体消费（不留尾巴）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
-p 的值是命令替换时不得产出 '$'( … ) 这种坏语法	dup:migrate-workspace 聚合矩阵	commit:14f49e20
算术替换 / 进程替换同样整体消费	dup:migrate-workspace 聚合矩阵	commit:14f49e20
命令替换内部的 tsc 调用同样被退役（独立命令上下文）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
tsc 之后的独立命令（&& 之后）原样保留	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 落盘的脚本是合法命令（无悬空 $() / 反引号）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
非命令位置的 tsc 一律不改写	dup:migrate-workspace 聚合矩阵	commit:14f49e20
命令位置的 tsc 仍然改写（含透明包装器后的首个参数）	dup:migrate-workspace 聚合矩阵	commit:14f49e20
status 不把非命令位的 tsc 计入 tsc scripts	dup:migrate-workspace 聚合矩阵	commit:14f49e20
retire 后非命令位的 tsc 逐字未变	dup:migrate-workspace 聚合矩阵	commit:14f49e20
```
