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
    expect(litValue(call(`export function f() { return String.fromCharCode(65, 66); }`).result)).toBe("AB");
    expect(litValue(call(`export function f() { return String.fromCharCode(72, 105); }`).result)).toBe("Hi");
    expect(litValue(call(`export function f() { return String.fromCharCode(); }`).result)).toBe("");
  });

  it("applies ToUint16 to out-of-range / fractional / string codes", () => {
    expect(litValue(call(`export function f() { return String.fromCharCode(0x1F600); }`).result)).toBe("\uF600");
    expect(litValue(call(`export function f() { return String.fromCharCode(0xffffffff); }`).result)).toBe("\uFFFF");
    expect(litValue(call(`export function f() { return String.fromCharCode(2.5); }`).result)).toBe("\u0002");
    expect(litValue(call(`export function f() { return String.fromCharCode(-1); }`).result)).toBe("\uFFFF");
    expect(litValue(call(`export function f() { return String.fromCharCode(NaN); }`).result)).toBe("\u0000");
    expect(litValue(call(`export function f() { return String.fromCharCode('65'); }`).result)).toBe("A");
    expect(litValue(call(`export function f() { return String.fromCharCode(0x20BB7); }`).result)).toBe("\u0BB7");
  });

  it("abstract args widen to abstract string", () => {
    const r = call(`export function f(n) { return String.fromCharCode(n); }`);
    expect(litValue(r.result)).toBeUndefined();
    const r2 = call(`export function f(n) { return String.fromCharCode(65, n); }`);
    expect(litValue(r2.result)).toBeUndefined();
  });

  it("symbol code throws TypeError", () => {
    const r = call(`export function f() { try { return String.fromCharCode(Symbol()); } catch(e) { return 'THROW'; } }`);
    expect(litValue(r.result)).toBe("THROW");
  });
});

describe("B. Object.prototype.hasOwnProperty", () => {
  it("decides own slots on plain objects", () => {
    expect(litValue(call(`export function f() { return ({a:1}).hasOwnProperty('a'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return ({a:1}).hasOwnProperty('b'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return ({}).hasOwnProperty('toString'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return ({}).hasOwnProperty('a'); }`).result)).toBe(false);
  });

  it("decides array indices / length / holes", () => {
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty(0); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty(2); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return [1,2].hasOwnProperty('length'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return [1,,3].hasOwnProperty(1); }`).result)).toBe(false);
  });

  it("decides string boxing length / indices", () => {
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty(0); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty('length'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return 'abc'.hasOwnProperty('x'); }`).result)).toBe(false);
  });

  it("Object.prototype.hasOwnProperty.call has same semantics", () => {
    expect(
      litValue(call(`export function f() { return Object.prototype.hasOwnProperty.call({a: 1}, 'a'); }`).result),
    ).toBe(true);
    expect(
      litValue(call(`export function f() { return Object.prototype.hasOwnProperty.call({a: 1}, 'b'); }`).result),
    ).toBe(false);
  });

  it("null-proto has no Object.prototype methods (TypeError)", () => {
    for (const m of ["hasOwnProperty('x')", "isPrototypeOf({})", "propertyIsEnumerable('x')", "valueOf()", "toString()"]) {
      const src = `export function f() { try { Object.create(null).${m}; } catch(e) { return 'caught'; } return 'missed'; }`;
      expect(litValue(call(src).result), m).toBe("caught");
    }
    const r = call(`export function f() { return Object.create(null).hasOwnProperty('x'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("delete removes own slot", () => {
    expect(
      litValue(call(`export function f() { const o={a:1}; delete o.a; return o.hasOwnProperty('a'); }`).result),
    ).toBe(false);
  });
});

describe("B. Object.prototype.propertyIsEnumerable / isPrototypeOf / valueOf / toString", () => {
  it("propertyIsEnumerable respects length non-enumerability", () => {
    expect(litValue(call(`export function f() { return ({a:1}).propertyIsEnumerable('a'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return ({a:1}).propertyIsEnumerable('b'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return [1,2].propertyIsEnumerable(0); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return [1,2].propertyIsEnumerable('length'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return 'abc'.propertyIsEnumerable('length'); }`).result)).toBe(false);
  });

  it("isPrototypeOf: Object.prototype vs plain object / null-proto", () => {
    expect(litValue(call(`export function f() { return Object.prototype.isPrototypeOf({}); }`).result)).toBe(true);
    expect(
      litValue(call(`export function f() { return Object.prototype.isPrototypeOf(Object.create(null)); }`).result),
    ).toBe(false);
    expect(litValue(call(`export function f() { return Object.prototype.isPrototypeOf(5); }`).result)).toBe(false);
  });

  it("toString folds type tags", () => {
    expect(litValue(call(`export function f() { return ({}).toString(); }`).result)).toBe("[object Object]");
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call([1,2]); }`).result),
    ).toBe("[object Array]");
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call('x'); }`).result),
    ).toBe("[object String]");
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call(null); }`).result),
    ).toBe("[object Null]");
    expect(
      litValue(call(`export function f() { return Object.prototype.toString.call(undefined); }`).result),
    ).toBe("[object Undefined]");
    expect(
      litValue(call(`export function f() { return {}.toString.call(5); }`).result),
    ).toBe("[object Number]");
  });

  it("valueOf returns the object; prim boxes widen", () => {
    const r = call(`export function f() { const o = {a:1}; return o.valueOf() === o; }`);
    expect(litValue(r.result)).toBe(true);
    expect(litValue(call(`export function f() { return (5).valueOf(); }`).result)).toBe(5);
    expect(litValue(call(`export function f() { return true.valueOf(); }`).result)).toBe(true);
  });

  it("array toString joins elements", () => {
    expect(litValue(call(`export function f() { return [1,2].toString(); }`).result)).toBe("1,2");
    expect(litValue(call(`export function f() { return [1,,3].toString(); }`).result)).toBe("1,,3");
  });

  it("boolean toString folds", () => {
    expect(litValue(call(`export function f() { return true.toString(); }`).result)).toBe("true");
    expect(litValue(call(`export function f() { return false.toString(); }`).result)).toBe("false");
  });
});

describe("C. Symbol()", () => {
  it("typeof is symbol; description is literal or undefined", () => {
    expect(litValue(call(`export function f() { return typeof Symbol(); }`).result)).toBe("symbol");
    expect(litValue(call(`export function f() { return typeof Symbol('x'); }`).result)).toBe("symbol");
    expect(litValue(call(`export function f() { return Symbol('x').description; }`).result)).toBe("x");
    expect(litValue(call(`export function f() { return Symbol().description; }`).result)).toBe(undefined);
    expect(litValue(call(`export function f() { return Symbol('').description; }`).result)).toBe("");
    expect(litValue(call(`export function f() { return Symbol(5).description; }`).result)).toBe("5");
  });

  it("unique identity: two Symbol() are not ===; same ref is ===", () => {
    expect(litValue(call(`export function f() { return Symbol('a') === Symbol('a'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return Symbol() === Symbol(); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { const s = Symbol(); return s === s; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { const s = Symbol('k'); const t = s; return s === t; }`).result)).toBe(true);
  });

  it("String(sym) yields SymbolDescriptiveString; implicit ToString throws", () => {
    expect(litValue(call(`export function f() { return String(Symbol('x')); }`).result)).toBe("Symbol(x)");
    expect(litValue(call(`export function f() { return String(Symbol()); }`).result)).toBe("Symbol()");
    expect(litValue(call(`export function f() { try { return '' + Symbol(); } catch(e) { return 'THROW'; } }`).result)).toBe("THROW");
    expect(litValue(call("export function f() { try { return `a${Symbol()}b`; } catch(e) { return 'THROW'; } }").result)).toBe("THROW");
  });

  it("Number(sym) and new Symbol throw TypeError", () => {
    expect(litValue(call(`export function f() { try { return Number(Symbol()); } catch(e) { return 'THROW'; } }`).result)).toBe("THROW");
    expect(litValue(call(`export function f() { try { return new Symbol(); } catch(e) { return 'THROW'; } }`).result)).toBe("THROW");
  });

  it("symbol toString is descriptive string", () => {
    expect(litValue(call(`export function f() { return Symbol('a').toString(); }`).result)).toBe("Symbol(a)");
    expect(litValue(call(`export function f() { return Symbol().toString(); }`).result)).toBe("Symbol()");
  });
});
