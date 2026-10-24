---
"@nudojs/lsp": patch
---

fix(lsp): 成员补全引擎的接收者解析与内建原型投影（Bug 771 / 772 / 782 / 787 / 788）

- **771** union 接收者的补全不再跳过「零成员」的那一支：sum 交集计算区分
  「该臂成员集为空」（原始值臂 ⇒ 交集必空）与「该臂补全信息不可得」
  （unknown / any / never ⇒ 可跳过）⇒ `{x,y} | 5` 的 `u.` 不再给出 `x` / `y`
  （取属性在原始值臂上是 TypeError）。
- **772** 成员补全的接收者按**整条成员访问链**解析（`a.b.c` ⇒ 接收者是 `a.b`），
  不再取最后一段标识符 ⇒ `a.b.` 不再给出同名顶层绑定的成员。
- **782** 接收者识别与源码消毒的标识符捕获组改为 Unicode 感知
  （JS IdentifierStart/Continue + `$`）⇒ 非 ASCII 接收者（`对象.`）给出该对象的
  成员，不再回落成顶层变量表。
- **787** 字面量 / 括号 / 字符串接收者（`(42).` / `(true).` / `"abc".`）走内建
  原型表（Number / Boolean / String）；**认不出接收者时给空**，绝不回落成顶层
  变量表（那份表与「成员」意图无关）。
- **788** prim 分支按类型分派到对应的内建原型表
  （number → Number / boolean → Boolean / bigint → BigInt / symbol → Symbol），
  品牌名命中内建类时同样投影该类成员 ⇒ number / boolean 接收者不再是零候选。

新增 `getCompletionsAtPosition` 的**上下文入参**（`CompletionContext`）与
`completionBranchAt` 补全面分支判定入口，供调用方（IDE 入口）按光标词法上下文
与作用域决定成员面 / 变量面。
