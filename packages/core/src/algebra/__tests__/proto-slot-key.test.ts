/**
 * `__proto__` 键写入不得踩宿主 Object.prototype setter。
 *
 * 回归背景：slots 是普通 JS 对象，`slots[k] = v` 在 k==="__proto__" 时
 * 触发 [[SetPrototypeOf]]，键静默丢失（历史 bug 模式，objects.ts getSlot
 * 只修了读侧）。同族漏网点：
 *   JSON.parse('{"__proto__":1}')  keys=[] / o.__proto__=undefined（原生有键）
 *   { __proto__: {x:1} }           原生设原型，引擎空对象 + o.x 折 undefined #exact
 *   { __proto__: null }            原生 null-proto，引擎仍回落 Object.prototype
 *   o.__proto__ = {x:1}            原生设原型，引擎键丢失
 *   Object.create(null); o.__proto__=1  原生自有键，引擎丢键
 *
 * ES 三分：
 * - 对象字面量非计算 `__proto__: v` → 特殊原型设定（v 为 object/null）；
 *   原始值忽略、不建自有键
 * - 对象字面量计算 `{['__proto__']: v}` / JSON.parse / defineProperty → 自有数据属性
 * - `o.__proto__ = v` / `o[k] = v`（k 为 "__proto__"）→ 走 setter（设原型）；
 *   null-proto 目标无 setter → 自有数据属性
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

function fmt(src: string) {
  return formatAbs(call(src).result);
}

/** 真·exact undefined 字面量（litValue 对 unknown 也是 undefined，不能单用它） */
function isExactUndefined(r: unknown): boolean {
  const a = r as { term?: { op: string; value: unknown }; conf?: string };
  return a?.term?.op === "lit" && a.term.value === undefined && a.conf === "exact";
}

describe("JSON.parse __proto__ is an own data property", () => {
  it("keys and reads survive (no proto-pollution, no key loss)", () => {
    expect(val(`export function f() { return Object.keys(JSON.parse('{"__proto__":1}')).length; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const o=JSON.parse('{"__proto__":1}'); return o['__proto__']; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const o=JSON.parse('{"a":1,"__proto__":2}'); return Object.keys(o).length; }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { const o=JSON.parse('{"a":1,"__proto__":2}'); return o['__proto__']; }`)).toEqual({ ok: true, value: 2 });
    // 仍是自有数据属性，不污染原型
    expect(val(`export function f() { const o = JSON.parse('{"__proto__":{"p":1}}'); return o.p === undefined && "toString" in o; }`)).toEqual({ ok: true, value: true });
  });
});

describe("object literal non-computed __proto__ is the prototype special form", () => {
  it("__proto__: obj sets prototype — inherited reads must not fold undefined", () => {
    // 原生 o.x === 1；引擎曾折 undefined #exact（假精确）
    const r = call(`export function f() { const o={__proto__:{x:1}}; return o.x; }`);
    expect(isExactUndefined(r.result)).toBe(false);
    expect(fmt(`export function f() { const o={__proto__:{x:1}}; return o.x; }`)).not.toContain("#exact");
  });

  it("'x' in o is true for inherited x", () => {
    const r = call(`export function f() { const o={__proto__:{x:1}}; return 'x' in o; }`);
    expect(litValue(r.result)).not.toEqual({ ok: true, value: false });
  });

  it("__proto__: null is null-proto (no Object.prototype toString)", () => {
    const r = call(`export function f() { const o={__proto__:null}; return o.toString; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    expect(
      val(`export function f() { const o={__proto__:null}; return 'toString' in o; }`),
    ).toEqual({ ok: true, value: false });
  });

  it("__proto__: primitive is ignored (no own key, no proto change)", () => {
    // 原生 Object.keys({__proto__:1}) === [] 且 o 仍是普通对象
    expect(val(`export function f() { return Object.keys({__proto__:1}).length; }`)).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { const o={__proto__:1}; return 'toString' in o; }`)).toEqual({ ok: true, value: true });
  });

  it("other own keys still land alongside the proto special form", () => {
    expect(val(`export function f() { const o={__proto__:{x:1}, y:2}; return o.y; }`)).toEqual({ ok: true, value: 2 });
  });
});

describe("computed / assignment __proto__ keeps an own property on null-proto", () => {
  it("Object.create(null); o['__proto__']=1 stores an own key", () => {
    expect(
      val(`export function f() { const o=Object.create(null); o['__proto__']=1; return o['__proto__']; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o=Object.create(null); o['__proto__']=1; return Object.keys(o).length; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("object literal computed {['__proto__']: v} is an own property", () => {
    expect(
      val(`export function f() { const o={['__proto__']:1}; return o['__proto__']; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { return Object.keys({['__proto__']:1}).length; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("o.__proto__ = obj on a normal object sets the prototype", () => {
  it("inherited read after assignment is not exact undefined", () => {
    const r = call(`export function f() { const o={}; o.__proto__={x:1}; return o.x; }`);
    expect(isExactUndefined(r.result)).toBe(false);
    expect(fmt(`export function f() { const o={}; o.__proto__={x:1}; return o.x; }`)).not.toContain("#exact");
  });

  it("Object.setPrototypeOf similarly stops folding exact undefined", () => {
    const r = call(`export function f() { const o={}; Object.setPrototypeOf(o,{x:1}); return o.x; }`);
    expect(isExactUndefined(r.result)).toBe(false);
  });
});

describe("method named __proto__ is an own data property", () => {
  it("{ __proto__() {} } keeps an own key (MethodDefinition is not the special form)", () => {
    expect(
      val(`export function f() { return Object.keys({ __proto__() { return 1; } }).length; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o={ __proto__() { return 1; } }; return typeof o['__proto__']; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("{ get __proto__() {} } keeps an own accessor key", () => {
    expect(
      val(`export function f() { return Object.keys({ get __proto__() { return 1; } }).length; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("spread / assign copies a __proto__ own key without hitting the setter", () => {
  it("{...JSON.parse('{\"__proto__\":1}')} keeps the key", () => {
    expect(
      val(`export function f() { return Object.keys({ ...JSON.parse('{"__proto__":1}') }).length; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o={ ...JSON.parse('{"__proto__":1}') }; return o['__proto__']; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("Object.assign({}, JSON.parse('{\"__proto__\":1}')) keeps the key", () => {
    expect(
      val(`export function f() { return Object.keys(Object.assign({}, JSON.parse('{"__proto__":1}'))).length; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Object.setPrototypeOf arity", () => {
  it("missing proto argument throws TypeError", () => {
    const r = call(`export function f() { return Object.setPrototypeOf({}); }`);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("zero arguments throw TypeError", () => {
    const r = call(`export function f() { return Object.setPrototypeOf(); }`);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("explicit undefined proto throws TypeError", () => {
    const r = call(`export function f() { return Object.setPrototypeOf({}, undefined); }`);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });
});
