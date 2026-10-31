/**
 * Object.prototype 自有成员名单（零依赖叶模块，单一真值源）。
 *
 * 两个消费面从本名单派生，不再各留手抄（Bug 164 的漂移教训：值读面
 * 曾漏 legacy 四访问器 ⇒ `({}).__defineGetter__ === undefined` 折
 * exact undefined，与 `in` 面（恒 true）结论相反）：
 * - `in` 判定面：`exec/member-diag.ts` 的 `OBJECT_PROTO_NAMES`（全量）
 * - 值读面：`builtins/ctor.ts` 的 `OBJECT_PROTO_METHOD_NAMES`
 *   （滤掉 `constructor` / `__proto__`——两者走专门臂）
 *
 * 名单内容 = node `Object.getOwnPropertyNames(Object.prototype)` 实测
 * （Bug 15：legacy 访问器四件恒在场）。
 */
export const OBJECT_PROTO_NAMES = new Set([
  "constructor",
  "toString",
  "valueOf",
  "toLocaleString",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
  // Bug 15 残余（node Object.getOwnPropertyNames(Object.prototype) 实测）：
  // legacy 访问器四件——缺名时 "__defineGetter__" in {} / "__lookupGetter__"
  // in [] 折 wrong-exact false（原生 true）
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
