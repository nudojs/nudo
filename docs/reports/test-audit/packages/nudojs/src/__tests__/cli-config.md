# packages/nudojs/src/__tests__/cli-config.test.ts

模块套件：nudojs env/config/init/freeze/mock/threshold 面。

审计：79 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）；白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误	cli-config 聚合矩阵	没测该层	keep	keep	—
首轮 add 之后的 update 把见证名改成真实行号，且再跑一次幂等；已正确的见证不被改错（写盘污染回归）；过期见证被刷新（不再「no changes」）；update 运行的展示面含已冻结的指令 case（不退回剥离坐标系的 entry@）；普通 test 对同一次调用只记一条（指令见证与合成调用点不并存）	cli-config 聚合矩阵	没测该层	keep	keep	—
update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）；health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少；真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）	cli-config 聚合矩阵	没测该层	keep	keep	—
重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline；单个非法值（对照）：同样落盘为基线且加载器可见	cli-config 聚合矩阵	没测该层	keep	keep	—
帮助文本承诺 update | add，且两个模式都能被实现接受；非法取值仍被拒（且错误文案列出的合法取值与帮助一致）	cli-config 聚合矩阵	没测该层	keep	keep	—
--freeze=add --dry-run：exit 0（旧行为：exit 1 + Invalid --freeze value）；--freeze=add 与省略取值（默认 add）产出逐字一致；--freeze=update 仍是 update 模式（不回归）；非法取值仍被拒 + exit 1	cli-config 聚合矩阵	没测该层	keep	keep	—
nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线；nudo 值为标量（形状非法）⇒ init 写入基线；nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）；nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写	cli-config 聚合矩阵	没测该层	keep	keep	—
祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变；拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1；没有祖先配置时 init 照常写基线（不得过度拦截）	cli-config 聚合矩阵	没测该层	keep	keep	—
未声明 workspace 的 monorepo（packages/* 形态）⇒ 不假拒绝（Bug 35 新口径）；pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘；package.json#workspaces ⇒ 同样拒绝写盘；单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）	cli-config 聚合矩阵	没测该层	keep	keep	—
package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1；package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）；真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）	cli-config 聚合矩阵	没测该层	keep	keep	—
4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员；整数样键的相对顺序不变（JSON.parse 会把它们重排）；紧凑单行文件 ⇒ 保持紧凑（不引入换行）；已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动	cli-config 聚合矩阵	没测该层	keep	keep	—
单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）；CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]；CLI：无路径错误时信封计数 = 人类面计数（未回归）；CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）	cli-config 聚合矩阵	没测该层	keep	keep	—
语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名；一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢；全成功 ⇒ stdout 仍是顶��数组（形状不变）；非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout	cli-config 聚合矩阵	没测该层	keep	keep	—
人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape；机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）；其它形状（布尔 / 对象）同样不裸崩 + 报告面可见；合法 env 数组：无 config-shape 告警（未回归）	cli-config 聚合矩阵	没测该层	keep	keep	—
check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）；check 面与 test 面结论一致（同一文件、同一个精确签名）	cli-config 聚合矩阵	没测该层	keep	keep	—
人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）；--json 面同码同 severity（warning）	cli-config 聚合矩阵	没测该层	keep	keep	—
加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）；死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）；死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）；反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）；显式 init <容器根>：写盘 + 作用域告警（不越界）；从容器根的子目录 init：拒绝越界写盘（exit 1）	cli-config 聚合矩阵	没测该层	keep	keep	—
mock 表达式解析失败 ⇒ warning（不红门禁）；mock 文件缺失仍是 error（不引入假绿）；负控制：文件面只出现一条 mock-invalid（无重复报告）	cli-config 聚合矩阵	没测该层	keep	keep	—
check --json：config-shape warning 进 issues 段；check 人类面：issues 段看得见 config-shape；health 人类面：config 提示行可见；health --json：configShape 字段可见；936：假值 nudo 键（false）同样可见（且措辞说 falsy）；负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断	cli-config 聚合矩阵	没测该层	keep	keep	—
缓存命中轮：config-shape 仍恰 1 条（不重复）；键被改好后：陈旧的 config-shape 告警不得留在缓存里	cli-config 聚合矩阵	没测该层	keep	keep	—
字符串 env：不裸崩 + 人类面产出 config-shape 形状告警；字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved；env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条；env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:["node"] ⇒ Buffer 可用；env 无关型代码：	cli-config 聚合矩阵	没测该层	keep	keep	—
子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0；根目录文件：口径不变（magic() => 42、exit 0）；项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）	cli-config 聚合矩阵	没测该层	keep	keep	—
CLI：非 --json 面仍是 stderr 文案 + exit 1（旧口径不回归）；CLI：非 --json 面的组合拒绝仍是 stderr 文案（--fix + --watch）	cli-config 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）	dup:cli-config 聚合矩阵	commit:14f49e20
白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误	dup:cli-config 聚合矩阵	commit:14f49e20
首轮 add 之后的 update 把见证名改成真实行号，且再跑一次幂等	dup:cli-config 聚合矩阵	commit:14f49e20
已正确的见证不被改错（写盘污染回归）	dup:cli-config 聚合矩阵	commit:14f49e20
过期见证被刷新（不再「no changes」）	dup:cli-config 聚合矩阵	commit:14f49e20
update 运行的展示面含已冻结的指令 case（不退回剥离坐标系的 entry@）	dup:cli-config 聚合矩阵	commit:14f49e20
普通 test 对同一次调用只记一条（指令见证与合成调用点不并存）	dup:cli-config 聚合矩阵	commit:14f49e20
update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）	dup:cli-config 聚合矩阵	commit:14f49e20
health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少	dup:cli-config 聚合矩阵	commit:14f49e20
真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）	dup:cli-config 聚合矩阵	commit:14f49e20
重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline	dup:cli-config 聚合矩阵	commit:14f49e20
单个非法值（对照）：同样落盘为基线且加载器可见	dup:cli-config 聚合矩阵	commit:14f49e20
帮助文本承诺 update | add，且两个模式都能被实现接受	dup:cli-config 聚合矩阵	commit:14f49e20
非法取值仍被拒（且错误文案列出的合法取值与帮助一致）	dup:cli-config 聚合矩阵	commit:14f49e20
--freeze=add --dry-run：exit 0（旧行为：exit 1 + Invalid --freeze value）	dup:cli-config 聚合矩阵	commit:14f49e20
--freeze=add 与省略取值（默认 add）产出逐字一致	dup:cli-config 聚合矩阵	commit:14f49e20
--freeze=update 仍是 update 模式（不回归）	dup:cli-config 聚合矩阵	commit:14f49e20
非法取值仍被拒 + exit 1	dup:cli-config 聚合矩阵	commit:14f49e20
nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线	dup:cli-config 聚合矩阵	commit:14f49e20
nudo 值为标量（形状非法）⇒ init 写入基线	dup:cli-config 聚合矩阵	commit:14f49e20
nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）	dup:cli-config 聚合矩阵	commit:14f49e20
nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写	dup:cli-config 聚合矩阵	commit:14f49e20
祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变	dup:cli-config 聚合矩阵	commit:14f49e20
拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1	dup:cli-config 聚合矩阵	commit:14f49e20
没有祖先配置时 init 照常写基线（不得过度拦截）	dup:cli-config 聚合矩阵	commit:14f49e20
未声明 workspace 的 monorepo（packages/* 形态）⇒ 不假拒绝（Bug 35 新口径）	dup:cli-config 聚合矩阵	commit:14f49e20
pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘	dup:cli-config 聚合矩阵	commit:14f49e20
package.json#workspaces ⇒ 同样拒绝写盘	dup:cli-config 聚合矩阵	commit:14f49e20
单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）	dup:cli-config 聚合矩阵	commit:14f49e20
package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1	dup:cli-config 聚合矩阵	commit:14f49e20
package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）	dup:cli-config 聚合矩阵	commit:14f49e20
真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）	dup:cli-config 聚合矩阵	commit:14f49e20
4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员	dup:cli-config 聚合矩阵	commit:14f49e20
整数样键的相对顺序不变（JSON.parse 会把它们重排）	dup:cli-config 聚合矩阵	commit:14f49e20
紧凑单行文件 ⇒ 保持紧凑（不引入换行）	dup:cli-config 聚合矩阵	commit:14f49e20
已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动	dup:cli-config 聚合矩阵	commit:14f49e20
单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）	dup:cli-config 聚合矩阵	commit:14f49e20
CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]	dup:cli-config 聚合矩阵	commit:14f49e20
CLI：无路径错误时信封计数 = 人类面计数（未回归）	dup:cli-config 聚合矩阵	commit:14f49e20
CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）	dup:cli-config 聚合矩阵	commit:14f49e20
语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名	dup:cli-config 聚合矩阵	commit:14f49e20
一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢	dup:cli-config 聚合矩阵	commit:14f49e20
全成功 ⇒ stdout 仍是顶��数组（形状不变）	dup:cli-config 聚合矩阵	commit:14f49e20
非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout	dup:cli-config 聚合矩阵	commit:14f49e20
人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape	dup:cli-config 聚合矩阵	commit:14f49e20
机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）	dup:cli-config 聚合矩阵	commit:14f49e20
其它形状（布尔 / 对象）同样不裸崩 + 报告面可见	dup:cli-config 聚合矩阵	commit:14f49e20
合法 env 数组：无 config-shape 告警（未回归）	dup:cli-config 聚合矩阵	commit:14f49e20
check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）	dup:cli-config 聚合矩阵	commit:14f49e20
check 面与 test 面结论一致（同一文件、同一个精确签名）	dup:cli-config 聚合矩阵	commit:14f49e20
人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）	dup:cli-config 聚合矩阵	commit:14f49e20
--json 面同码同 severity（warning）	dup:cli-config 聚合矩阵	commit:14f49e20
加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）	dup:cli-config 聚合矩阵	commit:14f49e20
死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）	dup:cli-config 聚合矩阵	commit:14f49e20
死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）	dup:cli-config 聚合矩阵	commit:14f49e20
反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）	dup:cli-config 聚合矩阵	commit:14f49e20
显式 init <容器根>：写盘 + 作用域告警（不越界）	dup:cli-config 聚合矩阵	commit:14f49e20
从容器根的子目录 init：拒绝越界写盘（exit 1）	dup:cli-config 聚合矩阵	commit:14f49e20
mock 表达式解析失败 ⇒ warning（不红门禁）	dup:cli-config 聚合矩阵	commit:14f49e20
mock 文件缺失仍是 error（不引入假绿）	dup:cli-config 聚合矩阵	commit:14f49e20
负控制：文件面只出现一条 mock-invalid（无重复报告）	dup:cli-config 聚合矩阵	commit:14f49e20
check --json：config-shape warning 进 issues 段	dup:cli-config 聚合矩阵	commit:14f49e20
check 人类面：issues 段看得见 config-shape	dup:cli-config 聚合矩阵	commit:14f49e20
health 人类面：config 提示行可见	dup:cli-config 聚合矩阵	commit:14f49e20
health --json：configShape 字段可见	dup:cli-config 聚合矩阵	commit:14f49e20
936：假值 nudo 键（false）同样可见（且措辞说 falsy）	dup:cli-config 聚合矩阵	commit:14f49e20
负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断	dup:cli-config 聚合矩阵	commit:14f49e20
缓存命中轮：config-shape 仍恰 1 条（不重复）	dup:cli-config 聚合矩阵	commit:14f49e20
键被改好后：陈旧的 config-shape 告警不得留在缓存里	dup:cli-config 聚合矩阵	commit:14f49e20
字符串 env：不裸崩 + 人类面产出 config-shape 形状告警	dup:cli-config 聚合矩阵	commit:14f49e20
字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved	dup:cli-config 聚合矩阵	commit:14f49e20
env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条	dup:cli-config 聚合矩阵	commit:14f49e20
env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:["node"] ⇒ Buffer 可用	dup:cli-config 聚合矩阵	commit:14f49e20
env 无关型代码：被忽略的 env 不制造假的 nudo:unknown-inference	dup:cli-config 聚合矩阵	commit:14f49e20
子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0	dup:cli-config 聚合矩阵	commit:14f49e20
根目录文件：口径不变（magic() => 42、exit 0）	dup:cli-config 聚合矩阵	commit:14f49e20
项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）	dup:cli-config 聚合矩阵	commit:14f49e20
CLI：非 --json 面仍是 stderr 文案 + exit 1（旧口径不回归）	dup:cli-config 聚合矩阵	commit:14f49e20
CLI：非 --json 面的组合拒绝仍是 stderr 文案（--fix + --watch）	dup:cli-config 聚合矩阵	commit:14f49e20
```
