# packages/core/src/algebra/__tests__/algebra-contracts.test.ts

模块套件：41 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"侧车的 name 义务不被丢掉（调用点可见违例）"	"契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(), name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传 `name: 123` 的调用**不被判违约**（违约代码被放过）。"	没测该层	keep	keep	—
"合法合取（两侧同形）⇒ 不得被判 conflict（零假红，Bug 340 口径）"	"契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(), name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传 `name: 123` 的调用**不被判违约**（违约代码被放过）。"	没测该层	keep	keep	—
"合法合取（两侧同形）⇒ 义务照常执法（不因合并而失效）"	"契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(), name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传 `name: 123` 的调用**不被判违约**（违约代码被放过）。"	没测该层	keep	keep	—
"合不了的形态组合 ⇒ 显式诊断（不得静默丢掉那一侧）"	"契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(), name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传 `name: 123` 的调用**不被判违约**（违约代码被放过）。"	没测该层	keep	keep	—
"return number()（builder 调用）⇒ 发 nudo:contract-syntax（不再静默丢弃）"	"`@nudo:contract` 的**返回位**约束名写成 **builder 调用** （`return number()`）⇒ 整条契约被**静默丢弃**、零诊断 ⇒ 声明的后置条件 从未执法（假绿）； 而**参数位**同款写法有 `nudo:contract-syntax` 警告 ⇒ 两处判据不对称。"	没测该层	keep	keep	—
"返回位与参数位同款写法的诊断集一致（两处判据对称）"	"`@nudo:contract` 的**返回位**约束名写成 **builder 调用** （`return number()`）⇒ 整条契约被**静默丢弃**、零诊断 ⇒ 声明的后置条件 从未执法（假绿）； 而**参数位**同款写法有 `nudo:contract-syntax` 警告 ⇒ 两处判据不对称。"	没测该层	keep	keep	—
"合法绑定名写法不被误伤（对照）：return positive 仍然执法"	"`@nudo:contract` 的**返回位**约束名写成 **builder 调用** （`return number()`）⇒ 整条契约被**静默丢弃**、零诊断 ⇒ 声明的后置条件 从未执法（假绿）； 而**参数位**同款写法有 `nudo:contract-syntax` 警告 ⇒ 两处判据不对称。"	没测该层	keep	keep	—
"返回槽取 fn.returns（不是整个 fn 约束）"	"fn 形态被拆成它的 returns（标量），不再是 fn 约束本身 回归：源码 `@nudo:contract return <fn 形态模板>` 的返回义务 **整条不被执法**——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支 把 fn 形态直接判「已证明」⇒ 零诊断假绿。 修法（不改公开返回型，仍是**单条**返回槽）： - `refine.ts` 的 return 段提取：fn 形态模板取其 `fn.returns`（**真正的返回 义务**）——与侧车口径（`sidecar"	夹具漏形态	keep	keep	—
"返回义务真被执法：999 ⊭ number().ge(0).le(1)"	"回归：源码 `@nudo:contract return <fn 形态模板>` 的返回义务 **整条不被执法**——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支 把 fn 形态直接判「已证明」⇒ 零诊断假绿。 修法（不改公开返回型，仍是**单条**返回槽）： - `refine.ts` 的 return 段提取：fn 形态模板取其 `fn.returns`（**真正的返回 义务**）——与侧车口径（`sidecarFn?.fn.returns`）一致；"	夹具漏形态	keep	keep	—
"postcondition：fn 形态不再被直接判「已证明」"	"回归：源码 `@nudo:contract return <fn 形态模板>` 的返回义务 **整条不被执法**——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支 把 fn 形态直接判「已证明」⇒ 零诊断假绿。 修法（不改公开返回型，仍是**单条**返回槽）： - `refine.ts` 的 return 段提取：fn 形态模板取其 `fn.returns`（**真正的返回 义务**）——与侧车口径（`sidecarFn?.fn.returns`）一致；"	夹具漏形态	keep	keep	—
"① 引理未被消费（函数体不用它）⇒ 不得宣称 proved via @nudo:assume"	"回归钉 —— `nudo:assume-relied` 审计标注**误归因**。 症状：审计归因用的是「**函数上有没有**这条引理」这个代理量，而不是 「**证明链上真正消费了**哪条引理」⇒ 只要返回契约证得（proof.status === \"proved\"）且函数带 `@nudo:assume`，就宣称「proved via @nudo:assume X」 ——哪怕函数体压根没用这条引理（`return 0` 也能\"证得\"）。"	没测该层	keep	keep	—
"② 引理真被消费（d/max 的相关性折叠）⇒ 仍要宣称（审计面不得砍空）"	"回归钉 —— `nudo:assume-relied` 审计标注**误归因**。 症状：审计归因用的是「**函数上有没有**这条引理」这个代理量，而不是 「**证明链上真正消费了**哪条引理」⇒ 只要返回契约证得（proof.status === \"proved\"）且函数带 `@nudo:assume`，就宣称「proved via @nudo:assume X」 ——哪怕函数体压根没用这条引理（`return 0` 也能\"证得\"）。"	没测该层	keep	keep	—
"③ 两条引理只消费一条 ⇒ 只宣称消费过的那条"	"回归钉 —— `nudo:assume-relied` 审计标注**误归因**。 症状：审计归因用的是「**函数上有没有**这条引理」这个代理量，而不是 「**证明链上真正消费了**哪条引理」⇒ 只要返回契约证得（proof.status === \"proved\"）且函数带 `@nudo:assume`，就宣称「proved via @nudo:assume X」 ——哪怕函数体压根没用这条引理（`return 0` 也能\"证得\"）。"	没测该层	keep	keep	—
"L1 违例 issue 带函数声明位置（不得是首行 / 不得缺字段）"	"回归钉 —— 返回契约类诊断**不带 `line` / `column`** ⇒ LSP 把诊断画在 **第 1 行第 0 列**、vite 打印 `:1:0`、JSON 里 `line=null`。 根因（族 07 片 S4 实测）：`checkReturnConstraint` 的 `push` 构造 issue 时只带 `fn`，**位置信息在 issue 构造处就丢了** ⇒ 消费面（LSP / vite / GHA / GitLab / JSON）一律兜底到首行。"	夹具漏形态	keep	keep	—
"返回契约**证得**时的公理审计标注也带位置"	"回归钉 —— 返回契约类诊断**不带 `line` / `column`** ⇒ LSP 把诊断画在 **第 1 行第 0 列**、vite 打印 `:1:0`、JSON 里 `line=null`。 根因（族 07 片 S4 实测）：`checkReturnConstraint` 的 `push` 构造 issue 时只带 `fn`，**位置信息在 issue 构造处就丢了** ⇒ 消费面（LSP / vite / GHA / GitLab / JSON）一律兜底到首行。"	夹具漏形态	keep	keep	—
"issue 字段带 line / column（第 10 行）"	"回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号 ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。 与 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；"	夹具漏形态	keep	keep	—
"GHA 行内注解的 line/col 落在真实行（改前是 line=1,col=1）"	"回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号 ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。 与 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；"	夹具漏形态	keep	keep	—
"GitLab Code Quality 的 lines.begin 落在真实行（改前是 1）"	"回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号 ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。 与 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；"	夹具漏形态	keep	keep	—
"JSON 机器契约面的 line / column 不是 null"	"回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号 ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。 与 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；"	夹具漏形态	keep	keep	—
"侧车 fn() 返回槽来源 ⇒ 消息说 sidecar，不得说源码指令"	"侧车：只有 `fn()` 返回槽有约束，源码里没有 `@nudo:contract`"	没测该层	keep	keep	—
"源码 @nudo:contract return 来源 ⇒ 消息仍是 @nudo:contract return <name>（对照组）"	"侧车：只有 `fn()` 返回槽有约束，源码里没有 `@nudo:contract`"	没测该层	keep	keep	—
"只契约 a：形参形状含 b（unknown），不是闭对象"	"对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值； 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参 的 obj shape ⇒ 形参类型写成 `{ a: number }`（源码里的 `{ a, b }` 只剩 a）， 函数体读 `b` 得"	旧断言钉错	keep	keep	—
"只契约 a：读兄弟绑定 b 折 unknown（不是 exact undefined）"	"返回面：{ a, b } ⇒ [number, unknown]（此前是 [number, undefined]） 对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值； 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参 的 obj shape"	旧断言钉错	keep	keep	—
"形参 obj shape 的槽位数 ≥ 该 pattern 的绑定数（兜底自检）"	"对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值； 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参 的 obj shape ⇒ 形参类型写成 `{ a: number }`（源码里的 `{ a, b }` 只剩 a）， 函数体读 `b` 得"	旧断言钉错	keep	keep	—
"对照组：两个字段都有契约 ⇒ 形状不变（{ a: number, b: number }）"	"对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值； 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参 的 obj shape ⇒ 形参类型写成 `{ a: number }`（源码里的 `{ a, b }` 只剩 a）， 函数体读 `b` 得"	旧断言钉错	keep	keep	—
"union(number(), string()) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"union(number(), string()) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"lit(1n) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）"	"族 48（主 agent 追认，2026-10-23）：bigint 字面量契约**补齐了缺失的 `typeof` 类型义务** ⇒ 与 number/string/boolean 兄弟 prim **同款** ⇒ 首条消息由 `x = 1n` 变为 `typeof x = \"bigint\"`。 本用例的**核心主张**（对象实参违反 lit(1n) 契约 ⇒ 必判违例）**不变**， **违例条数不变**（仍是 1 条）—— 变的只是**首条消息的措辞**。 走共享脚手架（nudo-constraints.ts）"	夹具漏形态	keep	keep	—
"lit(1n) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"union(lit(1), lit(2)) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"任务③：一个成员判 false、其余判不了 ⇒ 仍判违例（unknown 语义收紧）"	"`typeof` 成员判 false（object ≠ number）、`lit(null)` 成员判不了 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：union(number(), string()) 收到 number ⇒ 放行"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：union(number(), string()) 收到 string ⇒ 放行"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：union(lit(1), lit(2)) 收到 1 ⇒ 放行"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：union(lit(1), lit(2)) 收到 3 ⇒ 判违例（两个成员都判 false）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：union(number(), lit(null)) 收到 null ⇒ 放行（null 成员为真）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"负控制：没有契约的形参收到对象 ⇒ 零违例（违例来自契约，不是引擎噪声）"	"走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本"	没测该层	keep	keep	—
"没有声明界 ⇒ 不写界（不得替用户发明 x > 0）"	"（core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成 `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成 `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死 `>0` 成了「唯一可用假设」；"	旧断言钉错	keep	keep	—
"声明的界直接落进形参 pred（严格 >）"	"（core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成 `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成 `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死 `>0` 成了「唯一可用假设」；"	旧断言钉错	keep	keep	—
"声明的界直接落进形参 pred（非严格 >=）"	"（core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成 `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成 `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死 `>0` 成了「唯一可用假设」；"	旧断言钉错	keep	keep	—
"未被 assume 的形参仍是 any（不写界）"	"（core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成 `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成 `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死 `>0` 成了「唯一可用假设」；"	旧断言钉错	keep	keep	—
```
