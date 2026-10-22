---
"@nudojs/core": patch
---

fix(core exec/class): 派生构造器 super 通道、实例字段自有数据属性、构造器对象返回值、bind 产物可构造、Proxy construct 靶判定、super.constructor 取父类

- **Bug 245**：派生类构造器未调 `super()` / 重复调 `super()` 定抛 `ReferenceError`（原生 "Must call super constructor…" / "Super constructor may only be called once"）——引擎此前无「本帧已调 super」状态通道，两者皆静默通过。状态走 `class/declare.ts` 的**模块级 WeakMap 侧表**（不改公共类型；`class/super.ts` 的 `$super` 标记 + `constructClass` 终判）。
- **Bug 247**：实例字段落地改走 **CreateDataPropertyOrThrow** 语义（自有数据属性，**不**沿原型链派发 setter）——父类同名 getter/setter 不再拦截字段落地（此前 getter-only 假抛 `TypeError`、setter-only 把字段写穿到父类 setter）。
- **Bug 250**：宿主构造器 / 可构造 fn Abs 的返回值判定放宽为「是 Object 就用它」（`obj|arr|tuple|fn|brand|eff`）——构造器返回数组 / 函数不再被静默换回 `this`。
- **Bug 253**：`Function.prototype.bind` 产物**可构造**——原生 `new (f.bind(thisArg, ...bound))()` 走目标的 `[[Construct]]`（新实例 + 绑定实参前置 + `this` = 新实例）；构造 facet 走 `class/declare.ts` 的**模块级 WeakMap 侧表**（不改公共类型 `AbsFnImpl`）。
- **Bug 257**：`$new` 的 Proxy 分支先判 **IsConstructor(target)**——靶不可构造时定抛 `TypeError` 且**不派发** construct 陷阱（此前陷阱照常派发、副作用发生、构造"成功"）。
- **Bug 266**：`super.constructor` 取**父类构造器**（父类值注册表）——此前回落内置 `Object`（`Sub.who() => "Object"`、`super.constructor === Base` 假 false）。
