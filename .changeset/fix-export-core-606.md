---
"@nudojs/core": patch
---

契约投影里的 `__proto__` 形参不再被吞掉（族 17 · Bug 606 的 core 侧两处）。

- **投影字段表改无原型**（`algebra/projection.ts` 的 `projectObj`）：槽位被抄进
  一个**普通对象** `fields` ⇒ 键 `__proto__` 的赋值命中
  `Object.prototype.__proto__` 的**原型 setter** ⇒ 该键永不成自有属性 ⇒
  `Object.entries()` 看不到它 ⇒ 契约投影**静默丢掉** `__proto__` 形参
  （zod 产物丢键，而 dts 面走另一条路径是对的 ⇒ 跨产物面自相矛盾）。
  改用 `Object.create(null)`（与 `constraint.ts` 的 `partial()` 同一惯例；
  core 侧消费全走 `Object.entries` / `Object.hasOwn` / `!== undefined` ⇒ 无原型安全）。
- **键渲染改计算键**（`algebra/codegen-escape.ts` 的 `formatObjectKey`）：
  `__proto__` 虽然长得像普通标识符，但在 **JS 对象字面量**里 `__proto__: v` 是
  **原型 setter**（不是自有属性）⇒ 运行时该键根本不存在（zod 形状丢键）。
  一律写成计算键 `["__proto__"]` —— 计算键是普通自有属性。
