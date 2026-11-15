# packages/nudojs/src/__tests__/cli-config.test.ts

模块套件：79 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）"	"见证真的写回了源码（不是「静默什么都不做」） `nudo test --freeze <path>`（旗标在前、路径在后——CLI 的惯用形式） 把路径吞成 `--freeze` 的**取值** ⇒ 必然报「needs at least one path」⇒ 该功能 在文档/惯例给出的调用形式下**不可达**。 根因：`commands/test.ts` 的 `.option(\"--freeze [mode]\")` 是 commander 的 **可选取值**形式（全 CLI 唯一一处）⇒ 紧跟其后的非选项参数被当"	没测该层	keep	keep	—
"白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误"	"`nudo test --freeze <path>`（旗标在前、路径在后——CLI 的惯用形式） 把路径吞成 `--freeze` 的**取值** ⇒ 必然报「needs at least one path」⇒ 该功能 在文档/惯例给出的调用形式下**不可达**。 根因：`commands/test.ts` 的 `.option(\"--freeze [mode]\")` 是 commander 的 **可选取值**形式（全 CLI 唯一一处）⇒ 紧跟其后的非选项参数被当成取值。"	没测该层	keep	keep	—
"首轮 add 之后的 update 把见证名改成真实行号，且再跑一次幂等"	"首轮 add 的块插在声明上方 ⇒ 名字（基源坐标）必然过期 ② 幂等：第二次 update 不改写、不报 diff `nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回： - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的 调用点在第 5 行，但写回的文件里它在第 8 行； - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；"	没测该层	keep	keep	—
"已正确的见证不被改错（写盘污染回归）"	"`nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回： - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的 调用点在第 5 行，但写回的文件里它在第 8 行； - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；"	没测该层	keep	keep	—
"过期见证被刷新（不再「no changes」）"	"`nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回： - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的 调用点在第 5 行，但写回的文件里它在第 8 行； - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；"	没测该层	keep	keep	—
"update 运行的展示面含已冻结的指令 case（不退回剥离坐标系的 entry@）"	"④ 旧行为：剥离后看不到指令 case ⇒ 只剩 entry@ 行（行号还偏移）。 钉「entry@ 见证行」（entry@L<n>），不是 token 任意出现——提示文本里 可以引用 `call@/entry@` 这类字面。 `nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回： - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的 调用点在第 5 行，但写回的文件里它在第 8 行； - ② 过期见证与新调用点撞名 ⇒ 判「"	没测该层	keep	keep	—
"普通 test 对同一次调用只记一条（指令见证与合成调用点不并存）"	"`nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回： - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的 调用点在第 5 行，但写回的文件里它在第 8 行； - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；"	没测该层	keep	keep	—
"update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）"	"旧行为：diff 里删掉 `call@site.js:L2` （CLI 面）：`nudo test --freeze=update` **静默删除**一条**仍然活着**的 见证（`call@site.js:L2`），删除汇总还谎报「0 directive(s)」，事后 health 转绿 （假绿）； 契约： - update 后**仍活着**的调用点见证一条都不少（剥离 → 重算 → 回写往返闭合）；"	没测该层	keep	keep	—
"health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少"	"health 可能仍报 drift（drift 口径是既有实现，本条只修「照做即丢证据」） 旧行为：这一步删掉 call@site.js:L2（不可恢复）⇒ 事后 health 转绿（假绿） （CLI 面）：`nudo test --freeze=update` **静默删除**一条**仍然活着**的 见证（`call@site.js:L2`），删除汇总还谎报「0 directive(s)」，事后 health 转绿 （假绿）； 契约： - update 后**仍活着**的调用点见证一条都不少（剥离 → 重算 →"	没测该层	keep	keep	—
"真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）"	"该块**没有**手写 case ⇒ update 照常重同步：陈旧见证（行号已漂）被改写 @nudo:case \"call@L1\" (1, 2) / 旧行为：只数新写出的条数 ⇒ 净删除被印成「0 directive(s)」/完全不出现在汇总里 （CLI 面）：`nudo test --freeze=update` **静默删除**一条**仍然活着**的 见证（`call@site.js:L2`），删除汇总还谎报「0 directive(s)」，事后 health 转绿 （假绿）； 契约： - update 后**"	没测该层	keep	keep	—
"重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline"	"旧行为：两个 \"nudo\" 成员并存，JSON.parse 取后者（null）⇒ 写入无效 陈述 == 事实：加载器读到的配置就是写入的基线 `nudo init` 的最小改动写盘只替换**第一个**同名 `\"nudo\"` 成员，而 加载器按 `JSON.parse`（**后者胜**）读 ⇒ init 报「已写入 adoption baseline」 并引导跑 adoption 档，但**生效的配置仍是旧的非法值**（陈述与事实相反）； 修复：改**生效成员（最后一个）**并把其余重复成员删掉 ⇒ 落盘只剩一个 `"	夹具漏形态	keep	keep	—
"单个非法值（对照）：同样落盘为基线且加载器可见"	"`nudo init` 的最小改动写盘只替换**第一个**同名 `\"nudo\"` 成员，而 加载器按 `JSON.parse`（**后者胜**）读 ⇒ init 报「已写入 adoption baseline」 并引导跑 adoption 档，但**生效的配置仍是旧的非法值**（陈述与事实相反）； 修复：改**生效成员（最后一个）**并把其余重复成员删掉 ⇒ 落盘只剩一个 `nudo` 成员，且「init 声称写入 ⇒ 加载器读到的配置 == adoption baseline」。"	夹具漏形态	keep	keep	—
"帮助文本承诺 update | add，且两个模式都能被实现接受"	"帮助承诺的每个模式 ⇒ 实现都必须接受（旧行为：--freeze=add 被拒） `nudo test --help` 宣称 `--freeze` 的模式是 `update | add`， 但 `--freeze=add` 是**用法错误** exit 1 ⇒ **帮助面承诺 vs 实现矛盾** （用户照 `--help` 写就命令失败）。 修复：解析器**接受** `--freeze=add`（帮助文本已经承诺了它 ⇒ 改实现的 成本更低、对用户更友好），并把错误文案里的合法取值集合同步成与帮助 一致。"	没测该层	keep	keep	—
"非法取值仍被拒（且错误文案列出的合法取值与帮助一致）"	"错误文案里的合法取值集合必须覆盖帮助承诺的每个模式 `nudo test --help` 宣称 `--freeze` 的模式是 `update | add`， 但 `--freeze=add` 是**用法错误** exit 1 ⇒ **帮助面承诺 vs 实现矛盾** （用户照 `--help` 写就命令失败）。 修复：解析器**接受** `--freeze=add`（帮助文本已经承诺了它 ⇒ 改实现的 成本更低、对用户更友好），并把错误文案里的合法取值集合同步成与帮助 一致。"	没测该层	keep	keep	—
"--freeze=add --dry-run：exit 0（旧行为：exit 1 + Invalid --freeze value）"	"修复（与 同根因、同片一次修完）：解析器接受 `--freeze=add` ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。"	没测该层	keep	keep	—
"--freeze=add 与省略取值（默认 add）产出逐字一致"	"修复（与 同根因、同片一次修完）：解析器接受 `--freeze=add` ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。"	没测该层	keep	keep	—
"--freeze=update 仍是 update 模式（不回归）"	"修复（与 同根因、同片一次修完）：解析器接受 `--freeze=add` ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。"	没测该层	keep	keep	—
"非法取值仍被拒 + exit 1"	"修复（与 同根因、同片一次修完）：解析器接受 `--freeze=add` ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。"	没测该层	keep	keep	—
"nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线"	"`nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按 「无配置」处理并**不继承**祖先）。"	夹具漏形态	keep	keep	—
"nudo 值为标量（形状非法）⇒ init 写入基线"	"`nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按 「无配置」处理并**不继承**祖先）。"	夹具漏形态	keep	keep	—
"nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）"	"`nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按 「无配置」处理并**不继承**祖先）。"	夹具漏形态	keep	keep	—
"nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写"	"`nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按 「无配置」处理并**不继承**祖先）。"	夹具漏形态	keep	keep	—
"祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变"	"monorepo：根有 strict nudo 配置，子包没有 nudo 键"	没测该层	keep	keep	—
"拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1"	"monorepo：根有 strict nudo 配置，子包没有 nudo 键"	没测该层	keep	keep	—
"没有祖先配置时 init 照常写基线（不得过度拦截）"	"monorepo：根有 strict nudo 配置，子包没有 nudo 键"	没测该层	keep	keep	—
"未声明 workspace 的 monorepo（packages/* 形态）⇒ 不假拒绝（Bug 35 新口径）"	"目标目录没有自己的 package.json"	没测该层	keep	keep	—
"pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘"	"目标目录没有自己的 package.json"	没测该层	keep	keep	—
"package.json#workspaces ⇒ 同样拒绝写盘"	"目标目录没有自己的 package.json"	没测该层	keep	keep	—
"单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）"	"目标目录没有自己的 package.json"	没测该层	keep	keep	—
"package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1"	"`nudo init` 的 IO 失败路径：**读失败被误报成「不是合法 JSON」**； **写失败抛未捕获异常**（裸 errno、无 `error:` / `fix:` 引导）。"	没测该层	keep	keep	—
"package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）"	"文件内容未被改动 `nudo init` 的 IO 失败路径：**读失败被误报成「不是合法 JSON」**； **写失败抛未捕获异常**（裸 errno、无 `error:` / `fix:` 引导）。"	没测该层	keep	keep	—
"真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）"	"`nudo init` 的 IO 失败路径：**读失败被误报成「不是合法 JSON」**； **写失败抛未捕获异常**（裸 errno、无 `error:` / `fix:` 引导）。"	没测该层	keep	keep	—
"4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员"	"非目标键的字节逐字不变（把新插入的成员切掉 ⇒ 与原文件相同） 改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 + 补尾换行）。"	夹具漏形态	keep	keep	—
"整数样键的相对顺序不变（JSON.parse 会把它们重排）"	"原文件的键序字节不变 改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 + 补尾换行）。"	夹具漏形态	keep	keep	—
"紧凑单行文件 ⇒ 保持紧凑（不引入换行）"	"改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 + 补尾换行）。"	夹具漏形态	keep	keep	—
"已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动"	"改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 + 补尾换行）。"	夹具漏形态	keep	keep	—
"单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）"	"一个未约束 entry ⇒ 1 条 L2 entry-may-throw"	没测该层	keep	keep	—
"CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]"	"三处一致 路径错误不是分析诊断：单独落在 pathErrors[]，信封 ok:false（⇒ exit 1） 一个未约束 entry ⇒ 1 条 L2 entry-may-throw"	没测该层	keep	keep	—
"CLI：无路径错误时信封计数 = 人类面计数（未回归）"	"一个未约束 entry ⇒ 1 条 L2 entry-may-throw"	没测该层	keep	keep	—
"CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）"	"语法错不是分析诊断（没有对应 report）⇒ 不进 summary.errors 一个未约束 entry ⇒ 1 条 L2 entry-may-throw"	没测该层	keep	keep	—
"语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名"	"`nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节 （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果 一并丢失； 且 stderr 不含文件名。"	没测该层	keep	keep	—
"一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢"	"`nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节 （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果 一并丢失； 且 stderr 不含文件名。"	没测该层	keep	keep	—
"全成功 ⇒ stdout 仍是顶��数组（形状不变）"	"`nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节 （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果 一并丢失； 且 stderr 不含文件名。"	没测该层	keep	keep	—
"非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout"	"`nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节 （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果 一并丢失； 且 stderr 不含文件名。"	没测该层	keep	keep	—
"人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape"	"不裸崩 报告面：文件名 + 诊断码（与 468/936 的 config-shape 同口径） `package.json#nudo.env` 的值**不是数组**时的处理。 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health / contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。"	夹具漏形态	keep	keep	—
"机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）"	"`package.json#nudo.env` 的值**不是数组**时的处理。 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health / contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。"	夹具漏形态	keep	keep	—
"其它形状（布尔 / 对象）同样不裸崩 + 报告面可见"	"`package.json#nudo.env` 的值**不是数组**时的处理。 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health / contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。"	夹具漏形态	keep	keep	—
"合法 env 数组：无 config-shape 告警（未回归）"	"`package.json#nudo.env` 的值**不是数组**时的处理。 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health / contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。"	夹具漏形态	keep	keep	—
"check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）"	"误导诊断（真 unknown）必须消失 `nudo check` 的 env 模块装配用**对象展开**代替 `mergeHarvestUnderEnv` ⇒ 手写 env 与 harvest **同名模块**时，harvest 的 **非冲突导出被整体丢弃** ⇒ check 面报 `unknown` + 误导诊断 （`nudo:unknown-inference`），而 test 面报**精确值** ⇒ 两个产品面互相矛盾。 oracle（改前 → 改后）： 改前 `nudo check lib.js` ⇒ `"	夹具漏形态	keep	keep	—
"check 面与 test 面结论一致（同一文件、同一个精确签名）"	"check 面签名表：harvested(a: any) => string（改前是 => unknown） test 面 case 表：(any) => string `nudo check` 的 env 模块装配用**对象展开**代替 `mergeHarvestUnderEnv` ⇒ 手写 env 与 harvest **同名模块**时，harvest 的 **非冲突导出被整体丢弃** ⇒ check 面报 `unknown` + 误导诊断 （`nudo:unknown-inference`），而 test 面"	夹具漏形态	keep	keep	—
"人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）"	"告警级 ⇒ 门禁不红（exit 0） 夹具：手写 `@nudo:env node` + 一个自带 @types 形态 d.ts 的 node_modules 包 ⇒ harvest 与手写 env 在 `format` 槽位上冲突 ⇒ 分析器产出 `nudo:env-harvest-conflict`（warning）。"	夹具漏形态	keep	keep	—
"--json 面同码同 severity（warning）"	"夹具：手写 `@nudo:env node` + 一个自带 @types 形态 d.ts 的 node_modules 包 ⇒ harvest 与手写 env 在 `format` 槽位上冲突 ⇒ 分析器产出 `nudo:env-harvest-conflict`（warning）。"	夹具漏形态	keep	keep	—
"加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）"	"`nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）"	"`nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）"	"`nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）"	"`nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"显式 init <容器根>：写盘 + 作用域告警（不越界）"	"作用域必须说清（nudo 键对下层所有包生效） `nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"从容器根的子目录 init：拒绝越界写盘（exit 1）"	"从容器根的**子目录**发起 ⇒ 最近 package.json 是容器根 ⇒ 越界 ⇒ 拒绝 `nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致， 且不得死锁。 - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按 「无配置」处理，并**不继承**祖先配置（fail-closed）。"	夹具漏形态	keep	keep	—
"mock 表达式解析失败 ⇒ warning（不红门禁）"	"warning 不挡门禁：exit 0、ok:true mock 文件缺失 ⇒ 依赖不可用 ⇒ error"	没测该层	keep	keep	—
"mock 文件缺失仍是 error（不引入假绿）"	"mock 文件缺失 ⇒ 依赖不可用 ⇒ error"	没测该层	keep	keep	—
"负控制：文件面只出现一条 mock-invalid（无重复报告）"	"mock 文件缺失 ⇒ 依赖不可用 ⇒ error"	没测该层	keep	keep	—
"check --json：config-shape warning 进 issues 段"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"check 人类面：issues 段看得见 config-shape"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"health 人类面：config 提示行可见"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"health --json：configShape 字段可见"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"936：假值 nudo 键（false）同样可见（且措辞说 falsy）"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"缓存命中轮：config-shape 仍恰 1 条（不重复）"	"落盘的缓存条目**不得**含 config-shape（live 事实不持久化）—— 否则命中轮 live merge 会与缓存条目重复。 468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"键被改好后：陈旧的 config-shape 告警不得留在缓存里"	"468：`nudo` 键的值不是对象"	夹具漏形态	keep	keep	—
"字符串 env：不裸崩 + 人类面产出 config-shape 形状告警"	"不裸崩（旧实现：projectEnvNames is not iterable ⇒ 五个 verb 全崩） 形状告警上屏（诊断码 config-shape，与 468/936 同口径） 配置面提示（stderr 一行） 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference`"	夹具漏形态	keep	keep	—
"字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved"	"展成字符的痕迹：一个都不许有 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference`"	没测该层	keep	keep	—
"env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条"	"被钉住的行为：字符串 env **不**产生任何逐字符 env 名 对照：若真被展成字符（[\"n\",\"o\",\"d\",\"e\"]），env 装载面会逐个报 unknown env name ⇒ 上面的断言是**活的**判别（不是恒真的空转） 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference`"	夹具漏形态	keep	keep	—
"env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:[\"node\"] ⇒ Buffer 可用"	"env 侧不生效 ⇒ Buffer 全局不可得 ⇒ 返回值塌成 unknown 且这是**已知原因**（形状告警在场），不是无声的推断失败 对照：合法 env 数组 ⇒ env 生效（Buffer 可得），且无形状告警 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference`"	夹具漏形态	keep	keep	—
"env 无关型代码：被忽略的 env 不制造假的 nudo:unknown-inference"	"推断本身成功 ⇒ 不得有 unknown-inference 但「env 列表被忽略」这件事仍然可见 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference`"	没测该层	keep	keep	—
"子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0"	"不得报 check 面从未请求过的路径（分析器通道按文件目录解析的旧记录） `package.json#nudo.env` 的**路径型**条目按**被分析文件所在目录** 解析（不是项目根）⇒ **子目录**里的文件永远拿不到 env ⇒ **假红** （`never` + `nudo:env-unresolved`）+ 误导诊断。 修法（族 18 片 4）：env 名装配**分层**（`assembleEnvs`）—— - **项目级**（package.json#nudo.env）按**项目根**解析（相对说"	没测该层	keep	keep	—
"根目录文件：口径不变（magic() => 42、exit 0）"	"`package.json#nudo.env` 的**路径型**条目按**被分析文件所在目录** 解析（不是项目根）⇒ **子目录**里的文件永远拿不到 env ⇒ **假红** （`never` + `nudo:env-unresolved`）+ 误导诊断。 修法（族 18 片 4）：env 名装配**分层**（`assembleEnvs`）—— - **项目级**（package.json#nudo.env）按**项目根**解析（相对说明符先绝对化： 收集期的查表基准是「最后一次 preload 的目录」，不绝"	没测该层	keep	keep	—
"项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）"	"`package.json#nudo.env` 的**路径型**条目按**被分析文件所在目录** 解析（不是项目根）⇒ **子目录**里的文件永远拿不到 env ⇒ **假红** （`never` + `nudo:env-unresolved`）+ 误导诊断。 修法（族 18 片 4）：env 名装配**分层**（`assembleEnvs`）—— - **项目级**（package.json#nudo.env）按**项目根**解析（相对说明符先绝对化： 收集期的查表基准是「最后一次 preload 的目录」，不绝"	没测该层	keep	keep	—
"CLI：非 --json 面仍是 stderr 文案 + exit 1（旧口径不回归）"	"`nudo check --json` 下的**用法错误** ⇒ stdout 空 + exit 1 （机器面 `JSON.parse(stdout)` 直接炸； 且违反「exit 只由打印出的 ok 决定 / 绝不出现空 stdout + 非零 exit」的机器面契约）。"	没测该层	keep	keep	—
"CLI：非 --json 面的组合拒绝仍是 stderr 文案（--fix + --watch）"	"`nudo check --json` 下的**用法错误** ⇒ stdout 空 + exit 1 （机器面 `JSON.parse(stdout)` 直接炸； 且违反「exit 只由打印出的 ok 决定 / 绝不出现空 stdout + 非零 exit」的机器面契约）。"	没测该层	keep	keep	—
```
