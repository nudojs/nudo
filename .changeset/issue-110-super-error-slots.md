---
"@nudojs/core": patch
---

fix(core): class extends Error 的 super(message) 不再静默 no-op——基类构造槽落地（#110）

`constructClass` 对无注册 spec 的基类（env/宿主内建构造器）此前原样返回 thisVal，`super(message)` 的 args 被丢弃：派生实例 `e.message` 折假精确 `undefined #exact`（原生为 message 字符串）、`e.name` 同为 `undefined #exact`（原生经原型链为 `"Error"`）。#106 恢复 `class extends Error` 定义期干净后暴露面增大。

修复：`!spec` 分支对 Error 家族（isErrorCtorName）按 errorBrandAbs 落 name/message 槽——与 `new Error(...)` 完全同口径：

- lit message 保精确、ToString 折叠（number → "5"、缺省 → ""）、AggregateError errors/message/cause 实参序、options.cause 透传；
- any message 构造记录 message-ToString may-throw（`new Error(Symbol())` 原生抛 TypeError，L2 同 `new Error(anyMsg)`）；
- brand 名保持被构造实例（B extends A extends Error 中间用户类链不换名、方法派发不断链）；name 槽是基类名（原生 Error.prototype.name 经原型链可见），子类自有 name 字段/赋值源序在 super 后照常覆盖；
- 用户同名类优先（getEvalClass 命中即不走内建分支）；其余内建基类（Promise/Date/…）维持原样。
