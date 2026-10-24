---
"@nudojs/lsp": patch
---

fix(lsp): 补全面的绑定下沉 + 词法上下文闸（Bug 789 / 952）

- **789**：成员补全解析接收者 Abs 时不再只查**模块级** `bindings` 表（该表由
  service 的 `collectBindings` 只遍历**顶层**语句填充 ⇒ 函数体内的局部量 /
  形参不在表里）⇒ 函数内接收者一律**零候选**（连 `string` 局部量也是 0 项）。
  新增 `replay.ts` 的 `lookupScopedBinding`（**作用域感知**的绑定查询）：
  局部量走引擎节点级 Abs 重放（`recordPositions` 插桩在**声明位**记录初始化
  求值态 Abs——与模块级绑定面同口径），形参走契约种子（`generalizeFromAst` 的
  `entryShapes`，与 hover 的「A 参数面」同源）；`server-ide.ts` 的补全入口把
  它挂到 `CompletionContext.lookupBinding` 上（作用域面优先，作用域里没有才
  回落模块级绑定面）⇒ **同一份代码只改「接收者声明的位置」**，成员候选集完全
  一致。
- **952**：补全入口**单次**计算光标的词法上下文（code / comment / string），
  指令面 / 成员面 / 变量面共用同一份 ⇒ 光标落在**字符串 / 模板字面量内部**或
  注释里时不再弹出候选（接受任一项即把标识符写进字面量内部 ⇒ 静默改写运行时
  值）；代码位与注释里的 `@nudo:` 指令面行为不变。
