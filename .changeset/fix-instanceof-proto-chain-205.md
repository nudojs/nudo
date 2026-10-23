---
"@nudojs/core": patch
---

`instanceof` 按**真实原型链**判定：补上闭 obj 接收者与函数值接收者两面（Bug 205 · 族 43 · 片 S7）

族 02 已把 brand 实例侧（`F.prototype = {}` / `Object.setPrototypeOf(f, null)`）
从「按构造器**名**匹配」改成「沿记录的原型链做身份比较」。本片补上此前仍
降抽象的两面，并把宿主口径钉进回归钉。

- **闭 obj 接收者（对象字面量）**：它的 `[[Prototype]]` 恰是
  `Object.prototype` ⇒ 原型链恰是 `[Object.prototype]`（下一环 null）⇒ 与
  右操作数的 `prototype` 做**身份**比较即可定论。此前只有**内建**构造器名
  （`Array` / `Date` / …）折精确 `false`，**用户类 / 用户函数**一律折抽象
  `boolean`：`({}) instanceof F` 的原生值是 `false`，引擎却答「不知道」。
  现在：用户类 / 用户函数 → 精确 `false`；`F.prototype = Object.prototype`
  之后 → 精确 `true`（原型身份命中）。
- **左操作数是宿主函数**（`function F(){}` / `function () {}`）：转译后进
  `$instanceof` 的左值不是 Abs，此前直读 `left.shape` 崩 ⇒ 引擎 fail-closed
  折 `unknown`。原生 `F instanceof Function` / `F instanceof Object` 都是
  `true`（函数的 `[[Prototype]]` 是 `Function.prototype`）。现在折精确 `true`。
- **口径更正（宿主实测）**：`new F() instanceof Function` 的原生值是
  **`false`**，不是 `true`——普通函数 `F` 的实例原型链是
  `f → F.prototype → Object.prototype → null`，`Function.prototype` 不在其中。
  只有**以 Function 为基类**的类实例（`class X extends Function`）才是 `true`。
  引擎此前已给精确 `false`（与原生一致），本片保持该口径并写入回归钉——此前
  修复台账里「原生 true」的记述与宿主实测不符，以本钉为准。
- **不误判护栏**：右操作数的 `prototype` **不可判**时（箭头函数 / async 函数 /
  生成器函数——原生可能**无** `.prototype` ⇒ 定抛 `TypeError`；`bind` 产物——
  可构造但无 `.prototype`）⇒ 保持抽象 `boolean`，不折精确 `false`。引擎替身
  对象（生成器对象等**内部槽** obj）同样不按「闭 obj ⇒ 原型链 =
  `[Object.prototype]`」定论（其真实原型不是 `Object.prototype`）。
- **已知债（不在本片范围）**：替换 / `setPrototypeOf` 进来的新原型，其**自身**
  的 `[[Prototype]]` 链未建模 ⇒ 引擎诚实降 `boolean`（原生 true/false vs 引擎
  boolean —— sound 不误判）。本片不改既有钉
  `eval-bug-205-instanceof-prototype-chain.test.ts` 的该条断言。
