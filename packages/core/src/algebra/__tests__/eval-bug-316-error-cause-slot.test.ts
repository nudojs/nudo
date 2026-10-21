/**
 * Bug 316：`new Error("m", {})`（options **无 cause 键**）仍被装上自有 cause 槽。
 *
 * 原生 InstallErrorCause（ES2022 10.2.1）：**只有** options 真有 `cause`
 * 键时才 CreateNonEnumerableDataPropertyOrThrow(error, "cause", cause)——
 * options 无 cause 键 ⇒ 错误对象**无**自有 cause 槽（hasOwnProperty /
 * Object.hasOwn / `"cause" in e` 恒 false）；cause 键存在但值是 undefined
 * ⇒ 装槽、值为 undefined。
 *
 * node v26.10.0 原生实测（oracle）：
 *   new Error("m", {}).hasOwnProperty("cause")            → false
 *   "cause" in new Error("m", {})                          → false
 *   new Error("m", {}).cause                               → undefined
 *   new Error("m", {cause: 42}).hasOwnProperty("cause")    → true
 *   new Error("m", {cause: 42}).cause                      → 42
 *   new Error("m", {cause: undefined}).hasOwnProperty(..)  → true（值 undefined）
 *   new Error("m").hasOwnProperty("cause")                 → false
 *   Object.getOwnPropertyNames(new Error("m", {}))         → ["stack","message"]
 *   Object.getOwnPropertyNames(new Error("m", {cause: 1})) → ["stack","message","cause"]
 *
 * 修前：options 无 cause 键也装一个 undefAbs() 槽 ⇒ 自有面假 true
 * （"cause" in e 也假 true——$in 走槽存在性判定）。
 * 修复：error-family.ts 的 errorBrandAbs —— cause 槽**仅在** options 真有
 * cause 键时装。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 调用 f() 的字面量结果（非字面量 → undefined） */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

const HOP = "Object.prototype.hasOwnProperty.call";

describe("Bug 316: Error cause slot only when options has a cause key", () => {
  it("options 无 cause 键 ⇒ 无自有 cause 槽（hasOwnProperty false）", () => {
    expect(v(`export function f() { return ${HOP}(new Error("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new TypeError("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new RangeError("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new AggregateError([1], "m", {}), "cause"); }`)).toBe(false);
  });

  it("options 无 cause 键 ⇒ \"cause\" in e 恒 false（$in 走槽存在性）", () => {
    expect(v(`export function f() { return "cause" in new Error("m", {}); }`)).toBe(false);
    expect(v(`export function f() { return "cause" in new TypeError("m", {}); }`)).toBe(false);
    expect(v(`export function f() { return "cause" in new Error("m"); }`)).toBe(false);
  });

  it("options 无 cause 键 ⇒ e.cause 读出 undefined（缺席槽）", () => {
    expect(v(`export function f() { return new Error("m", {}).cause; }`)).toBe(undefined);
    expect(v(`export function f() { return new Error("m").cause; }`)).toBe(undefined);
  });

  it("Object.hasOwn：无 cause 键 ⇒ false", () => {
    expect(v(`export function f() { return Object.hasOwn(new Error("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "cause"); }`)).toBe(false);
  });

  it("options 有 cause 键 ⇒ 装槽（自有、值精确）", () => {
    expect(v(`export function f() { return ${HOP}(new Error("m", {cause: 42}), "cause"); }`)).toBe(true);
    expect(v(`export function f() { return new Error("m", {cause: 42}).cause; }`)).toBe(42);
    expect(v(`export function f() { return "cause" in new Error("m", {cause: 42}); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new Error("m", {cause: 1}), "cause"); }`)).toBe(true);
  });

  it("cause 键存在但值为 undefined ⇒ 仍装槽（值为 undefined）", () => {
    expect(v(`export function f() { return ${HOP}(new Error("m", {cause: undefined}), "cause"); }`)).toBe(true);
    expect(v(`export function f() { return String(new Error("m", {cause: undefined}).cause); }`)).toBe("undefined");
  });

  it("gOPN：cause 槽缺席 ⇒ 安装序止于 stack→message（原生同）", () => {
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m", {})).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m")).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m", {cause: 1})).join(","); }`)).toBe("stack,message,cause");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new AggregateError([1], "m", {cause: 1})).join(","); }`)).toBe("stack,message,cause,errors");
  });

  it("gOPD：cause 键缺席 ⇒ 描述符 undefined；存在 ⇒ 数据描述符", () => {
    expect(v(`export function f() { return String(Object.getOwnPropertyDescriptor(new Error("m", {}), "cause")); }`)).toBe("undefined");
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new Error("m", {cause: 42}), "cause"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`)).toBe("42,true,false,true");
  });

  it("cause 槽不可枚举（原生非枚举数据属性）", () => {
    expect(v(`export function f() { return new Error("m", {cause: 1}).propertyIsEnumerable("cause"); }`)).toBe(false);
    expect(v(`export function f() { return new Error("m", {}).propertyIsEnumerable("cause"); }`)).toBe(false);
  });
});
