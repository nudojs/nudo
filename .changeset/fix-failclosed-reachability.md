---
"@nudojs/core": minor
---

**BREAKING**: `nudo check` 的 L2 入口 may-throw（`nudo:entry-may-throw`）fail-closed
归因改为**按可达性**：转译器拒绝的构造（`unsupported:*`）现在也归因到**经顶层辅助函数 /
类可达该构造**的入口。

此前只认「构造落在入口**自己的**源码跨度内」⇒ 同一段代码内联在入口里是红的，拆到顶层
helper 就绿：`export function f(g) { return g().x++; }` 报 error，而
`export function f(g) { return h(g); } function h(g) { return g().x++; }` 零诊断
（exit 0）。归因面同时补齐：

- **类**：入口 `C` 用整个类声明跨度；入口 `C.m` 并入构造器与同类字段初始化器
  （实例方法：构造器 + 实例字段；静态方法：静态字段 + 静态块）。
- **CJS 入口形态**：`exports.f = function …` / `module.exports.f = …` /
  `module.exports = { f: … }`（与入口枚举同一批形态，不新造入口）。

不可达的入口仍**不**背账（同模块的陪葬入口不会凭空多出 may-throw）。

谁会坏：把不支持构造拆进 helper / 类 / CJS 赋值来「绕过」L2 的代码。这些文件本来就因为
引擎无法分析整个模块而**没有任何入口结论**，此前的绿是假绿。
怎么迁移：把构造改成可分析形态，或用 `@nudo:throws Error` / `--ignore-throws Error`
显式放行该入口。
