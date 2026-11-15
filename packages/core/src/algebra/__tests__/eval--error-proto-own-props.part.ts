/**
 * Bug 321：Error.prototype 的自有数据属性 name / message 缺席。
 *
 * 原生：Error 家族（Error / TypeError / RangeError / SyntaxError /
 * ReferenceError / EvalError / URIError / AggregateError）的 prototype 上
 * **各有**自有数据属性 `name`（值 = 家族名）与 `message`（值 = ""），
 * 描述符 {writable:true, enumerable:false, configurable:true}。
 * 其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）。
 *
 * node v26.10.0 原生实测（oracle）：
 *   hasOwnProperty.call(Error.prototype,"name")    → true
 *   hasOwnProperty.call(Error.prototype,"message") → true
 *   Error.prototype.name                           → "Error"
 *   Error.prototype.message                        → ""
 *   "name" in Error.prototype                      → true
 *   "message" in Error.prototype                   → true
 *   Error.prototype.propertyIsEnumerable("name")   → false（不可枚举）
 *   for (const k in Error.prototype) 计数           → 0
 *   TypeError.prototype.name                       → "TypeError"（其余七族同款）
 *   hasOwnProperty.call(Array.prototype,"name")    → false（原生无）
 *   hasOwnProperty.call(Object.prototype,"name")   → false（原生无）
 *   hasOwnProperty.call(Map.prototype,"name")      → false（原生无）
 *   "name" in Array.prototype                      → false
 *
 * 修前：protoBrandAbs 的原型面只装 `constructor` 一个槽 ⇒
 * hasOwnProperty / "name" in 全部折 false（原生 true）。
 * 修复：ctor.ts 的 protoBrandAbs —— Error 家族原型额外装自有 name / message
 * 槽（不可枚举标记挂内层 obj）。
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

/** Error 家族（原生 prototype 各自有自有 name / message） */
const ERROR_FAMILY = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
] as const;

describe("Bug 321: Error.prototype own data properties name / message", () => {
  it("Error.prototype 自有 name / message（hasOwnProperty true）", () => {
    expect(v(`export function f() { return ${HOP}(Error.prototype, "name"); }`)).toBe(true);
    expect(v(`export function f() { return ${HOP}(Error.prototype, "message"); }`)).toBe(true);
  });

  it("取值不变（name = 家族名、message = \"\"）", () => {
    expect(v(`export function f() { return Error.prototype.name; }`)).toBe("Error");
    expect(v(`export function f() { return Error.prototype.message; }`)).toBe("");
  });

  it("\"name\" / \"message\" in Error.prototype → true", () => {
    expect(v(`export function f() { return "name" in Error.prototype; }`)).toBe(true);
    expect(v(`export function f() { return "message" in Error.prototype; }`)).toBe(true);
  });

  it("自有但不可枚举（propertyIsEnumerable false、for-in 不发布）", () => {
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("name"); }`)).toBe(false);
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("message"); }`)).toBe(false);
    expect(v(`export function f() { let n=0; for (const k in Error.prototype) n++; return n; }`)).toBe(0);
  });

  it("Error 家族八个原型同款（各自 name = 家族名、message = \"\"）", () => {
    for (const name of ERROR_FAMILY) {
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "name"); }`), name).toBe(true);
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "message"); }`), name).toBe(true);
      expect(v(`export function f() { return ${name}.prototype.name; }`), name).toBe(name);
      expect(v(`export function f() { return ${name}.prototype.message; }`), name).toBe("");
    }
  });

  it("对照组：其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）", () => {
    for (const name of ["Array", "Object", "Map", "Promise"]) {
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "name"); }`), name).toBe(false);
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "message"); }`), name).toBe(false);
    }
    expect(v(`export function f() { return "name" in Array.prototype; }`)).toBe(false);
    expect(v(`export function f() { return "message" in Array.prototype; }`)).toBe(false);
    expect(v(`export function f() { return "name" in Object.prototype; }`)).toBe(false);
  });

  it("constructor 自有槽不受影响（仍是原型自有、非枚举）", () => {
    expect(v(`export function f() { return ${HOP}(Error.prototype, "constructor"); }`)).toBe(true);
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("constructor"); }`)).toBe(false);
    expect(v(`export function f() { return Error.prototype.constructor.name; }`)).toBe("Error");
  });
});
