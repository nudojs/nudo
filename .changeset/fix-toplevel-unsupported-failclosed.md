---
"@nudojs/core": minor
---

**BREAKING**: `nudo check` 的 L2 入口 may-throw（`nudo:entry-may-throw`）fail-closed
归因补上**模块装载期**（module-init）：转译器拒绝的构造（`unsupported:*`）落在
顶层语句体 / 顶层初始化表达式 / 类定义期执行面时，现在归因到**每个**入口。

此前归因只认「入口自身跨度 ∪ 入口可达的顶层绑定」⇒ 装载期构造不属于任何入口的
执行路径 ⇒ 无人背账 ⇒ L2 静默转绿：
`const g = () => ({x:1}); g().x++; export function safe() { return 1; }`
零诊断（exit 0，尽管模块整体未被分析）。装载期代码先于**任何**入口调用执行，
转译失败 ⇒ 每个入口的 total 性都不可判定。

计入装载期（归因到每个入口）：顶层语句体、顶层 `const x = <表达式>` 初始化器、
任何顶层类的 `static {}` 块 / 静态字段初始化器 / **计算键** / `extends` 表达式
（类定义期就执行，与类是否被引用无关）。不计入（仍按 Bug 1153 的可达性归因）：
函数体与参数默认值（调用时跑）、实例字段初始化器 / 构造器 / 方法体（`new` / 调用
时跑）⇒ 不可达的 helper / 类成员里的构造仍不归因（不做过度的「陪葬入口」断言）。
构造没有 `loc` 时仍按「无证据」处理。

**TS-only 声明语句例外（Bug 895）**：`namespace` / `import x = require()` 等类型层 /
声明层语法的转译拒绝（`unsupported:statement:TS*`）**不**做装载期归因——`.ts`
源码必须保持零诊断；`namespace` 体里「程序自己的抛」与 module-throw 同族（门禁面
已静默）。enum / interface / type alias / `declare` 形态 / `as const` / `satisfies` /
抽象类本来就转译通过（实测）。

谁会坏：把不支持构造放在模块顶层（含未被引用的类的静态面）来「绕过」L2 的代码。
这些文件本来就因为引擎无法分析整个模块而**没有任何入口结论**，此前的绿是假绿。
怎么迁移：把构造改成可分析形态，或用 `@nudo:throws Error` / `--ignore-throws Error`
显式放行该入口。
