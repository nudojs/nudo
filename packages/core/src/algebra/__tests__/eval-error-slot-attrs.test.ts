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

  it("gOPN 不列 name（原型链槽非自有）；安装序 stack→message（R4b）", () => {
    const r = call(`export function f() { return Object.getOwnPropertyNames(new Error("m")).join(","); }`);
    const lv = litValue(r.result);
    const s = (lv.ok ? lv.value : undefined) as string;
    expect(s).not.toContain("name");
    expect(s).toContain("message");
    expect(s).toContain("stack");
    // R4b：node 实测 V8 先装 stack——["stack","message"]
    expect(s).toBe("stack,message");
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

describe("R4: error brand introspection（gOPD / Object.hasOwn / gOPN 安装序）", () => {
  it("gOPD message/cause/errors → 精确数据描述符（writable:true, enumerable:false, configurable:true）", () => {
    // node 实测：gOPD(new Error("m"), "message") →
    // {value:"m", writable:true, enumerable:false, configurable:true}
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new Error("m"), "message"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("m,true,false,true");
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new Error("m", { cause: 42 }), "cause"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("42,true,false,true");
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new AggregateError([1], "m"), "errors"); return [d.value.length, d.value[0], d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("1,1,true,false,true");
  });

  it("gOPD stack → 数据描述符面（engine 全局 stack 数据槽模型，值域 string）", () => {
    // 引擎把 stack 建模为自有数据槽（Bug 59——$get e.stack 折 string 域），
    // gOPD 沿同模型折数据描述符；V8 原生是访问器描述符（get/set）——
    // 引擎侧无访问器建模，writable/enumerable/configurable 仍精确
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new Error("m"), "stack"); return [typeof d.value, d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("string,true,false,true");
  });

  it("gOPD name（inherited 原型链槽）与缺席键 → undefined", () => {
    expect(v(`export function f() { return Object.getOwnPropertyDescriptor(new Error("m"), "name") === undefined; }`)).toBe(true);
    expect(v(`export function f() { return Object.getOwnPropertyDescriptor(new Error("m"), "nope") === undefined; }`)).toBe(true);
  });

  it("Object.hasOwn：name false（原型链）；message/stack/errors/cause true；缺席键 false", () => {
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "name"); }`)).toBe(false);
    expect(v(`export function f() { return Object.hasOwn(new TypeError("m"), "name"); }`)).toBe(false);
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "message"); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "stack"); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new Error("m", { cause: 1 }), "cause"); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new AggregateError([1], "m"), "errors"); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "nope"); }`)).toBe(false);
  });

  it("gOPN 安装序：stack→message→cause→errors（node 实测 V8 安装序）", () => {
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m")).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new TypeError("m")).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m", { cause: 1 })).join(","); }`)).toBe("stack,message,cause");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new AggregateError([1], "m")).join(","); }`)).toBe("stack,message,errors");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new AggregateError([1], "m", { cause: 1 })).join(","); }`)).toBe("stack,message,cause,errors");
  });

  it("$set 覆写后 gOPD 跟随：name 覆写转自有可枚举；message 覆写保持不可枚举", () => {
    // 原生 e.name = "X" 建自有可枚举数据属性；e.message = "x" 是 [[Set]]
    // 不改属性属主/可枚举性
    expect(v(`export function f() { const e = new Error("m"); e.name = "X"; const d = Object.getOwnPropertyDescriptor(e, "name"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("X,true,true,true");
    expect(v(`export function f() { const e = new Error("m"); e.message = "x"; const d = Object.getOwnPropertyDescriptor(e, "message"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`))
      .toBe("x,true,false,true");
  });

  it("catch 形参（errorTypeAbs 载荷）同口径：stack 自有可读、gOPN 安装序一致", () => {
    expect(v(`export function f() { try { null.x; } catch (e) { return typeof e.stack; } }`)).toBe("string");
    expect(v(`export function f() { try { null.x; } catch (e) { return Object.hasOwn(e, "stack"); } }`)).toBe(true);
    expect(v(`export function f() { try { null.x; } catch (e) { return Object.hasOwn(e, "name"); } }`)).toBe(false);
    expect(v(`export function f() { try { null.x; } catch (e) { return Object.getOwnPropertyNames(e).join(","); } }`)).toBe("stack,message");
    expect(v(`export function f() { try { null.x; } catch (e) { return Object.getOwnPropertyDescriptor(e, "stack") === undefined; } }`)).toBe(false);
  });

  it("extends Error 子类：gOPN 安装序 stack→message→字段；gOPD message 不可枚举", () => {
    expect(v(`export class M extends Error {} export function f() { return Object.getOwnPropertyNames(new M("x")).join(","); }`))
      .toBe("stack,message");
    expect(v(`export class N extends Error { f = 1; } export function f() { return Object.getOwnPropertyNames(new N("x")).join(","); }`))
      .toBe("stack,message,f");
    expect(v(`export class M extends Error {} export function f() { return Object.getOwnPropertyDescriptor(new M("x"), "message").enumerable; }`))
      .toBe(false);
  });
});
