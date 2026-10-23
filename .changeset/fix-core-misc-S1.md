---
"@nudojs/core": patch
---

fix(core): `String.prototype.matchAll(<非 RegExp 实参>)` 不再折**确定**
TypeError（Bug 449）

- ES2023 规定：只有「实参**确定是 RegExp** 且其 flags **确定不含 `g`**」
  才抛 TypeError；实参确定不是 RegExp 时走
  `RegExpCreate(ToString(pattern), "g")`（`g` 由算法自补）⇒ 返回**迭代器**。
  此前这条「无 `g` ⇒ TypeError」的判定被错误推广到**所有非 RegExp 实参**
  ⇒ `"abc".matchAll("b")` / `matchAll(1)` / `matchAll()` / `matchAll(null)`
  全部被折成 `never` + `throws: TypeError`（假抛 ⇒ L2 `entry-may-throw` 假红）。
- 现在：字面量接收者 + 字面量 pattern 走 `new RegExp(ToString(pattern), "g")`
  **真迭代**（迭代项是 `RegExpExecArray` 匹配数组，不是字符串）；抽象接收者 /
  抽象 pattern 走抽象臂 ⇒ 迭代器（元素域保守 unknown，迭代器协议面齐），
  **不抛** TypeError。
- 非法模式仍是**确定 `SyntaxError`**（`"abc".matchAll("(")`），不得回落成
  「本臂不接管」哨兵（否则 throws 域折 `never` ⇒ 假 no-throw）。
- 未变：实参确定是 RegExp 且确定无 `g` ⇒ **仍**确定 TypeError
  （`"abc".matchAll(/b/)`）；`Symbol` 实参仍确定 TypeError。
