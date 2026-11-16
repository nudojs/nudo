# packages/core/src/algebra/__tests__/algebra-host-modules.test.ts

模块套件：host/module/import/export 面。

审计：105 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
六形态（-1…-6）各报一条 nudo:constraint-violated；负控制：导入函数收到合法实参 ⇒ 零违例（直接 / 别名 / 对象成员）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
"%s 单独出现也报一条（import 前缀自动补）"	表驱动用例：%s 单独出现也报一条（import 前缀自动补）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
负控制：ESM（strict）下 frozen / readonly 写仍确定抛 TypeError；负控制：ESM 下隐式全局赋值仍确定抛 ReferenceError	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
字面量 / 模块级 const / 函数内 const 三条调用点各报一条；函数内 const 单独出现也报（位置不决定判定）；负控制：函数内 const 是合法值 ⇒ 零违例；负控制：求不出值的局部绑定不发明义务	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
fallback reason is module-throw, not internal；check reports nudo:module-throw ReferenceError (no nudo:internal)	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
keeps fn.optionalParams；keeps tuple.holes；renamed sparse tuple is still not assignable to dense tuple	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
宿主 IEEE 见证：2^-53 + 1 被吸收成 1；x > 0 ⊬ x + 1 > 1（反例 x = 2^-53）；x > 0 ⊨ x + 1 >= 1（同命题的 ge 变体：IEEE 恒真，直接比较路径）；x < 0 ⊬ x - 1 < -1（反例 x = -2^-53）；x < 0 ⊨ x - 1 <= -1（le 变体健全）；死臂消除级联：x > 0 时 `x + 1 <= 1` 仍可能真 ⇒ 不得证伪	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
x > 0 ⊨ x + 1 > 0（常量未被抵消，端点保留 1 ULP 余量）；x > 1 ⊨ x + 1 > 1；x > 1 ⊨ x * 3 > 3（乘法严格端点在拐点处仍越过真值）；x ≥ 5 ∧ y ≤ 2 ⊨ x − y ≥ 3	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
lastIndexOf(2, undefined)：起始下标 0 ⇒ 扫不到 ⇒ -1（原生）；对照：lastIndexOf(2)（fromIndex 缺省）⇒ 起始 len-1 ⇒ 1（原生）；对照：lastIndexOf(2, 0) ⇒ 起始 0 ⇒ -1（原生）；对照：indexOf(2, undefined) ⇒ 起始 0（缺省与显式 undefined 同为 0）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
JSON display 与终端一致（无 #conf 段）；detail 走同一稳定化路径（无引擎内部 term 文本 / 计数器 id）；未声明返回类型（any）⇒ display 仍是人类面口径	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
顶层裸语句里的不支持构造 ⇒ f / safe 各 1 条 L2（改前：零 error）；对照：干净孪生模块 ⇒ 只有 f 自己的 TypeError，safe 为 0；顶层 const 初始化表达式（装载期求值）⇒ 每个入口各 1；**未被引用**的类的 static 块 ⇒ 每个入口各 1（类定义期就执行）；**未被引用**的类的静态字段初始化器 ⇒ 每个入口各 1；类定义期的计算键 / extends 表达式 ⇒ 每个入口各 1；负控：不可达 helper / 顶层函数	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
"bare host ctor is not reported as a confident brand"	"`new Storage()` 被引擎判成 brand `Storage`（自信的错值）， 与 `new globalThis.Storage()` 的诚实结论自相矛盾。 修复：宿主全局构造器 走宿主可构造性探针 ⇒ 不再把未建模宿主全局当确定类值。 断言：expect(sigOf(r, \"s1\")).not.toBe(\"Storage\");；expect(sigOf(r, \"s2\")).not.toBe(\"Storage\");"	旧断言钉错	keep	keep	—
Proxy：无 prototype 但可构造 ⇒ true（旧 prototype 启发式给 false）；Symbol / BigInt：有 prototype 但 [[Construct]] 恒抛 ⇒ false；其余方向保持：箭头/内建方法不可构造，普通函数/类可构造	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
construct(Proxy, [target, handler]) 不抛（此前假红 never）；Proxy 作 newTarget 不抛（此前假红 never）；construct(Symbol, []) 定抛 TypeError（此前假绿 unknown）；new 面与 Reflect.construct 面对 Symbol 结论一致（同为定抛）；new Proxy / new Symbol 既有结论不变（Proxy 可构造、Symbol 定抛）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
"FLAG" in globalThis ⇒ 模块正常求值（改前：裸 TypeError / internal 回落）；delete globalThis.x ⇒ 模块正常求值，$del / $delRes 双通道都不崩；负控：普通对象的 in / delete 口径不变（精确判定不被守卫吃掉）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
导出别名（无契约）⇒ 不进 contract 档（旧口径给 implicit ⇒ derived）；变量导出（无契约）⇒ 不进 contract 档；真正的函数位（无契约）⇒ implicit 档（既有行为不变）；有契约的函数位 ⇒ handwritten（与 CodeLens 同源）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
globals { default } ⇒ 模块仍可求值（改前：new Function SyntaxError / 整模块失败）；globals { static, implements, package } ⇒ 模块仍可求值；非标识符名（`a-b` / 空串）⇒ 跳过注入，模块仍可求值；负控：**合法** env 名照旧注入并生效（守卫不得把 env 面整体关掉）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
报 nudo:contract-name-clash 并点名冲突的本地名与两个来源；拒绝绑定冲突的本地名（不静默取后者）→ 契约段拿不到约束；不冲突的 import 仍正常绑定	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
GHA 注解：兄弟目录 app2 不得被裁成 2/src/x.js；GHA 注解：真子路径仍按工作区相对路径裁（app/src/x.js → src/x.js）；GitLab Code Quality：location.path 不得被裁成 2/src/x.js；GitLab Code Quality：真子路径仍按工作区相对路径裁；无工作区根 ⇒ 原样保留完整路径	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
三个函数的 detail 各自带自己的名字；detail 的首行与 name 一致（JSON 信封字段间不矛盾）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
`o + o`：valueOf 被调两次（native：每个操作数各一次）；`o + ""`：toString 被调一次（native：1）；`o + 1`：[Symbol.toPrimitive] 被调一次（native：1）；模板串面：`${o}` 走同一条 ToPrimitive 闸门（native：1）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
`o + 1` 的 valueOf 抛错 ⇒ 用户 try/catch 捕到（native："threw"）；`o + ""` 的 toString 抛错 ⇒ 用户 try/catch 捕到（native："threw"）；入口 throws 面记下钩子体的错误类型（钩子体必然抛错 ⇒ 入口不再折 never）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
toJSON 钩子被调一次（native：1）；toJSON 钩子抛错 ⇒ 用户 try/catch 捕到（native："threw"）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
"toString 钩子抛错 ⇒ 构造面抛（native：throw Error: boom）"	"用户转换钩子（`valueOf` / `toString` / `@@toPrimitive` / `toJSON`） 从不被调用：确定 `no-throw` 假阴性 + 状态确折错值。 修前（HEAD）：隐式强转路径对 user obj 的钩子槽**只做存在性判定**（探到槽就 不折默认标签）⇒ 钩子体**从不执行** ⇒ - 钩子副作用（计数器 / 捕获变量写）全丢：`valueOfCounter() => 0` - 钩子体**确定抛错**的代码被折成**确定不抛**：`hookThrowerCall() => \"no-throw\"` （native \"threw\"）——L2 `entry-may-throw` 对必然抛错的入口"	旧断言钉错	keep	keep	—
无钩子的对象不产生任何钩子副作用；直接调用 o.valueOf() 仍调一次（对照组）；`{a:1} + ''` 仍折 "[object Object]"（无钩子 → 缺省 toString）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
block comment form yields no import record (was effective)；JSDoc block form yields no import record (was effective)；line comment forms still work (control)；a block comment does not shadow the line comment beside it；block comment form is not	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
按名查找命中的是导出的 f（不是内层遮蔽的 f）；内层遮蔽函数自己的 throws 仍在（只是不再顶替导出函数）；导出 f 的 throws 声明为空（内层的不再顶替）；L2 门禁：导出 f 的 throw 重新被报出来（不再假绿）；对照：无遮蔽时行为不变（仍报 may-throw）；对照：导出 f 自己声明 @nudo:throws * 时不报（抑制仍生效）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
export const：登记区间 = export 语句 ⇒ 内层声明被覆盖；export let / export var：登记区间 = export 语句 ⇒ 内层声明被覆盖；负控制：非 export 形态仍按精确区间命中（行为不退化）；负控制：同尾但**非** export 前缀的区间不得误命中（fail-closed）	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
resolveExportSource：星号再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js；resolveExportSource：命名再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js；端到端：跨再导出链的调用点报 nudo:constraint-violated	algebra-host-modules 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
六形态（-1…-6）各报一条 nudo:constraint-violated	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：导入函数收到合法实参 ⇒ 零违例（直接 / 别名 / 对象成员）	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：ESM（strict）下 frozen / readonly 写仍确定抛 TypeError	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：ESM 下隐式全局赋值仍确定抛 ReferenceError	dup:algebra-host-modules 聚合矩阵	commit:13806366
字面量 / 模块级 const / 函数内 const 三条调用点各报一条	dup:algebra-host-modules 聚合矩阵	commit:13806366
函数内 const 单独出现也报（位置不决定判定）	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：函数内 const 是合法值 ⇒ 零违例	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：求不出值的局部绑定不发明义务	dup:algebra-host-modules 聚合矩阵	commit:13806366
fallback reason is module-throw, not internal	dup:algebra-host-modules 聚合矩阵	commit:13806366
check reports nudo:module-throw ReferenceError (no nudo:internal)	dup:algebra-host-modules 聚合矩阵	commit:13806366
keeps fn.optionalParams	dup:algebra-host-modules 聚合矩阵	commit:13806366
keeps tuple.holes	dup:algebra-host-modules 聚合矩阵	commit:13806366
renamed sparse tuple is still not assignable to dense tuple	dup:algebra-host-modules 聚合矩阵	commit:13806366
宿主 IEEE 见证：2^-53 + 1 被吸收成 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
x > 0 ⊬ x + 1 > 1（反例 x = 2^-53）	dup:algebra-host-modules 聚合矩阵	commit:13806366
x > 0 ⊨ x + 1 >= 1（同命题的 ge 变体：IEEE 恒真，直接比较路径）	dup:algebra-host-modules 聚合矩阵	commit:13806366
x < 0 ⊬ x - 1 < -1（反例 x = -2^-53）	dup:algebra-host-modules 聚合矩阵	commit:13806366
x < 0 ⊨ x - 1 <= -1（le 变体健全）	dup:algebra-host-modules 聚合矩阵	commit:13806366
死臂消除级联：x > 0 时 `x + 1 <= 1` 仍可能真 ⇒ 不得证伪	dup:algebra-host-modules 聚合矩阵	commit:13806366
x > 0 ⊨ x + 1 > 0（常量未被抵消，端点保留 1 ULP 余量）	dup:algebra-host-modules 聚合矩阵	commit:13806366
x > 1 ⊨ x + 1 > 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
x > 1 ⊨ x * 3 > 3（乘法严格端点在拐点处仍越过真值）	dup:algebra-host-modules 聚合矩阵	commit:13806366
x ≥ 5 ∧ y ≤ 2 ⊨ x − y ≥ 3	dup:algebra-host-modules 聚合矩阵	commit:13806366
lastIndexOf(2, undefined)：起始下标 0 ⇒ 扫不到 ⇒ -1（原生）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：lastIndexOf(2)（fromIndex 缺省）⇒ 起始 len-1 ⇒ 1（原生）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：lastIndexOf(2, 0) ⇒ 起始 0 ⇒ -1（原生）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：indexOf(2, undefined) ⇒ 起始 0（缺省与显式 undefined 同为 0）	dup:algebra-host-modules 聚合矩阵	commit:13806366
JSON display 与终端一致（无 #conf 段）	dup:algebra-host-modules 聚合矩阵	commit:13806366
detail 走同一稳定化路径（无引擎内部 term 文本 / 计数器 id）	dup:algebra-host-modules 聚合矩阵	commit:13806366
未声明返回类型（any）⇒ display 仍是人类面口径	dup:algebra-host-modules 聚合矩阵	commit:13806366
顶层裸语句里的不支持构造 ⇒ f / safe 各 1 条 L2（改前：零 error）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：干净孪生模块 ⇒ 只有 f 自己的 TypeError，safe 为 0	dup:algebra-host-modules 聚合矩阵	commit:13806366
顶层 const 初始化表达式（装载期求值）⇒ 每个入口各 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
**未被引用**的类的 static 块 ⇒ 每个入口各 1（类定义期就执行）	dup:algebra-host-modules 聚合矩阵	commit:13806366
**未被引用**的类的静态字段初始化器 ⇒ 每个入口各 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
类定义期的计算键 / extends 表达式 ⇒ 每个入口各 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控：不可达 helper / 顶层函数声明的**函数体**（调用时才跑）⇒ 每个入口 0	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控：实例字段初始化器 / 构造器 / 方法体、static 字段里的箭头体 ⇒ 每个入口 0	dup:algebra-host-modules 聚合矩阵	commit:13806366
Bug 895 回归：TS-only 声明语句（enum / namespace / 抽象类）⇒ 每个入口 0，ok 与干净同构一致	dup:algebra-host-modules 聚合矩阵	commit:13806366
`import x = require()`（另一 TS-only 声明语句）同样不归因	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：namespace 之前的**非 TS** 顶层不支持构造仍每个入口 1	dup:algebra-host-modules 聚合矩阵	commit:13806366
@nudo:throws Error 只放行申报的入口（safe 仍 1 条；证据上屏）	dup:algebra-host-modules 聚合矩阵	commit:13806366
--ignore-throws Error 放行全部入口（证据仍上屏）	dup:algebra-host-modules 聚合矩阵	commit:13806366
干净模块对照：零 L2 / ok（归因扩面不假红）	dup:algebra-host-modules 聚合矩阵	commit:13806366
Proxy：无 prototype 但可构造 ⇒ true（旧 prototype 启发式给 false）	dup:algebra-host-modules 聚合矩阵	commit:13806366
Symbol / BigInt：有 prototype 但 [[Construct]] 恒抛 ⇒ false	dup:algebra-host-modules 聚合矩阵	commit:13806366
其余方向保持：箭头/内建方法不可构造，普通函数/类可构造	dup:algebra-host-modules 聚合矩阵	commit:13806366
construct(Proxy, [target, handler]) 不抛（此前假红 never）	dup:algebra-host-modules 聚合矩阵	commit:13806366
Proxy 作 newTarget 不抛（此前假红 never）	dup:algebra-host-modules 聚合矩阵	commit:13806366
construct(Symbol, []) 定抛 TypeError（此前假绿 unknown）	dup:algebra-host-modules 聚合矩阵	commit:13806366
new 面与 Reflect.construct 面对 Symbol 结论一致（同为定抛）	dup:algebra-host-modules 聚合矩阵	commit:13806366
new Proxy / new Symbol 既有结论不变（Proxy 可构造、Symbol 定抛）	dup:algebra-host-modules 聚合矩阵	commit:13806366
"FLAG" in globalThis ⇒ 模块正常求值（改前：裸 TypeError / internal 回落）	dup:algebra-host-modules 聚合矩阵	commit:13806366
delete globalThis.x ⇒ 模块正常求值，$del / $delRes 双通道都不崩	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控：普通对象的 in / delete 口径不变（精确判定不被守卫吃掉）	dup:algebra-host-modules 聚合矩阵	commit:13806366
导出别名（无契约）⇒ 不进 contract 档（旧口径给 implicit ⇒ derived）	dup:algebra-host-modules 聚合矩阵	commit:13806366
变量导出（无契约）⇒ 不进 contract 档	dup:algebra-host-modules 聚合矩阵	commit:13806366
真正的函数位（无契约）⇒ implicit 档（既有行为不变）	dup:algebra-host-modules 聚合矩阵	commit:13806366
有契约的函数位 ⇒ handwritten（与 CodeLens 同源）	dup:algebra-host-modules 聚合矩阵	commit:13806366
globals { default } ⇒ 模块仍可求值（改前：new Function SyntaxError / 整模块失败）	dup:algebra-host-modules 聚合矩阵	commit:13806366
globals { static, implements, package } ⇒ 模块仍可求值	dup:algebra-host-modules 聚合矩阵	commit:13806366
非标识符名（`a-b` / 空串）⇒ 跳过注入，模块仍可求值	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控：**合法** env 名照旧注入并生效（守卫不得把 env 面整体关掉）	dup:algebra-host-modules 聚合矩阵	commit:13806366
报 nudo:contract-name-clash 并点名冲突的本地名与两个来源	dup:algebra-host-modules 聚合矩阵	commit:13806366
拒绝绑定冲突的本地名（不静默取后者）→ 契约段拿不到约束	dup:algebra-host-modules 聚合矩阵	commit:13806366
不冲突的 import 仍正常绑定	dup:algebra-host-modules 聚合矩阵	commit:13806366
GHA 注解：兄弟目录 app2 不得被裁成 2/src/x.js	dup:algebra-host-modules 聚合矩阵	commit:13806366
GHA 注解：真子路径仍按工作区相对路径裁（app/src/x.js → src/x.js）	dup:algebra-host-modules 聚合矩阵	commit:13806366
GitLab Code Quality：location.path 不得被裁成 2/src/x.js	dup:algebra-host-modules 聚合矩阵	commit:13806366
GitLab Code Quality：真子路径仍按工作区相对路径裁	dup:algebra-host-modules 聚合矩阵	commit:13806366
无工作区根 ⇒ 原样保留完整路径	dup:algebra-host-modules 聚合矩阵	commit:13806366
三个函数的 detail 各自带自己的名字	dup:algebra-host-modules 聚合矩阵	commit:13806366
detail 的首行与 name 一致（JSON 信封字段间不矛盾）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`o + o`：valueOf 被调两次（native：每个操作数各一次）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`o + ""`：toString 被调一次（native：1）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`o + 1`：[Symbol.toPrimitive] 被调一次（native：1）	dup:algebra-host-modules 聚合矩阵	commit:13806366
模板串面：`${o}` 走同一条 ToPrimitive 闸门（native：1）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`o + 1` 的 valueOf 抛错 ⇒ 用户 try/catch 捕到（native："threw"）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`o + ""` 的 toString 抛错 ⇒ 用户 try/catch 捕到（native："threw"）	dup:algebra-host-modules 聚合矩阵	commit:13806366
入口 throws 面记下钩子体的错误类型（钩子体必然抛错 ⇒ 入口不再折 never）	dup:algebra-host-modules 聚合矩阵	commit:13806366
toJSON 钩子被调一次（native：1）	dup:algebra-host-modules 聚合矩阵	commit:13806366
toJSON 钩子抛错 ⇒ 用户 try/catch 捕到（native："threw"）	dup:algebra-host-modules 聚合矩阵	commit:13806366
无钩子的对象不产生任何钩子副作用	dup:algebra-host-modules 聚合矩阵	commit:13806366
直接调用 o.valueOf() 仍调一次（对照组）	dup:algebra-host-modules 聚合矩阵	commit:13806366
`{a:1} + ''` 仍折 "[object Object]"（无钩子 → 缺省 toString）	dup:algebra-host-modules 聚合矩阵	commit:13806366
block comment form yields no import record (was effective)	dup:algebra-host-modules 聚合矩阵	commit:13806366
JSDoc block form yields no import record (was effective)	dup:algebra-host-modules 聚合矩阵	commit:13806366
line comment forms still work (control)	dup:algebra-host-modules 聚合矩阵	commit:13806366
a block comment does not shadow the line comment beside it	dup:algebra-host-modules 聚合矩阵	commit:13806366
block comment form is not reported as a malformed import either	dup:algebra-host-modules 聚合矩阵	commit:13806366
按名查找命中的是导出的 f（不是内层遮蔽的 f）	dup:algebra-host-modules 聚合矩阵	commit:13806366
内层遮蔽函数自己的 throws 仍在（只是不再顶替导出函数）	dup:algebra-host-modules 聚合矩阵	commit:13806366
导出 f 的 throws 声明为空（内层的不再顶替）	dup:algebra-host-modules 聚合矩阵	commit:13806366
L2 门禁：导出 f 的 throw 重新被报出来（不再假绿）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：无遮蔽时行为不变（仍报 may-throw）	dup:algebra-host-modules 聚合矩阵	commit:13806366
对照：导出 f 自己声明 @nudo:throws * 时不报（抑制仍生效）	dup:algebra-host-modules 聚合矩阵	commit:13806366
export const：登记区间 = export 语句 ⇒ 内层声明被覆盖	dup:algebra-host-modules 聚合矩阵	commit:13806366
export let / export var：登记区间 = export 语句 ⇒ 内层声明被覆盖	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：非 export 形态仍按精确区间命中（行为不退化）	dup:algebra-host-modules 聚合矩阵	commit:13806366
负控制：同尾但**非** export 前缀的区间不得误命中（fail-closed）	dup:algebra-host-modules 聚合矩阵	commit:13806366
resolveExportSource：星号再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js	dup:algebra-host-modules 聚合矩阵	commit:13806366
resolveExportSource：命名再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js	dup:algebra-host-modules 聚合矩阵	commit:13806366
端到端：跨再导出链的调用点报 nudo:constraint-violated	dup:algebra-host-modules 聚合矩阵	commit:13806366
```
