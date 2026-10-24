---
"@nudojs/core": patch
---

fix(core): this 载体名 `__this` 避让用户标识符（附录 A#4 · Bug 1160）

Bug 1058/1059 约定「引擎内部临时名必须避开用户标识符」。附录 A#4 把 `__this`
载体登记为「实测无害」并显式留到独立一波（1149 / 1151 的钉子断言了该字面
形态）——经逐点探针**全部可达**：`__this` 是跨发射器协议（真函数 prologue
`let __this = $rawThis(this)` / 宿主生成器 hoist 声明，与类/对象方法、构造器、
访问器 thunk、字段 / 静态块 / `@@hasInstance` 安装 thunk 的首参声明），而这些
作用域里求值的是用户源码：

- **真函数**（声明 / 表达式 / 生成器）：用户形参同名 ⇒ `let __this` 与形参
  **重复声明** SyntaxError ⇒ 整模块 fail-closed；外层 / 块级同名 ⇒ 体内 `this`
  读到用户绑定、用户读 `__this` 读到载体（自信错值）。
- **类 / 对象方法 + 构造器**（含函数表达式属性）：宿主签名是
  `(__this, <用户形参>)` ⇒ 用户形参同名 ⇒ 重复形参 SyntaxError；默认参数、
  体内块级同名、`super()` 接收者重绑（块级 `let __this` 劫持重绑）同款失效。
- **访问器 / 字段 / 静态块 thunk**：thunk 首参 `__this` 遮蔽外层用户绑定
  （getter / setter / 实例字段 / 静态字段 / 静态块 / 具名类 `let C = __this`
  绑定）；静态块顶层 `let __this` 与 thunk 形参重复声明。
- **`@@hasInstance` 安装 thunk**（静态字段与字符串键静态方法两种形态）：
  值 / 方法体在 thunk 内求值 ⇒ 同款遮蔽。
- **类名恰为 `__this`**：静态块 `thisParam` = 类名与 thunk 首参同名 ⇒
  重复声明 / 自遮蔽。

修法：**单一来源** `helpers.ts` 的 `thisCarrierOf(opts)`——根转译单元
（`transpileFile` / `transpileBodyNode`）经 `internalTmpName("__this", opts)`
在入口分配一次并写入 `opts.thisSlot`，全部声明方与 `thisParam` 读方经同一
函数取同名（避让口径 = `userIdentInfoOf(opts)` = 源文本词形 ∪
`opts.userIdents`；撞名加 `_k` 后缀）——**不造第二套命名机制**。

无碰撞时基名原样返回 ⇒ **产物逐字不变**（9485 条差分语料 + 19 条手写
方法 / 访问器 / 箭头 / 类字段 / 静态块 / 对象方法 / `new.target` / `super`
语料，`git archive HEAD` 旧发射器与新版对拍 0 diff）；撞名改名是源文本局部
分配（确定性：同源 ⇒ 同名）⇒ **无缓存键 / ANALYSIS_ABI 变更**。诊断语码与
门禁口径不变。
