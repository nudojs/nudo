/**
 * Bug 66：error 实例 name/message/stack 的属性属主/可枚举面。
 * 此前 errorBrandAbs 把三槽建成普通自有可枚举槽：
 * - hasOwnProperty("name") 折 true（原生 false——name 经原型链从
 *   X.prototype.name 解析，非实例自有）
 * - propertyIsEnumerable("message"|"name"|"stack") 折 true（原生 false
 *   ——message/stack 自有但不可枚举；flags 侧表记在内层 Abs，外层 brand
 *   查询 miss）
 * 修复：name 槽打 Slot.inherited（自有面 introspection 折 false，$get 直读
 * /$in 不受影响）；propertyIsEnumerable 沿 brand 剥内层查 enumerable 侧表；
 * $set 公有覆写 inherited 槽落地转自有可枚举（e.name = "X"、子类 name 字段）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

describe("Bug 66: error slot own/enumerable attributes", () => {
  it("hasOwnProperty(\"name\") → false（name 继承自 X.prototype，非自有）", () => {
    expect(v(`export function f() { return new Error("m").hasOwnProperty("name"); }`)).toBe(false);
    expect(v(`export function f() { return new TypeError("m").hasOwnProperty("name"); }`)).toBe(false);
    expect(v(`export function f() { return new RangeError("m").hasOwnProperty("name"); }`)).toBe(false);
    expect(v(`export function f() { return new AggregateError([1], "m").hasOwnProperty("name"); }`)).toBe(false);
  });

  it("propertyIsEnumerable 全家族槽 → false", () => {
    expect(v(`export function f() { return new Error("m").propertyIsEnumerable("message"); }`)).toBe(false);
    expect(v(`export function f() { return new Error("m").propertyIsEnumerable("name"); }`)).toBe(false);
    expect(v(`export function f() { return new Error("m").propertyIsEnumerable("stack"); }`)).toBe(false);
    expect(v(`export function f() { return new AggregateError([1], "m").propertyIsEnumerable("errors"); }`)).toBe(false);
    expect(v(`export function f() { return new Error("m", { cause: 1 }).propertyIsEnumerable("cause"); }`)).toBe(false);
  });

  it("对照：message/errors/cause 是自有（hasOwnProperty true）", () => {
    expect(v(`export function f() { return new Error("m").hasOwnProperty("message"); }`)).toBe(true);
    expect(v(`export function f() { return new Error("m").hasOwnProperty("stack"); }`)).toBe(true);
    expect(v(`export function f() { return new AggregateError([1], "m").hasOwnProperty("errors"); }`)).toBe(true);
    expect(v(`export function f() { return new Error("m", { cause: 1 }).hasOwnProperty("cause"); }`)).toBe(true);
  });

  it("对照：枚举面保持空（keys/for-in/spread/assign），值读取不回归", () => {
    expect(v(`export function f() { return Object.keys(new Error("m")).length; }`)).toBe(0);
    expect(v(`export function f() { let n = 0; for (const k in new Error("m")) n++; return n; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys({ ...new Error("m") }).length; }`)).toBe(0);
    expect(v(`export function f() { return new Error("m").name; }`)).toBe("Error");
    expect(v(`export function f() { return new TypeError("m").name; }`)).toBe("TypeError");
    expect(v(`export function f() { return new Error("m").message; }`)).toBe("m");
    expect(v(`export function f() { return typeof new Error("m").stack; }`)).toBe("string");
  });

  it("\"name\" in err → true（$in 槽存在性不受 inherited 影响）", () => {
    expect(v(`export function f() { return "name" in new Error("m"); }`)).toBe(true);
  });

  it("gOPN 不列 name（原型链槽非自有）；message/stack 照列", () => {
    const r = call(`export function f() { return Object.getOwnPropertyNames(new Error("m")).join(","); }`);
    const lv = litValue(r.result);
    const s = (lv.ok ? lv.value : undefined) as string;
    expect(s).not.toContain("name");
    expect(s).toContain("message");
    expect(s).toContain("stack");
  });

  it("公有覆写落地转自有可枚举（e.name = \"X\" 原生建自有属性）", () => {
    expect(v(`export function f() { const e = new Error("m"); e.name = "X"; return e.hasOwnProperty("name"); }`)).toBe(true);
    expect(v(`export function f() { const e = new Error("m"); e.name = "X"; return e.propertyIsEnumerable("name"); }`)).toBe(true);
    expect(v(`export function f() { const e = new Error("m"); e.name = "X"; return e.name; }`)).toBe("X");
    // message/stack 自有不可枚举槽覆写保持属性（原生 [[Set]] 不改 enumerable）
    expect(v(`export function f() { const e = new Error("m"); e.message = "x"; return e.propertyIsEnumerable("message"); }`)).toBe(false);
    expect(v(`export function f() { const e = new Error("m"); e.stack = "s"; return e.propertyIsEnumerable("stack"); }`)).toBe(false);
  });

  it("extends Error 子类：自有 name 字段是可枚举自有属性", () => {
    expect(v(`export class N extends Error { name = "N"; constructor(m) { super(m); } }
      export function f() { return new N("x").hasOwnProperty("name"); }`)).toBe(true);
    expect(v(`export class N extends Error { name = "N"; constructor(m) { super(m); } }
      export function f() { return new N("x").propertyIsEnumerable("name"); }`)).toBe(true);
    expect(v(`export class N extends Error { name = "N"; constructor(m) { super(m); } }
      export function f() { return Object.keys(new N("x")).join(","); }`)).toBe("name");
    expect(v(`export class N extends Error { name = "N"; constructor(m) { super(m); } }
      export function f() { return new N("x").name; }`)).toBe("N");
    // 无自有 name 字段：值经基类链折 "Error"，自有面 false
    expect(v(`export class M extends Error {} export function f() { return new M("x").name; }`)).toBe("Error");
    expect(v(`export class M extends Error {} export function f() { return new M("x").hasOwnProperty("name"); }`)).toBe(false);
  });

  it("catch 形参（errorTypeAbs 载荷）同口径", () => {
    expect(v(`export function f() { try { null.x; } catch (e) { return e.hasOwnProperty("name"); } }`)).toBe(false);
    expect(v(`export function f() { try { null.x; } catch (e) { return e.propertyIsEnumerable("message"); } }`)).toBe(false);
    expect(v(`export function f() { try { null.x; } catch (e) { return e.name; } }`)).toBe("TypeError");
    expect(v(`export function f() { try { null.x; } catch (e) { return e.hasOwnProperty("message"); } }`)).toBe(true);
  });
});
