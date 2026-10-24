---
"@nudojs/core": patch
---

fix(core): 引擎内部临时名避让补齐 switch / 自增 IIFE / 类 setter 别名 / 循环协议
（附录 A#4 · Bug 1159）

Bug 1058/1059 约定「引擎内部临时名必须避开用户标识符」，此前落到 `__nudoMp*` /
调用族 / 可选链 / 短路 / 对象 / 类形参。附录 A#4 登记为「实测无害」的残留经
逐点探针**全部可触发**（体内确有用户表达式在引擎临时名的块作用域里求值），
现统一改经 `internalTmpName` / `internalTmpNameSet` 分配：

- **switch 的 case 测试辅助族 / 共享体名**（`__swT` / `__swTV` / `__swTD` /
  `__swAllDone` / `__swTestRead` / `__swEval` / `__swEvalAll` / `__swI` /
  `__swJ` / `__swBody{n}`）：测试 thunk 与臂 thunk 都在该块作用域里求值用户
  表达式 ⇒ 用户同名外层绑定被**遮蔽**（`const __swAllDone = 42` 被读成引擎的
  `false`）或撞 **TDZ**（臂入口注入的 `if (!__swTestRead)` 在用户
  `let __swTestRead` 声明之前读 ⇒ ReferenceError）。
- **switch 臂 break 标签**（`__nudoSw{n}`）：标签是**信号字符串**
  （`$loopBreak` / `$isBreakTo` 按字符串比对）⇒ 与用户同名标签块相撞时，臂内
  **无标签** `break` 的信号被用户的标签块 catch 吸收 ⇒ switch 不退出、块后续
  语句照跑（错值）。
- **自增 IIFE**（`expr/operators.ts` 的 `__v` / `__old`、非路径 delete IIFE 的
  `__nudoDelP` / `__nudoDelK` / `__nudoDelD`）：IIFE 体内求值 / 重复发射用户
  表达式（接收者、写目标标识符、父对象、计算键）⇒ 遮蔽或 TDZ。除附录登记项外，
  同文件另发现两处同族残留（标识符后缀 `x++` 的 `__old`、delete IIFE），一并修复。
- **类 setter 别名载体**（`class-emit.ts` 的 `__nab{i}` / `__nabs`）：thunk 体内
  求值用户 setter 体 ⇒ 遮蔽用户同名外层绑定。
- **循环协议公共名**（`stmt/statement.ts`）：`for` fallback 的 `$for` 状态线程
  形参 `__n`（测试 / 体 thunk 内联用户源码 ⇒ `let __n = 100; for (i = 0; __n < 3; i++)`
  的条件被读成合成计数器）与 do-while 首轮标记 `__nudoDwFirst`（块级绑定 +
  体 thunk 内联用户体）。
- **表达式侧两处同族残留**（`expr/function.ts` 的宿主 rest 形参名 `__rest_raw`
  与 `expr/assignment.ts` 的解构赋值 IIFE 形参 `__d`，按同族 grep 指令扩展）：
  前者与用户同名 rest 形参**重复声明**（SyntaxError），后者让默认值表达式读到
  IIFE 实参对象。
- **for-in 接收者临时名**（`stmt/statement.ts` 的 `__fir{n}`，按同族 grep 指令
  发现的第 4 处）：`const __fir{n} = (用户接收者表达式)` 的初始化器与循环体都在
  该块里求值用户代码 ⇒ 首轮重复声明 SyntaxError；Bug 1139 的重试仅**碰巧**
  推高计数器躲开单名碰撞，两次尝试的序号都被用户占用时宿主 SyntaxError 直接
  冒出 `runTranspiled`。

无碰撞时基名原样返回 ⇒ **产物逐字不变**（9507 条差分语料 + 手写 switch / label /
类 / 私有名 / delete 语料，`git archive HEAD` 的旧发射器与新版对拍 0 diff）；
撞名时改名只发生在该源文本内（基名仍由既有计数器决定，计数器行为未变）
⇒ **无缓存键 / ABI 变更**。诊断语码与门禁口径不变。
