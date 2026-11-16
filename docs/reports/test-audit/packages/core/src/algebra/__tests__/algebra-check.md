# packages/core/src/algebra/__tests__/algebra-check.test.ts

模块套件：check 门禁/诊断/证据面。

审计：115 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
调用点在函数体内 → 报 drift（旧口径零告警）；对照组：调用点在模块顶层 → 同样报 drift；快照与函数体内调用域一致 → 无 drift（没有把窗口扩大变成误报）	algebra-check 聚合矩阵	没测该层	keep	keep	—
平铺 union(lit(1),lit(2),lit(3)) → 零 drift；嵌套 union(union(lit(1),lit(2)), lit(3))（同一域）→ 零 drift；域真的不同 → 仍报 drift（规范化不是哑判）	algebra-check 聚合矩阵	没测该层	keep	keep	—
散文行里的 `!! throws` 不再被读成函数级申报；case 名内部的 `!! throws` 不再被读成函数级申报；文档化的 case 后缀形态仍然有效（护栏：不得删掉后缀申报）；extractDeclaredThrows：误读形态无申报 / 文档化形态有申报；L2 门禁：散文形态不再静默关掉（entry-may-throw 重新执法）；L2 门禁：case 名内部的形态同样执法；护栏：文档化的 case 后缀申报仍然放行该入口（门禁不报）	algebra-check 聚合矩阵	没测该层	keep	keep	—
Φ 约束的是另一个项 ⇒ 判『证不出』（unprovable），不得判『确定违约』（disproved）；Φ 约束的是另一个项 ⇒ 不得产出 error 级 issue（生产入口同口径）；Φ 约束的是返回项本身 ⇒ 义务可证（proved）——Φ 侧真的生效；Φ 约束的是返回项本身 ⇒ 生产入口无 issue（既不 error 也不 warning）；不传 Φ ⇒ 仍是『证不出』（证据面只有 ret.pred）；无关 Φ 不得压掉已由 ret.pred 证出的义务（值域事实优	algebra-check 聚合矩阵	没测该层	keep	keep	—
类导出入口进 L2 入口表（`new C()` 是真实入口）；构造器**无条件抛** ⇒ 证据进类入口的 throws 域（修前：空 ⇒ 假绿）；构造器在 **any 实参**下才抛 ⇒ 不进 throws 域（不假红）；端到端：类入口进入口表后，构造器必抛必须报在类入口上（不零诊断）；构造器软 throw ⇒ 全文件零 error 级 L2（原假红保持消除）；构造器必抛 ⇒ **不**归因给实例方法（Bug 1070 口径不变）；构造器上申报 `@nudo:throws`	algebra-check 聚合矩阵	没测该层	keep	keep	—
构造器抛 + 方法读字段 ⇒ 签名不得是确定的 undefined（修前：undefined）；构造器抛 + 方法在字段上调成员 ⇒ 不得折 never（修前：never + error 级 L2）；构造器抛 + 方法体 total ⇒ 方法签名照常（不退化成整体 opaque）；方法体**自己**会抛 ⇒ 证据照常收集（构造器抛不得把方法体证据一起弄丢）	algebra-check 聚合矩阵	没测该层	keep	keep	—
shape({id:number().gt(0)}) 收到 null ⇒ 只报一条（结构通道）；shape({id:number().gt(0)}) 收到 undefined ⇒ 只报一条（结构通道）；number().gt(0) 收到 boolean ⇒ 只报一条（typeof 通道；数值界让位）；负控制：真的是数值界违例时仍报（且只报一条）；负控制：不同形参位各报各的（让位只压同一实参位）	algebra-check 聚合矩阵	没测该层	keep	keep	—
"lit(1n) 收到 1 ⇒ 报两条（类型义务 + 值义务，族 48 口径）"	"⚠ **未修**的一半（口径冲突，保留既有门禁行为）： `lit(1n)` 收到 `1` ⇒ 同时发「typeof x = \"bigint\"」与「x = 1n」。 这**不是**重复：契约 `lit(1n)` 是「`typeof x = \"bigint\"` ∧ `x = 1n`」**两条 独立义务**； 断言：expect(vs.length).toBe(2);；expect(vs[0]?.expected).toBe('typeof x = \"bigint\"');"	没测该层	keep	keep	—
源码 @nudo:throws TypeError + 侧车 throws RangeError ⇒ 绿（RangeError 已申报）；删掉源码那一行 ⇒ 结论不变（单调 / 幂等）；两侧都没申报 RangeError ⇒ 仍报红（放行不是无条件的）	algebra-check 聚合矩阵	没测该层	keep	keep	—
$call(unknown) → 不记 TypeError 效果（守卫：防止再被当成「不是函数」）；$call(unknown) → 值域保持 unknown；对照：any callee → 记 TypeError（any 是「无约束值」，与 unknown 档必须分开）；283 的报告症状（成员缺失）→ 由成员读侧覆盖：记 TypeError；守卫：导入绑定被调（引擎折成 unknown）→ 不记 TypeError（否则对合法代码假阳性）；守卫：本地函数被调 → 不记 T	algebra-check 聚合矩阵	没测该层	keep	keep	—
string().max(3) 实例化带 typeof 类型义务；数值实参撞字符串长度契约 → 按类型错配报（expected 点名 string）；字符串实参撞同契约 → 仍按长度界判（类型义务不误伤合法实参）	algebra-check 聚合矩阵	没测该层	keep	keep	—
string().min(2) 实例化不含内部占位符；string().length(3) 实例化不含内部占位符；instantiateOnTerm（项级实例化）同样替换占位符；union 成员里的长度界也替换掉占位符（or 分支递归）；产品面：expected 文本不含内部占位符	algebra-check 聚合矩阵	没测该层	keep	keep	—
callee 与 caller 都报 return 违例（caller 不再被「证得」）；caller 的返回面是真实值（5），不是声明面；caller 不得出现「靠 assume 证得」的假证明	algebra-check 聚合矩阵	没测该层	keep	keep	—
调用方的返回契约被判违例（旧行为：零错误 + assume-relied 假证明）；调用方的返回面是真实值（5），不是声明面	algebra-check 聚合矩阵	没测该层	keep	keep	—
opts 非对象 → 抛指名道姓的错误（不再静默丢弃申报）；opts 为 null → 同样报错；throws 声明抽不出错误名（数字 / null）→ 报错点名；合法 throws 申报照旧生效；'*' 通配申报照旧生效；不传第三实参 → 槽位缺省（无申报）	algebra-check 聚合矩阵	没测该层	keep	keep	—
pick 收到字符串 → 报错点名（不再逐字符迭代放松成空契约）；omit 收到字符串 → 报错点名（不再逐字符迭代让约束变更严）；keys 数组里混入非字符串 → 报错点名；keys 收到非数组（非字符串）→ 报错点名；合法数组形态照旧：pick 取子形状、omit 去字段	algebra-check 聚合矩阵	没测该层	keep	keep	—
函数体内的标量改型 ⇒ 报 nudo:assign-mismatch（修前 0 条）；函数体内的对象改型 ⇒ 报 nudo:assign-mismatch；函数体内改写模块级绑定 ⇒ 报 nudo:assign-mismatch；控制组：模块顶层赋值仍然报（修前覆盖面不得回退）；顶层 + 函数体各报一条（不多不少）；同一赋值点被多次求值 ⇒ 只报一条（窗口扩大不得制造同文双计）	algebra-check 聚合矩阵	没测该层	keep	keep	—
判定层：形状兼容 + 旧值带调用点派生 pred ⇒ 不报（修前 1 条）；判定层控制组：形状改型（string → number）⇒ 仍报；产品面：标量改型（let n = 1; n = "str"）⇒ 仍报（金标 assign-prim-mismatch）；产品面：缺槽（let a = {x:1}; a = {y:2}）⇒ 仍报；控制组：函数体内的赋值面仍被覆盖（族 07 Bug 363 的覆盖面不得回退）	algebra-check 聚合矩阵	没测该层	keep	keep	—
少传必填实参 → nudo:arg-count（此前从不产生）；零实参调用被调方（必填位） → nudo:arg-count；默认形参 / rest 形参**不吃**实参位 ⇒ 不误报 arg-count；实参个数正确 ⇒ 无 arg-count（不多传也不算错）；checkArg：期望主题项对齐到实参 term ⇒ 非字面量实参不再恒判 unproven	algebra-check 聚合矩阵	没测该层	keep	keep	—
诊断码本身仍在注册表里（公共 API 的既有语义不得删）；公共 API checkCall：partial 置信度 ⇒ 仍产 nudo:partial-result（info）；产品面：partial 置信度的被调方 ⇒ 不产 nudo:partial-result（修前 1 条 info）；产品面：opaque 置信度的被调方 ⇒ 不产 nudo:partial-result；控制组：Bug 364 的调用点接线仍在（nudo:arg-count 照产）	algebra-check 聚合矩阵	没测该层	keep	keep	—
跨文件证据 ⇒ 报 nudo:contract-drift（修前 0 条）；控制组：没有跨文件证据 ⇒ 不报（无证据不判 drift）；跨文件证据只报 1 条（参数位 lit(5) 未漂移 ⇒ 不报参数漂移）；跨文件调用点在本文件内无位置 ⇒ 位置留空（不挂别的文件的行号）；跨文件证据不得凭空造出别的函数的漂移	algebra-check 聚合矩阵	没测该层	keep	keep	—
声明域参数 ⇒ 值域已知 ⇒ 判「确定违约」（error）；派生项 ⇒ 判「证不出」（warning）；派生项（值域未跟踪）在带界义务下不得出现 nudo:constraint-violated；**有界证据**时「不蕴含」仍是确定违约（error）——判据不得过宽；字面量返回仍按域隶属判违约（error）	algebra-check 聚合矩阵	没测该层	keep	keep	—
nudo:assume-invalid ⇒ 行 2 / 列 3；nudo:invariant-invalid ⇒ 行 2 / 列 3；nudo:contract-syntax ⇒ 行 2 / 列 3；nudo:contract-conflict ⇒ 行 3 / 列 3（出错指令所在行）；nudo:contract-conflict（返回位，同码第二个 push 点）⇒ 行 3 / 列 3；位置不得回落成文件首行（所有这些码都不得 line === 1）	algebra-check 聚合矩阵	没测该层	keep	keep	—
产品面：函数声明作右侧 ⇒ checkSource 不抛；整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断；判定层：next 是裸宿主函数 ⇒ 不抛、不报（fail-closed）；原生语义未变：f 变成 h 之后 f() 取 h 的默认形参值；控制组：函数表达式作右侧仍报 nudo:assign-mismatch（守卫未吃掉通道信号）	algebra-check 聚合矩阵	没测该层	keep	keep	—
侧车单份契约 gt(10).lt(5) ⇒ 报 nudo:contract-conflict；源码指令单份契约自相矛盾 ⇒ 报 nudo:contract-conflict；区间非空的契约不报 conflict（不误报）	algebra-check 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
调用点在函数体内 → 报 drift（旧口径零告警）	dup:algebra-check 聚合矩阵	commit:54f54850
对照组：调用点在模块顶层 → 同样报 drift	dup:algebra-check 聚合矩阵	commit:54f54850
快照与函数体内调用域一致 → 无 drift（没有把窗口扩大变成误报）	dup:algebra-check 聚合矩阵	commit:54f54850
平铺 union(lit(1),lit(2),lit(3)) → 零 drift	dup:algebra-check 聚合矩阵	commit:54f54850
嵌套 union(union(lit(1),lit(2)), lit(3))（同一域）→ 零 drift	dup:algebra-check 聚合矩阵	commit:54f54850
域真的不同 → 仍报 drift（规范化不是哑判）	dup:algebra-check 聚合矩阵	commit:54f54850
散文行里的 `!! throws` 不再被读成函数级申报	dup:algebra-check 聚合矩阵	commit:54f54850
case 名内部的 `!! throws` 不再被读成函数级申报	dup:algebra-check 聚合矩阵	commit:54f54850
文档化的 case 后缀形态仍然有效（护栏：不得删掉后缀申报）	dup:algebra-check 聚合矩阵	commit:54f54850
extractDeclaredThrows：误读形态无申报 / 文档化形态有申报	dup:algebra-check 聚合矩阵	commit:54f54850
L2 门禁：散文形态不再静默关掉（entry-may-throw 重新执法）	dup:algebra-check 聚合矩阵	commit:54f54850
L2 门禁：case 名内部的形态同样执法	dup:algebra-check 聚合矩阵	commit:54f54850
护栏：文档化的 case 后缀申报仍然放行该入口（门禁不报）	dup:algebra-check 聚合矩阵	commit:54f54850
Φ 约束的是另一个项 ⇒ 判『证不出』（unprovable），不得判『确定违约』（disproved）	dup:algebra-check 聚合矩阵	commit:54f54850
Φ 约束的是另一个项 ⇒ 不得产出 error 级 issue（生产入口同口径）	dup:algebra-check 聚合矩阵	commit:54f54850
Φ 约束的是返回项本身 ⇒ 义务可证（proved）——Φ 侧真的生效	dup:algebra-check 聚合矩阵	commit:54f54850
Φ 约束的是返回项本身 ⇒ 生产入口无 issue（既不 error 也不 warning）	dup:algebra-check 聚合矩阵	commit:54f54850
不传 Φ ⇒ 仍是『证不出』（证据面只有 ret.pred）	dup:algebra-check 聚合矩阵	commit:54f54850
无关 Φ 不得压掉已由 ret.pred 证出的义务（值域事实优先）	dup:algebra-check 聚合矩阵	commit:54f54850
同项 Φ 与 ret.pred 同口径：界弱于契约 ⇒ 判确定违约（fail-closed 既有约定）	dup:algebra-check 聚合矩阵	commit:54f54850
Bug 1094：Φ 侧的同项界**弱于**契约 ⇒ 判『证不出』，不得判『确定违约』	dup:algebra-check 聚合矩阵	commit:54f54850
类导出入口进 L2 入口表（`new C()` 是真实入口）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器**无条件抛** ⇒ 证据进类入口的 throws 域（修前：空 ⇒ 假绿）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器在 **any 实参**下才抛 ⇒ 不进 throws 域（不假红）	dup:algebra-check 聚合矩阵	commit:54f54850
端到端：类入口进入口表后，构造器必抛必须报在类入口上（不零诊断）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器软 throw ⇒ 全文件零 error 级 L2（原假红保持消除）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器必抛 ⇒ **不**归因给实例方法（Bug 1070 口径不变）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器上申报 `@nudo:throws` ⇒ 闸门可放行（类入口的申报落点 = 构造器 scope）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器抛 + 方法读字段 ⇒ 签名不得是确定的 undefined（修前：undefined）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器抛 + 方法在字段上调成员 ⇒ 不得折 never（修前：never + error 级 L2）	dup:algebra-check 聚合矩阵	commit:54f54850
构造器抛 + 方法体 total ⇒ 方法签名照常（不退化成整体 opaque）	dup:algebra-check 聚合矩阵	commit:54f54850
方法体**自己**会抛 ⇒ 证据照常收集（构造器抛不得把方法体证据一起弄丢）	dup:algebra-check 聚合矩阵	commit:54f54850
shape({id:number().gt(0)}) 收到 null ⇒ 只报一条（结构通道）	dup:algebra-check 聚合矩阵	commit:54f54850
shape({id:number().gt(0)}) 收到 undefined ⇒ 只报一条（结构通道）	dup:algebra-check 聚合矩阵	commit:54f54850
number().gt(0) 收到 boolean ⇒ 只报一条（typeof 通道；数值界让位）	dup:algebra-check 聚合矩阵	commit:54f54850
负控制：真的是数值界违例时仍报（且只报一条）	dup:algebra-check 聚合矩阵	commit:54f54850
负控制：不同形参位各报各的（让位只压同一实参位）	dup:algebra-check 聚合矩阵	commit:54f54850
源码 @nudo:throws TypeError + 侧车 throws RangeError ⇒ 绿（RangeError 已申报）	dup:algebra-check 聚合矩阵	commit:54f54850
删掉源码那一行 ⇒ 结论不变（单调 / 幂等）	dup:algebra-check 聚合矩阵	commit:54f54850
两侧都没申报 RangeError ⇒ 仍报红（放行不是无条件的）	dup:algebra-check 聚合矩阵	commit:54f54850
$call(unknown) → 不记 TypeError 效果（守卫：防止再被当成「不是函数」）	dup:algebra-check 聚合矩阵	commit:54f54850
$call(unknown) → 值域保持 unknown	dup:algebra-check 聚合矩阵	commit:54f54850
对照：any callee → 记 TypeError（any 是「无约束值」，与 unknown 档必须分开）	dup:algebra-check 聚合矩阵	commit:54f54850
283 的报告症状（成员缺失）→ 由成员读侧覆盖：记 TypeError	dup:algebra-check 聚合矩阵	commit:54f54850
守卫：导入绑定被调（引擎折成 unknown）→ 不记 TypeError（否则对合法代码假阳性）	dup:algebra-check 聚合矩阵	commit:54f54850
守卫：本地函数被调 → 不记 TypeError（普通代码路径不受影响）	dup:algebra-check 聚合矩阵	commit:54f54850
string().max(3) 实例化带 typeof 类型义务	dup:algebra-check 聚合矩阵	commit:54f54850
数值实参撞字符串长度契约 → 按类型错配报（expected 点名 string）	dup:algebra-check 聚合矩阵	commit:54f54850
字符串实参撞同契约 → 仍按长度界判（类型义务不误伤合法实参）	dup:algebra-check 聚合矩阵	commit:54f54850
string().min(2) 实例化不含内部占位符	dup:algebra-check 聚合矩阵	commit:54f54850
string().length(3) 实例化不含内部占位符	dup:algebra-check 聚合矩阵	commit:54f54850
instantiateOnTerm（项级实例化）同样替换占位符	dup:algebra-check 聚合矩阵	commit:54f54850
union 成员里的长度界也替换掉占位符（or 分支递归）	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：expected 文本不含内部占位符	dup:algebra-check 聚合矩阵	commit:54f54850
callee 与 caller 都报 return 违例（caller 不再被「证得」）	dup:algebra-check 聚合矩阵	commit:54f54850
caller 的返回面是真实值（5），不是声明面	dup:algebra-check 聚合矩阵	commit:54f54850
caller 不得出现「靠 assume 证得」的假证明	dup:algebra-check 聚合矩阵	commit:54f54850
调用方的返回契约被判违例（旧行为：零错误 + assume-relied 假证明）	dup:algebra-check 聚合矩阵	commit:54f54850
调用方的返回面是真实值（5），不是声明面	dup:algebra-check 聚合矩阵	commit:54f54850
opts 非对象 → 抛指名道姓的错误（不再静默丢弃申报）	dup:algebra-check 聚合矩阵	commit:54f54850
opts 为 null → 同样报错	dup:algebra-check 聚合矩阵	commit:54f54850
throws 声明抽不出错误名（数字 / null）→ 报错点名	dup:algebra-check 聚合矩阵	commit:54f54850
合法 throws 申报照旧生效	dup:algebra-check 聚合矩阵	commit:54f54850
'*' 通配申报照旧生效	dup:algebra-check 聚合矩阵	commit:54f54850
不传第三实参 → 槽位缺省（无申报）	dup:algebra-check 聚合矩阵	commit:54f54850
pick 收到字符串 → 报错点名（不再逐字符迭代放松成空契约）	dup:algebra-check 聚合矩阵	commit:54f54850
omit 收到字符串 → 报错点名（不再逐字符迭代让约束变更严）	dup:algebra-check 聚合矩阵	commit:54f54850
keys 数组里混入非字符串 → 报错点名	dup:algebra-check 聚合矩阵	commit:54f54850
keys 收到非数组（非字符串）→ 报错点名	dup:algebra-check 聚合矩阵	commit:54f54850
合法数组形态照旧：pick 取子形状、omit 去字段	dup:algebra-check 聚合矩阵	commit:54f54850
函数体内的标量改型 ⇒ 报 nudo:assign-mismatch（修前 0 条）	dup:algebra-check 聚合矩阵	commit:54f54850
函数体内的对象改型 ⇒ 报 nudo:assign-mismatch	dup:algebra-check 聚合矩阵	commit:54f54850
函数体内改写模块级绑定 ⇒ 报 nudo:assign-mismatch	dup:algebra-check 聚合矩阵	commit:54f54850
控制组：模块顶层赋值仍然报（修前覆盖面不得回退）	dup:algebra-check 聚合矩阵	commit:54f54850
顶层 + 函数体各报一条（不多不少）	dup:algebra-check 聚合矩阵	commit:54f54850
同一赋值点被多次求值 ⇒ 只报一条（窗口扩大不得制造同文双计）	dup:algebra-check 聚合矩阵	commit:54f54850
判定层：形状兼容 + 旧值带调用点派生 pred ⇒ 不报（修前 1 条）	dup:algebra-check 聚合矩阵	commit:54f54850
判定层控制组：形状改型（string → number）⇒ 仍报	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：标量改型（let n = 1; n = "str"）⇒ 仍报（金标 assign-prim-mismatch）	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：缺槽（let a = {x:1}; a = {y:2}）⇒ 仍报	dup:algebra-check 聚合矩阵	commit:54f54850
控制组：函数体内的赋值面仍被覆盖（族 07 Bug 363 的覆盖面不得回退）	dup:algebra-check 聚合矩阵	commit:54f54850
少传必填实参 → nudo:arg-count（此前从不产生）	dup:algebra-check 聚合矩阵	commit:54f54850
零实参调用被调方（必填位） → nudo:arg-count	dup:algebra-check 聚合矩阵	commit:54f54850
默认形参 / rest 形参**不吃**实参位 ⇒ 不误报 arg-count	dup:algebra-check 聚合矩阵	commit:54f54850
实参个数正确 ⇒ 无 arg-count（不多传也不算错）	dup:algebra-check 聚合矩阵	commit:54f54850
checkArg：期望主题项对齐到实参 term ⇒ 非字面量实参不再恒判 unproven	dup:algebra-check 聚合矩阵	commit:54f54850
诊断码本身仍在注册表里（公共 API 的既有语义不得删）	dup:algebra-check 聚合矩阵	commit:54f54850
公共 API checkCall：partial 置信度 ⇒ 仍产 nudo:partial-result（info）	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：partial 置信度的被调方 ⇒ 不产 nudo:partial-result（修前 1 条 info）	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：opaque 置信度的被调方 ⇒ 不产 nudo:partial-result	dup:algebra-check 聚合矩阵	commit:54f54850
控制组：Bug 364 的调用点接线仍在（nudo:arg-count 照产）	dup:algebra-check 聚合矩阵	commit:54f54850
跨文件证据 ⇒ 报 nudo:contract-drift（修前 0 条）	dup:algebra-check 聚合矩阵	commit:54f54850
控制组：没有跨文件证据 ⇒ 不报（无证据不判 drift）	dup:algebra-check 聚合矩阵	commit:54f54850
跨文件证据只报 1 条（参数位 lit(5) 未漂移 ⇒ 不报参数漂移）	dup:algebra-check 聚合矩阵	commit:54f54850
跨文件调用点在本文件内无位置 ⇒ 位置留空（不挂别的文件的行号）	dup:algebra-check 聚合矩阵	commit:54f54850
跨文件证据不得凭空造出别的函数的漂移	dup:algebra-check 聚合矩阵	commit:54f54850
声明域参数 ⇒ 值域已知 ⇒ 判「确定违约」（error）；派生项 ⇒ 判「证不出」（warning）	dup:algebra-check 聚合矩阵	commit:54f54850
派生项（值域未跟踪）在带界义务下不得出现 nudo:constraint-violated	dup:algebra-check 聚合矩阵	commit:54f54850
**有界证据**时「不蕴含」仍是确定违约（error）——判据不得过宽	dup:algebra-check 聚合矩阵	commit:54f54850
字面量返回仍按域隶属判违约（error）	dup:algebra-check 聚合矩阵	commit:54f54850
nudo:assume-invalid ⇒ 行 2 / 列 3	dup:algebra-check 聚合矩阵	commit:54f54850
nudo:invariant-invalid ⇒ 行 2 / 列 3	dup:algebra-check 聚合矩阵	commit:54f54850
nudo:contract-syntax ⇒ 行 2 / 列 3	dup:algebra-check 聚合矩阵	commit:54f54850
nudo:contract-conflict ⇒ 行 3 / 列 3（出错指令所在行）	dup:algebra-check 聚合矩阵	commit:54f54850
nudo:contract-conflict（返回位，同码第二个 push 点）⇒ 行 3 / 列 3	dup:algebra-check 聚合矩阵	commit:54f54850
位置不得回落成文件首行（所有这些码都不得 line === 1）	dup:algebra-check 聚合矩阵	commit:54f54850
产品面：函数声明作右侧 ⇒ checkSource 不抛	dup:algebra-check 聚合矩阵	commit:54f54850
整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断	dup:algebra-check 聚合矩阵	commit:54f54850
判定层：next 是裸宿主函数 ⇒ 不抛、不报（fail-closed）	dup:algebra-check 聚合矩阵	commit:54f54850
原生语义未变：f 变成 h 之后 f() 取 h 的默认形参值	dup:algebra-check 聚合矩阵	commit:54f54850
控制组：函数表达式作右侧仍报 nudo:assign-mismatch（守卫未吃掉通道信号）	dup:algebra-check 聚合矩阵	commit:54f54850
侧车单份契约 gt(10).lt(5) ⇒ 报 nudo:contract-conflict	dup:algebra-check 聚合矩阵	commit:54f54850
源码指令单份契约自相矛盾 ⇒ 报 nudo:contract-conflict	dup:algebra-check 聚合矩阵	commit:54f54850
区间非空的契约不报 conflict（不误报）	dup:algebra-check 聚合矩阵	commit:54f54850
```
