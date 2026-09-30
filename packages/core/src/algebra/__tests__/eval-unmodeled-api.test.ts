/**
 * 未建模 API 小清单偿还：String.fromCharCode / Object.prototype 方法 / Symbol()。
 * A. fromCharCode：字面量码点 ToUint16 折叠；抽象实参 → 抽象 string。
 * B. hasOwnProperty / isPrototypeOf / propertyIsEnumerable / valueOf / toString：
 *    具体形状/元组/数组/字符串装箱按自有槽/下标/length/holes 判定；
 *    Object.prototype.hasOwnProperty.call 同语义；null-proto 无这些方法（TypeError）。
 * C. Symbol()：非具体 unique symbol（=== 两枚为 false、同引用为 true）；
 *    .description 字面量或 undefined；typeof "symbol"；隐式 ToString TypeError。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

describe("A. String.fromCharCode", () => {
  it("folds literal code points", () => {
    expect(litValue(call(`export function f() { return String.fromCharCode(65, 66); }`).result)).toEqual({ ok: true, value: "AB" });
    expect(litValue(call(`export function f() { return String.fromCharCode(72, 105); }`).result)).toEqual({ ok: true, value: "Hi" });
    expect(litValue(call(`export function f() { return String.fromCharCode(); }`).result)).toEqual({ ok: true, value: "" });
  });

  it("applies ToUint16 to out-of-range / fractional / string codes", () => {
    expect(litValue(call(`export function f() { return String.fromCharCode(0x1F600); }`).result)).toEqual({ ok: true, value: "\uF600" });
    expect(litValue(call(`export function f() { return String.fromCharCode(0xffffffff); }`).result)).toEqual({ ok: true, value: "\uFFFF" });
    expect(litValue(call(`export function f() { return String.fromCharCode(2.5); }`).result)).toEqual({ ok: true, value: "\u0002" });
    expect(litValue(call(`export function f() { return String.fromCharCode(-1); }`).result)).toEqual({ ok: true, value: "\uFFFF" });
    expect(litValue(call(`export function f() { return String.fromCharCode(NaN); }`).result)).toEqual({ ok: true, value: "\u0000" });
    expect(litValue(call(`export function f() { return String.fromCharCode('65'); }`).result)).toEqual({ ok: true, value: "A" });
    expect(litValue(call(`export function f() { return String.fromCharCode(0x20BB7); }`).result)).toEqual({ ok: true, value: "\u0BB7" });
  });

  it("abstract args widen to abstract string", () => {
    const r = call(`export function f(n) { return String.fromCharCode(n); }`);
    expect(litValue(r.result)).toEqual({ ok: false });
    const r2 = call(`export function f(n) { return String.fromCharCode(65, n); }`);
    expect(litValue(r2.result)).toEqual({ ok: false });
  });

  it("symbol code throws TypeError", () => {
    const r = call(`export function f() { try { return String.fromCharCode(Symbol()); } catch(e) { return 'THROW'; } }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "THROW" });
  });
});

describe("B. Object.prototype.hasOwnProperty", () => {
  it("decides own slots on plain objects", () => {
    expect(litValue(call(`export function f() { return ({a:1}).hasOwnProperty('a'); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return ({a:1}).hasOwnProperty('b'); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return ({}).hasOwnProperty('toString'); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return ({}).hasOwnProperty('a'); }`).result)).toEqual({ ok: true, value: false });
  });

  it("decides array indices / length / holes", () => {
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty(0); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty(2); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty('length'); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return [1,,3].hasOwnProperty(1); }`).result)).toEqual({ ok: true, value: false });
  });

  it("decides string boxing length / indices", () => {
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty(0); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty('length'); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty('x'); }`).result)).toEqual({ ok: true, value: false });
  });

  it("Object.prototype.hasOwnProperty.call has same semantics", () => {
    expect(
      litValue(call(`export function f() { return Object.prototype.hasOwnProperty.call({a: 1}, 'a'); }`).result),
    ).toEqual({ ok: true, value: true });
    expect(
      litValue(call(`export function f() { return Object.prototype.hasOwnProperty.call({a: 1}, 'b'); }`).result),
    ).toEqual({ ok: true, value: false });
  });

  it("null-proto has no Object.prototype methods (TypeError)", () => {
    for (const m of ["hasOwnProperty('x')", "isPrototypeOf({})", "propertyIsEnumerable('x')", "valueOf()", "toString()"]) {
      const src = `export function f() { try { Object.create(null).${m}; } catch(e) { return 'caught'; } return 'missed'; }`;
      expect(litValue(call(src).result), m).toEqual({ ok: true, value: "caught" });
    }
    const r = call(`export function f() { return Object.create(null).hasOwnProperty('x'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("delete removes own slot", () => {
    expect(
      litValue(call(`export function f() { const o={a:1}; delete o.a; return o.hasOwnProperty('a'); }`).result),
    ).toEqual({ ok: true, value: false });
  });
});

describe("B. Object.prototype.propertyIsEnumerable / isPrototypeOf / valueOf / toString", () => {
  it("propertyIsEnumerable respects length non-enumerability", () => {
    expect(litValue(call(`export function f() { return ({a:1}).propertyIsEnumerable('a'); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return ({a:1}).propertyIsEnumerable('b'); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return [1,2].propertyIsEnumerable(0); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return [1,2].propertyIsEnumerable('length'); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return 'abc'.propertyIsEnumerable('length'); }`).result)).toEqual({ ok: true, value: false });
  });

  it("isPrototypeOf: Object.prototype vs plain object / null-proto", () => {
    expect(litValue(call(`export function f() { return Object.prototype.isPrototypeOf({}); }`).result)).toEqual({ ok: true, value: true });
    expect(
      litValue(call(`export function f() { return Object.prototype.isPrototypeOf(Object.create(null)); }`).result),
    ).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return Object.prototype.isPrototypeOf(5); }`).result)).toEqual({ ok: true, value: false });
  });

  it("toString folds type tags", () => {
    expect(litValue(call(`export function f() { return ({}).toString(); }`).result)).toEqual({ ok: true, value: "[object Object]" });
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call([1,2]); }`).result),
    ).toEqual({ ok: true, value: "[object Array]" });
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call('x'); }`).result),
    ).toEqual({ ok: true, value: "[object String]" });
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call(null); }`).result),
    ).toEqual({ ok: true, value: "[object Null]" });
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call(undefined); }`).result),
    ).toEqual({ ok: true, value: "[object Undefined]" });
    expect(
      litValue(call(`export function f() { return {}.toString.call(5); }`).result),
    ).toEqual({ ok: true, value: "[object Number]" });
  });

  it("valueOf returns the object; prim boxes widen", () => {
    const r = call(`export function f() { const o = {a:1}; return o.valueOf() === o; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return (5).valueOf(); }`).result)).toEqual({ ok: true, value: 5 });
    expect(litValue(call(`export function f() { return true.valueOf(); }`).result)).toEqual({ ok: true, value: true });
  });

  it("array toString joins elements", () => {
    expect(litValue(call(`export function f() { return [1,2].toString(); }`).result)).toEqual({ ok: true, value: "1,2" });
    expect(litValue(call(`export function f() { return [1,,3].toString(); }`).result)).toEqual({ ok: true, value: "1,,3" });
  });

  it("boolean toString folds", () => {
    expect(litValue(call(`export function f() { return true.toString(); }`).result)).toEqual({ ok: true, value: "true" });
    expect(litValue(call(`export function f() { return false.toString(); }`).result)).toEqual({ ok: true, value: "false" });
  });
});

describe("C. Symbol()", () => {
  it("typeof is symbol; description is literal or undefined", () => {
    expect(litValue(call(`export function f() { return typeof Symbol(); }`).result)).toEqual({ ok: true, value: "symbol" });
    expect(litValue(call(`export function f() { return typeof Symbol('x'); }`).result)).toEqual({ ok: true, value: "symbol" });
    expect(litValue(call(`export function f() { return Symbol('x').description; }`).result)).toEqual({ ok: true, value: "x" });
    expect(litValue(call(`export function f() { return Symbol().description; }`).result)).toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return Symbol('').description; }`).result)).toEqual({ ok: true, value: "" });
    expect(litValue(call(`export function f() { return Symbol(5).description; }`).result)).toEqual({ ok: true, value: "5" });
  });

  it("unique identity: two Symbol() are not ===; same ref is ===", () => {
    expect(litValue(call(`export function f() { return Symbol('a') === Symbol('a'); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return Symbol() === Symbol(); }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { const s = Symbol(); return s === s; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { const s = Symbol('k'); const t = s; return s === t; }`).result)).toEqual({ ok: true, value: true });
  });

  it("String(sym) yields SymbolDescriptiveString; implicit ToString throws", () => {
    expect(litValue(call(`export function f() { return String(Symbol('x')); }`).result)).toEqual({ ok: true, value: "Symbol(x)" });
    expect(litValue(call(`export function f() { return String(Symbol()); }`).result)).toEqual({ ok: true, value: "Symbol()" });
    expect(litValue(call(`export function f() { try { return '' + Symbol(); } catch(e) { return 'THROW'; } }`).result)).toEqual({ ok: true, value: "THROW" });
    expect(litValue(call("export function f() { try { return `a${Symbol()}b`; } catch(e) { return 'THROW'; } }").result)).toEqual({ ok: true, value: "THROW" });
  });

  it("Number(sym) and new Symbol throw TypeError", () => {
    expect(litValue(call(`export function f() { try { return Number(Symbol()); } catch(e) { return 'THROW'; } }`).result)).toEqual({ ok: true, value: "THROW" });
    expect(litValue(call(`export function f() { try { return new Symbol(); } catch(e) { return 'THROW'; } }`).result)).toEqual({ ok: true, value: "THROW" });
  });

  it("symbol toString is descriptive string", () => {
    expect(litValue(call(`export function f() { return Symbol('a').toString(); }`).result)).toEqual({ ok: true, value: "Symbol(a)" });
    expect(litValue(call(`export function f() { return Symbol().toString(); }`).result)).toEqual({ ok: true, value: "Symbol()" });
  });
});
