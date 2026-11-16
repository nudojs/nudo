# packages/service/src/__tests__/service-core-misc.test.ts

模块套件：service 其余 core/eval 产品语义。

审计：97 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
引擎侧：实例 brand 名不是内部伪名；dts 产物：不得出现内部伪名（改前：TS2304——伪名从未声明）；schema 产物：不得 z.instanceof(内部伪名)（改前：import 即 ReferenceError）；schema 产物可求值（import 即用——改前 ReferenceError）；负控制：产物里的 z.instanceof 实参都是运行时全局构造器	service-core-misc 聚合矩阵	没测该层	keep	keep	—
"构造器形参 = unknown（nudo 展示面仍为 any，两个作用域不同）"	"三个丢信息点（`dtsClassDeclaration`）：① 构造器 / 静态方法形参无类型 证据； **TS 投影面**把无约束 any 映成 TS `unknown`（top）⇒ ① 回到 `unknown`， 但理由不是「推断失败」，而是「TS 侧的 top」。 断言：expect(dts).toContain(\"constructor(w: unknown, h: unknown);\");；expect(dts).not.toContain(\"constructor(w: any\");"	夹具漏形态	keep	keep	—
裸块语句上的指令登记了**节点身份**区间（改前恒空）；裸块语句 与 普通语句 的签名逐字相同（替换真的生效）；裸块语句命中 ⇒ 零「未命中」诊断（不许谎报作用域内没有该表达式）；目标确实只在**嵌套**块里 ⇒ 诊断明说「被嵌套作用域挡住」而不是「没有该表达式」	service-core-misc 聚合矩阵	没测该层	keep	keep	—
两个不同 cwd 各跑一次 ⇒ 标签逐字相同且只有一条；历史 cwd 相对拼写 + 新拼写 ⇒ 归一成一条（不再并集）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
"错误消息含侧车文件名（不是源文件名）"	"断言：expect(emitContract(join(dir, \"lib.js\"), { mode: \"update\", all: true })).rejects.toThrow("	没测该层	keep	keep	—
`{ x = 1, y = x + 1 } = {}` ⇒ 形参可省（不是必填）；对照组：无默认值的解构形参仍必填	service-core-misc 聚合矩阵	没测该层	keep	keep	—
模块级求值失败 ⇒ 观测面看见该文件的 module-throw 回落（装载期逃逸）；假红防线：unsupported:* 回落**不**进失败信号；假红防线：module-throw（程序自身抛）**不**进失败信号；干净文件 ⇒ 零回落（不得凭空造失败）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
"静态方法进函数表，静态字段不进"	"断言：expect(names).toContain(\"K.m\");；expect(names).toContain(\"K.instance\");"	没测该层	keep	keep	—
成员按导出槽名 `default` 登记（不再被整体丢弃）；对照组：具名 default class 仍按本地名登记（口径不变）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
`=> lit(null)` 的精确结果被判定（不是 unchecked）；判据本体的对照组：真 unknown ⇒ 仍是推导失败；inferenceFailed：lit null/undefined ⇒ false；无 term 的 unknown ⇒ true	service-core-misc 聚合矩阵	没测该层	keep	keep	—
判定层：never 配 never ⇒ 满足（Bug 649 不回归：配 number() ⇒ 不满足）；分析面：抛错函数 + `=> never` ⇒ 不再发 nudo:case-expected（报告与判定不再自相矛盾）；分析面对照组：抛错函数 + `=> number()` ⇒ 仍报 nudo:case-expected（Bug 649 不回归）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
槽谓词满足 ⇒ 判 ok（与顶层写法一致）；槽谓词不满足 ⇒ 判不满足（与顶层写法一致）；期望文本递归渲染槽谓词（不再是 `{ n: number }`）；无槽谓词时渲染逐字不变（不引入噪音）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
下游是 .ts ⇒ 派生产物补 `declare const fn: …`；对照组：.js 侧车不加 declare（裸注入已够）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
两个星号导出同名 ⇒ 该名不导出（导入方报缺名），顺序无关；对照组：本地导出遮蔽星号导出 ⇒ x 存在且值取自本地（不是歧义）；定义位点解析同口径：歧义名解析不出（不得给一个确定定义模块）；定义位点对照：非歧义星号导出照常解析到定义模块	service-core-misc 聚合矩阵	没测该层	keep	keep	—
export function 的形参用源码真名（改前：arg0/arg1）；带默认值的形参：名字与个数都在（改前：arg0 一个 / arg1 假名）；rest 形参计入声明形参数并保留 ... 形态（改前：只剩 1 个）；负控制：箭头 const 导出的形参面不变	service-core-misc 聚合矩阵	没测该层	keep	keep	—
export const 箭头 / 函数表达式都进普查（普查名 = 导出槽名）；多声明符逐个收（不只首个）；非函数初始化不进普查；分析面看得见该函数，且入口求值拿到返回值	service-core-misc 聚合矩阵	没测该层	keep	keep	—
普查名 = 局部名，导出槽 = default；入口求值回退到 default 槽 ⇒ 返回值不再是 unknown；匿名 default 导出形态不变（普查名 = default）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
对象字面量的成员函数逐个收（key 名 = 导出槽名）；对象方法简写（ObjectMethod）进普查；导出槽名优先于命名函数表达式的自有 id（Bug 997，与 core listTopFunctions 同口径）；getter / setter 不是可调用入口，不进普查；非函数成员不进普查；分析面看得见该函数	service-core-misc 聚合矩阵	没测该层	keep	keep	—
getter 形态：两面都不收（Bug 996 已收口）；匿名 module.exports = fn：两面都按 default 登记（Bug 6 后 core 侧不再漏）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
带指令的源码解析出注入包（as 目标 + 覆盖值）；无指令的源码不产生注入包；注入包与收集器同源（目标区间一致）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
"作为根分析时，@nudo:as 覆盖承载语句的值"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。 断言：expect(formatShape(result.functions[0].cases[0].abs)).toBe(\"number\");"	没测该层	keep	keep	—
"依赖模块里的 @nudo:as 生效（依赖侧接线后转绿）"	"注入表此前**只对 root source** 采集（tryRunEval 的 `collectEvalReplacements(source)`）； 依赖模块走 abs-modules-graph 的另一条 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」 与「作为依赖」给出**不同类型**。 断言：expect(formatShape(fn?.cases[0].abs as never)).toBe(\"{ port: number }\");"	没测该层	keep	keep	—
依赖模块内部改写导出值后，导入方读到当前值；变异前的读取仍是精确初值（不被前一次调用的残留污染）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
依赖未改写导出值时，导入方读到初值；同文件内的模块级状态读写不受影响	service-core-misc 聚合矩阵	没测该层	keep	keep	—
原生：upper(a: string) 的 a 按 string 推断（形参注解进入推断）；原生：.ts 的合法代码不再触发 nudo:entry-may-throw 假红（a 是 string，toUpperCase 不会抛）；原生：dts 面保留源里的类型注解（export declare function upper(a: string)）；负控制：.ts 源仍被正常分析（函数可见、body 仍求值）；负控制：同形 .js 源的形参仍是无约束 any（无注解可读，行为不	service-core-misc 聚合矩阵	没测该层	keep	keep	—
坏侧车：报 nudo:contract-load（error），不发 nudo:contract-entry-only；负控制：没有侧车 → 仍报 nudo:contract-entry-only（口径不变）；负控制：好侧车 → 两者都无	service-core-misc 聚合矩阵	没测该层	keep	keep	—
不存在的依赖 → missing（不是 unreadable）；可读依赖 → ok（路径 + 内容）；guardedLoadModule：loader 抛错 → undefined + 一次性可见告警（不穿透）；负控制：ENOENT 与正常返回不受 guarded 包装影响	service-core-misc 聚合矩阵	没测该层	keep	keep	—
does not flag an import alias source name (imported)；does not flag an export alias name (exported)；does not flag a label name (labeled / break / continue)；does not flag a namespace-import binding local name；negative control: a real free glo	service-core-misc 聚合矩阵	没测该层	keep	keep	—
抛错 + 声明期望（=> 42）⇒ 报 nudo:case-expected（改前恒 0 条）；抛错 + 声明期望 ⇒ 诊断文案如实报出「实测 never」；展示层不变：抛错 + 谓词期望 ⇒ 期望展示形态仍是「number (> 0)」；负控制：不抛错 + 期望满足 ⇒ 0 条 nudo:case-expected；负控制：不抛错 + 期望不满足 ⇒ 1 条 nudo:case-expected（口径不变）；负控制：抛错 + 无期望 ⇒ 0 条 nudo:case-expe	service-core-misc 聚合矩阵	没测该层	keep	keep	—
实测 never ⇒ 不满足（底元素恒真被拦住）；负控制：实测 1、期望 1 ⇒ 满足（口径不变）；负控制：实测 1、期望 2 ⇒ 不满足（口径不变）	service-core-misc 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
引擎侧：实例 brand 名不是内部伪名	dup:service-core-misc 聚合矩阵	commit:8fa85177
dts 产物：不得出现内部伪名（改前：TS2304——伪名从未声明）	dup:service-core-misc 聚合矩阵	commit:8fa85177
schema 产物：不得 z.instanceof(内部伪名)（改前：import 即 ReferenceError）	dup:service-core-misc 聚合矩阵	commit:8fa85177
schema 产物可求值（import 即用——改前 ReferenceError）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：产物里的 z.instanceof 实参都是运行时全局构造器	dup:service-core-misc 聚合矩阵	commit:8fa85177
裸块语句上的指令登记了**节点身份**区间（改前恒空）	dup:service-core-misc 聚合矩阵	commit:8fa85177
裸块语句 与 普通语句 的签名逐字相同（替换真的生效）	dup:service-core-misc 聚合矩阵	commit:8fa85177
裸块语句命中 ⇒ 零「未命中」诊断（不许谎报作用域内没有该表达式）	dup:service-core-misc 聚合矩阵	commit:8fa85177
目标确实只在**嵌套**块里 ⇒ 诊断明说「被嵌套作用域挡住」而不是「没有该表达式」	dup:service-core-misc 聚合矩阵	commit:8fa85177
两个不同 cwd 各跑一次 ⇒ 标签逐字相同且只有一条	dup:service-core-misc 聚合矩阵	commit:8fa85177
历史 cwd 相对拼写 + 新拼写 ⇒ 归一成一条（不再并集）	dup:service-core-misc 聚合矩阵	commit:8fa85177
`{ x = 1, y = x + 1 } = {}` ⇒ 形参可省（不是必填）	dup:service-core-misc 聚合矩阵	commit:8fa85177
对照组：无默认值的解构形参仍必填	dup:service-core-misc 聚合矩阵	commit:8fa85177
模块级求值失败 ⇒ 观测面看见该文件的 module-throw 回落（装载期逃逸）	dup:service-core-misc 聚合矩阵	commit:8fa85177
假红防线：unsupported:* 回落**不**进失败信号	dup:service-core-misc 聚合矩阵	commit:8fa85177
假红防线：module-throw（程序自身抛）**不**进失败信号	dup:service-core-misc 聚合矩阵	commit:8fa85177
干净文件 ⇒ 零回落（不得凭空造失败）	dup:service-core-misc 聚合矩阵	commit:8fa85177
成员按导出槽名 `default` 登记（不再被整体丢弃）	dup:service-core-misc 聚合矩阵	commit:8fa85177
对照组：具名 default class 仍按本地名登记（口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
`=> lit(null)` 的精确结果被判定（不是 unchecked）	dup:service-core-misc 聚合矩阵	commit:8fa85177
判据本体的对照组：真 unknown ⇒ 仍是推导失败	dup:service-core-misc 聚合矩阵	commit:8fa85177
inferenceFailed：lit null/undefined ⇒ false；无 term 的 unknown ⇒ true	dup:service-core-misc 聚合矩阵	commit:8fa85177
判定层：never 配 never ⇒ 满足（Bug 649 不回归：配 number() ⇒ 不满足）	dup:service-core-misc 聚合矩阵	commit:8fa85177
分析面：抛错函数 + `=> never` ⇒ 不再发 nudo:case-expected（报告与判定不再自相矛盾）	dup:service-core-misc 聚合矩阵	commit:8fa85177
分析面对照组：抛错函数 + `=> number()` ⇒ 仍报 nudo:case-expected（Bug 649 不回归）	dup:service-core-misc 聚合矩阵	commit:8fa85177
槽谓词满足 ⇒ 判 ok（与顶层写法一致）	dup:service-core-misc 聚合矩阵	commit:8fa85177
槽谓词不满足 ⇒ 判不满足（与顶层写法一致）	dup:service-core-misc 聚合矩阵	commit:8fa85177
期望文本递归渲染槽谓词（不再是 `{ n: number }`）	dup:service-core-misc 聚合矩阵	commit:8fa85177
无槽谓词时渲染逐字不变（不引入噪音）	dup:service-core-misc 聚合矩阵	commit:8fa85177
下游是 .ts ⇒ 派生产物补 `declare const fn: …`	dup:service-core-misc 聚合矩阵	commit:8fa85177
对照组：.js 侧车不加 declare（裸注入已够）	dup:service-core-misc 聚合矩阵	commit:8fa85177
两个星号导出同名 ⇒ 该名不导出（导入方报缺名），顺序无关	dup:service-core-misc 聚合矩阵	commit:8fa85177
对照组：本地导出遮蔽星号导出 ⇒ x 存在且值取自本地（不是歧义）	dup:service-core-misc 聚合矩阵	commit:8fa85177
定义位点解析同口径：歧义名解析不出（不得给一个确定定义模块）	dup:service-core-misc 聚合矩阵	commit:8fa85177
定义位点对照：非歧义星号导出照常解析到定义模块	dup:service-core-misc 聚合矩阵	commit:8fa85177
export function 的形参用源码真名（改前：arg0/arg1）	dup:service-core-misc 聚合矩阵	commit:8fa85177
带默认值的形参：名字与个数都在（改前：arg0 一个 / arg1 假名）	dup:service-core-misc 聚合矩阵	commit:8fa85177
rest 形参计入声明形参数并保留 ... 形态（改前：只剩 1 个）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：箭头 const 导出的形参面不变	dup:service-core-misc 聚合矩阵	commit:8fa85177
export const 箭头 / 函数表达式都进普查（普查名 = 导出槽名）	dup:service-core-misc 聚合矩阵	commit:8fa85177
多声明符逐个收（不只首个）	dup:service-core-misc 聚合矩阵	commit:8fa85177
非函数初始化不进普查	dup:service-core-misc 聚合矩阵	commit:8fa85177
分析面看得见该函数，且入口求值拿到返回值	dup:service-core-misc 聚合矩阵	commit:8fa85177
普查名 = 局部名，导出槽 = default	dup:service-core-misc 聚合矩阵	commit:8fa85177
入口求值回退到 default 槽 ⇒ 返回值不再是 unknown	dup:service-core-misc 聚合矩阵	commit:8fa85177
匿名 default 导出形态不变（普查名 = default）	dup:service-core-misc 聚合矩阵	commit:8fa85177
对象字面量的成员函数逐个收（key 名 = 导出槽名）	dup:service-core-misc 聚合矩阵	commit:8fa85177
对象方法简写（ObjectMethod）进普查	dup:service-core-misc 聚合矩阵	commit:8fa85177
导出槽名优先于命名函数表达式的自有 id（Bug 997，与 core listTopFunctions 同口径）	dup:service-core-misc 聚合矩阵	commit:8fa85177
getter / setter 不是可调用入口，不进普查	dup:service-core-misc 聚合矩阵	commit:8fa85177
非函数成员不进普查	dup:service-core-misc 聚合矩阵	commit:8fa85177
分析面看得见该函数	dup:service-core-misc 聚合矩阵	commit:8fa85177
getter 形态：两面都不收（Bug 996 已收口）	dup:service-core-misc 聚合矩阵	commit:8fa85177
匿名 module.exports = fn：两面都按 default 登记（Bug 6 后 core 侧不再漏）	dup:service-core-misc 聚合矩阵	commit:8fa85177
带指令的源码解析出注入包（as 目标 + 覆盖值）	dup:service-core-misc 聚合矩阵	commit:8fa85177
无指令的源码不产生注入包	dup:service-core-misc 聚合矩阵	commit:8fa85177
注入包与收集器同源（目标区间一致）	dup:service-core-misc 聚合矩阵	commit:8fa85177
依赖模块内部改写导出值后，导入方读到当前值	dup:service-core-misc 聚合矩阵	commit:8fa85177
变异前的读取仍是精确初值（不被前一次调用的残留污染）	dup:service-core-misc 聚合矩阵	commit:8fa85177
依赖未改写导出值时，导入方读到初值	dup:service-core-misc 聚合矩阵	commit:8fa85177
同文件内的模块级状态读写不受影响	dup:service-core-misc 聚合矩阵	commit:8fa85177
原生：upper(a: string) 的 a 按 string 推断（形参注解进入推断）	dup:service-core-misc 聚合矩阵	commit:8fa85177
原生：.ts 的合法代码不再触发 nudo:entry-may-throw 假红（a 是 string，toUpperCase 不会抛）	dup:service-core-misc 聚合矩阵	commit:8fa85177
原生：dts 面保留源里的类型注解（export declare function upper(a: string)）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：.ts 源仍被正常分析（函数可见、body 仍求值）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：同形 .js 源的形参仍是无约束 any（无注解可读，行为不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：.js 源的 any 接收者成员访问仍报 may-throw（假红只对 .ts 成立）	dup:service-core-misc 聚合矩阵	commit:8fa85177
坏侧车：报 nudo:contract-load（error），不发 nudo:contract-entry-only	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：没有侧车 → 仍报 nudo:contract-entry-only（口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：好侧车 → 两者都无	dup:service-core-misc 聚合矩阵	commit:8fa85177
不存在的依赖 → missing（不是 unreadable）	dup:service-core-misc 聚合矩阵	commit:8fa85177
可读依赖 → ok（路径 + 内容）	dup:service-core-misc 聚合矩阵	commit:8fa85177
guardedLoadModule：loader 抛错 → undefined + 一次性可见告警（不穿透）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：ENOENT 与正常返回不受 guarded 包装影响	dup:service-core-misc 聚合矩阵	commit:8fa85177
does not flag an import alias source name (imported)	dup:service-core-misc 聚合矩阵	commit:8fa85177
does not flag an export alias name (exported)	dup:service-core-misc 聚合矩阵	commit:8fa85177
does not flag a label name (labeled / break / continue)	dup:service-core-misc 聚合矩阵	commit:8fa85177
does not flag a namespace-import binding local name	dup:service-core-misc 聚合矩阵	commit:8fa85177
negative control: a real free global is still reported	dup:service-core-misc 聚合矩阵	commit:8fa85177
negative control: export * as ns body reference is still reported, anchored at the reference	dup:service-core-misc 聚合矩阵	commit:8fa85177
negative control: export { y as renamed } body reference is still reported	dup:service-core-misc 聚合矩阵	commit:8fa85177
negative control: computed keys / members stay live references	dup:service-core-misc 聚合矩阵	commit:8fa85177
negative control: non-computed property names stay name positions	dup:service-core-misc 聚合矩阵	commit:8fa85177
抛错 + 声明期望（=> 42）⇒ 报 nudo:case-expected（改前恒 0 条）	dup:service-core-misc 聚合矩阵	commit:8fa85177
抛错 + 声明期望 ⇒ 诊断文案如实报出「实测 never」	dup:service-core-misc 聚合矩阵	commit:8fa85177
展示层不变：抛错 + 谓词期望 ⇒ 期望展示形态仍是「number (> 0)」	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：不抛错 + 期望满足 ⇒ 0 条 nudo:case-expected	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：不抛错 + 期望不满足 ⇒ 1 条 nudo:case-expected（口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：抛错 + 无期望 ⇒ 0 条 nudo:case-expected（unchecked 口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
实测 never ⇒ 不满足（底元素恒真被拦住）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：实测 1、期望 1 ⇒ 满足（口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
负控制：实测 1、期望 2 ⇒ 不满足（口径不变）	dup:service-core-misc 聚合矩阵	commit:8fa85177
```
