---
"@nudojs/core": patch
---

fix(core): 用户转换钩子真调用（ToPrimitive / ToPropertyKey / toJSON）+ 原型写入的环与不可变原型判定

- Bug 381：隐式强转路径对 user obj 的钩子槽**只做存在性判定** ⇒ 钩子体从不执行 ⇒
  钩子的副作用（计数器 / 捕获变量写）与 throw 域一并丢失，且钩子体**确定抛错**的代码
  被折成**确定不抛**。修后新增 `$invoke` 调用面（`objects.ts` 的 `coercionHookOf` /
  `invokeToPrimitiveHook` / `invokeCoercionHook`）：钩子体真调用（hint 决定
  valueOf / toString 先后，@@toPrimitive 优先），副作用发生、钩子体抛错按原生传播
  （用户 try/catch 可吸收）。覆盖 `+` / 模板串 / `String()` / `JSON.stringify` 的
  `toJSON` 步 / `new Error(对象实参)`。
- Bug 383：计算成员访问的**对象键**不做 ToPropertyKey ⇒ 写被静默丢弃、键强制转换
  副作用全丢。修后 `propertyKeyOf` 对对象接收者走 ToPrimitive(string) → ToString
  （钩子真调用）；键**不可判**时写打「自有键集不完备」标记（键家族据此折 partial，
  不得折 exact 空元组）。
- Bug 385：`Object.setPrototypeOf` 不做原型环检测 ⇒ 引擎建出 native 不存在的活原型环。
  修后原型环与不可变原型在**同一事实源** `protoChangeAllowed` 判定：
  `Object.setPrototypeOf` 抛 TypeError（native 同款），`Reflect.setPrototypeOf` 返 false。
- Bug 386：`Object.setPrototypeOf(Object.prototype, …)` 不查不可变原型 ⇒ 静默改写并
  假绿。修后同 385 的单一事实源拒绝（仅 `Object.prototype` 是不可变原型——其余内建
  原型可改，native 实测）。
