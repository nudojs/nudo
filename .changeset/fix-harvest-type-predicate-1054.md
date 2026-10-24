---
"@nudojs/harvester": patch
---

族 27 修复 S4：Bug 1054 —— TS **类型谓词**的返回类型不再被收割成 `unknown`。

`mapType` 的类型节点分派表**没有 `TypePredicate` 分支** ⇒ `x is T` / `asserts x is T`
落进兜底分支（`default: return absUnknown()`）⇒ 被谓词的签名返回面变成 `unknown`：

- 调用方的签名面随之变成 `unknown` ⇒ 触发 `nudo:unknown-inference` **误导诊断**
  （把「谓词返回 boolean」说成「推断失败」，并把用户引向 `@nudo:case` / env mock /
  refine —— 而真正要修的是收割器）；
- dts 产物写 `unknown` ⇒ 消费方 tsc **TS2322 假红**（`const b: boolean = f(x)`）。

修法（**同一张分派表**上补分支，不另起一套）：按 TS 运行时语义映射返回面 ——
`x is T` ⇒ **`boolean`**（`T` 是**收窄信息**，是调用点的副作用，**不是**返回面）；
`asserts x is T` / `asserts x` ⇒ **`void`**（断言函数运行时返回 `undefined`，
与 `: void` 返回同口径）。覆盖顶层函数、接口方法签名、函数类型（type literal）三条路径。
