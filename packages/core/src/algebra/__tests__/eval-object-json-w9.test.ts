/**
 * wave 9 回归：Object 静态 / JSON 族的 throws 域 + 值域（bug-report
 * Bug 27/33/35/39/40/44/46/48/61/76）。
 *
 * 不变量：原生异常不得折成 result=…, throws=never；node v26 为准（与
 * bug 文本冲突处以 node 实测为准）：
 * - Bug 27 setPrototypeOf：nullish target 定抛；prim **target 原生合法**
 *   （Type(O) 非 Object → 返回原值，node 实测 (1,{}) → 1）；prim proto
 *   （含 symbol prim，无 lit 项）定抛；any target/proto → may。
 * - Bug 33 create：prim proto（symbol prim / 抽象 prim）定抛；any → may。
 * - Bug 35 getOwnPropertyNames/Symbols/Descriptor 建模：nullish 接收者
 *   定抛；obj/tuple/string 投影自有字符串键（含 length/不可枚举）；
 *   any → may + 保守值。
 * - Bug 39 defineProperty：非对象描述符（缺省/nullish/prim）定抛；
 *   any → may；[] 等对象描述符合法。
 * - Bug 40 JSON.parse：symbol prim 定抛（ToString）；any 文本 → may。
 * - Bug 44 fromEntries：非可迭代接收者/非对象条目（含字符串条目与
 *   hole）定抛；[k,v] 元组投影；symbol 键保留（node：不 ToString）。
 * - Bug 46 JSON.stringify：any/抽象接收者 may（BigInt/循环/toJSON）；
 *   symbol/fn 成员原生**省略不抛**（{a:Symbol()} → "{}"、[Symbol()] →
 *   "[null]" 折叠）；bigint prim 任何位置定抛。
 * - Bug 48 JSON.parse reviver：node 实测**非 callable reviver 原生忽略**
 *   （parse("{}",1) → {}，无 TypeError）——bug 文本校正；callable reviver
 *   值域保守 unknown；解析失败 SyntaxError 先于 reviver。
 * - Bug 61 keys/values/entries：缺省/nullish 定抛；any → may。
 * - Bug 76 assign/getPrototypeOf：symbol prim 接收者定抛（V8 ToObject
 *   特例）；number/string/boolean/bigint 装箱合法。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

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

function tupleEls(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const els = a.shape.elements!.map((e) => {
    const rr = litValue(e as never);
    return rr.ok ? rr.value : undefined;
  });
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

function objSlots(r: unknown): Record<string, unknown> | undefined {
  const a = r as { shape?: { k?: string; slots?: Record<string, { value: unknown }> } };
  if (!a || typeof a !== "object" || a.shape?.k !== "obj") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(a.shape.slots ?? {})) {
    const rr = litValue(s.value as never);
    out[k] = rr.ok ? rr.value : undefined;
  }
  return out;
}

/** 源级求值（带 any 实参）：{ value, throws, effects } 三面 */
function evalSrc(
  src: string,
  fnName = "f",
): { value: unknown; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, [anyAbs] as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    value: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

// --- Bug 27：Object.setPrototypeOf ------------------------------------------

describe("Bug 27: Object.setPrototypeOf target/proto validation", () => {
  it("nullish target throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.setPrototypeOf(null, {}); }`,
      `export function f() { return Object.setPrototypeOf(undefined, {}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("symbol-prim / abstract-prim proto throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.setPrototypeOf({}, Symbol()); }`,
      `export function f() { return Object.setPrototypeOf({}, undefined); }`,
      `export function f() { return Object.setPrototypeOf({}, 1); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract target records may TypeError (value unchanged)", () => {
    const r = evalSrc(`export function f(x) { return Object.setPrototypeOf(x, {}); }`);
    expect(r.effects).toContain("TypeError");
    expect(isNever(r.value)).toBe(false);
  });

  it("controls: ({}, null) folds; prim target legal (returns receiver)", () => {
    const c1 = call(`export function f() { return Object.setPrototypeOf({}, null); }`);
    expect(isNever(c1.result)).toBe(false);
    expect(isNever(c1.throws)).toBe(true);
    const c2 = call(`export function f() { return Object.setPrototypeOf(1, {}); }`);
    expect(litValue(c2.result)).toEqual({ ok: true, value: 1 });
    expect(isNever(c2.throws)).toBe(true);
  });

  it("caught by try/catch", () => {
    expect(
      litValue(call(`export function f() { try { Object.setPrototypeOf(null, {}); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
  });
});

// --- Bug 33：Object.create ---------------------------------------------------

describe("Bug 33: Object.create proto validation", () => {
  it("symbol-prim proto throws TypeError", () => {
    const r = call(`export function f() { return Object.create(Symbol()); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("abstract proto records may TypeError", () => {
    const r = evalSrc(`export function f(x) { return Object.create(x); }`);
    expect(r.effects).toContain("TypeError");
  });

  it("controls: prim-lit throws, null folds nullProto", () => {
    const c1 = call(`export function f() { return Object.create(1); }`);
    expect(isNever(c1.result)).toBe(true);
    const c2 = call(`export function f() { return Object.create(null); }`);
    expect(isNever(c2.result)).toBe(false);
    expect(isNever(c2.throws)).toBe(true);
    expect(objSlots(c2.result)).toEqual({});
  });
});

// --- Bug 35：getOwnPropertyNames / Symbols / Descriptor ----------------------

describe("Bug 35: Object.getOwnPropertyNames/Symbols/Descriptor", () => {
  it("nullish receiver throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.getOwnPropertyNames(null); }`,
      `export function f() { return Object.getOwnPropertySymbols(null); }`,
      `export function f() { return Object.getOwnPropertyDescriptor(null, "a"); }`,
      `export function f() { return Object.getOwnPropertyNames(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract receiver records may TypeError", () => {
    const r = evalSrc(`export function f(x) { return Object.getOwnPropertyNames(x); }`);
    expect(r.effects).toContain("TypeError");
    expect((r.value as { shape?: { k?: string; element?: unknown } }).shape?.k).toBe("arr");
  });

  it("getOwnPropertyNames folds string keys (incl. length / non-enumerable)", () => {
    expect(tupleEls(call(`export function f() { return Object.getOwnPropertyNames({a:1}); }`).result)).toEqual(["a"]);
    expect(tupleEls(call(`export function f() { return Object.getOwnPropertyNames([,1]); }`).result)).toEqual(["1", "length"]);
    expect(tupleEls(call(`export function f() { return Object.getOwnPropertyNames("ab"); }`).result)).toEqual(["0", "1", "length"]);
    expect(tupleEls(call(`export function f() { return Object.getOwnPropertyNames(1); }`).result)).toEqual([]);
    expect(tupleEls(call(`export function f() { return Object.getOwnPropertyNames(Symbol()); }`).result)).toEqual([]);
  });

  it("getOwnPropertyNames includes defineProperty non-enumerable keys", () => {
    expect(
      tupleEls(
        call(`export function f() { const o = {a:1}; Object.defineProperty(o, "b", {value: 2, enumerable: false}); return Object.getOwnPropertyNames(o); }`).result,
      ),
    ).toEqual(["a", "b"]);
  });

  it("getOwnPropertySymbols returns conservative symbol[]", () => {
    const r = call(`export function f() { return Object.getOwnPropertySymbols({a:1}); }`).result as {
      shape?: { k?: string; element?: { shape?: { k?: string; type?: string } } };
    };
    expect(r.shape?.k).toBe("arr");
    expect(r.shape?.element?.shape?.type).toBe("symbol");
  });

  it("getOwnPropertyDescriptor folds data descriptors", () => {
    const d = objSlots(call(`export function f() { return Object.getOwnPropertyDescriptor({a:1}, "a"); }`).result);
    expect(d).toMatchObject({ value: 1, writable: true, enumerable: true, configurable: true });
    const miss = call(`export function f() { return Object.getOwnPropertyDescriptor({a:1}, "b"); }`).result;
    expect(litValue(miss)).toEqual({ ok: true, value: undefined });
    const len = objSlots(call(`export function f() { return Object.getOwnPropertyDescriptor([1], "length"); }`).result);
    expect(len).toMatchObject({ value: 1, writable: true, enumerable: false, configurable: false });
  });
});

// --- Bug 39：Object.defineProperty 描述符校验 ---------------------------------

describe("Bug 39: Object.defineProperty descriptor validation", () => {
  it("non-object descriptor throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.defineProperty({}, "a", 1); }`,
      `export function f() { return Object.defineProperty({}, "a", "s"); }`,
      `export function f() { return Object.defineProperty({}, "a", null); }`,
      `export function f() { return Object.defineProperty({}, "a"); }`,
      `export function f() { return Object.defineProperty({}, "a", Symbol()); }`,
      `export function f() { return Object.defineProperty(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract descriptor records may TypeError", () => {
    const r = evalSrc(`export function f(x, y) { return Object.defineProperty(x, "a", y); }`);
    expect(r.effects).toContain("TypeError");
  });

  it("controls: obj descriptor folds; array descriptor legal (object)", () => {
    const c1 = call(`export function f() { return Object.defineProperty({}, "a", {value: 1}); }`);
    expect(isNever(c1.result)).toBe(false);
    expect(objSlots(c1.result)).toEqual({ a: 1 });
    const c2 = call(`export function f() { return Object.defineProperty({}, "a", []); }`);
    expect(isNever(c2.result)).toBe(false);
    expect(isNever(c2.throws)).toBe(true);
  });

  it("caught by try/catch", () => {
    expect(
      litValue(call(`export function f() { try { Object.defineProperty({}, "a", 1); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
  });
});

// --- Bug 40 / 48：JSON.parse -------------------------------------------------

describe("Bug 40: JSON.parse symbol ToString", () => {
  it("symbol-prim arg throws TypeError", () => {
    const r = call(`export function f() { return JSON.parse(Symbol()); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("abstract arg records may TypeError, value unknown", () => {
    const r = evalSrc(`export function f(x) { return JSON.parse(x); }`);
    expect(r.effects).toContain("TypeError");
    expect((r.value as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });

  it("controls unchanged: parse('') SyntaxError, parse('1') folds", () => {
    const c1 = call(`export function f() { return JSON.parse(""); }`);
    expect(throwsError(c1.throws, "SyntaxError")).toBe(true);
    expect(litValue(call(`export function f() { return JSON.parse("1"); }`).result)).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 48: JSON.parse reviver (node-corrected: non-callable ignored)", () => {
  it("non-callable / nullish reviver ignored — folds parsed value, no throw", () => {
    for (const src of [
      `export function f() { return JSON.parse("{}", 1); }`,
      `export function f() { return JSON.parse("{}", null); }`,
      `export function f() { return JSON.parse('{"a":1}', "s"); }`,
      `export function f() { return JSON.parse("[1,2]", []); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(false);
      expect(isNever(r.throws), src).toBe(true);
    }
    expect(objSlots(call(`export function f() { return JSON.parse("{}", 1); }`).result)).toEqual({});
    expect(objSlots(call(`export function f() { return JSON.parse('{"a":1}', null); }`).result)).toEqual({ a: 1 });
  });

  it("callable reviver degrades to unknown (per-key transform unmodeled)", () => {
    const r = call(`export function f() { return JSON.parse("{}", function (k, v) { return v; }); }`);
    expect(isNever(r.result)).toBe(false);
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });

  it("abstract reviver: unknown value, no shape-throw effect", () => {
    const r = evalSrc(`export function f(x) { return JSON.parse("{}", x); }`);
    expect((r.value as { shape?: { k?: string } }).shape?.k).toBe("unknown");
    expect(r.effects).not.toContain("TypeError");
  });

  it("parse failure (SyntaxError) precedes reviver handling", () => {
    const r = call(`export function f() { return JSON.parse("{", 1); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });
});

// --- Bug 46：JSON.stringify ---------------------------------------------------

describe("Bug 46: JSON.stringify abstract may-throw + symbol/fn omission", () => {
  it("abstract receiver records may TypeError, stays string partial", () => {
    for (const src of [
      `export function f(x) { return JSON.stringify(x); }`,
      `export function f(x) { return JSON.stringify({ a: x }); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.effects, src).toContain("TypeError");
      expect((r.value as { shape?: { k?: string; type?: string } }).shape?.type).toBe("string");
    }
  });

  it("symbol/fn members are omitted natively — folds exact, no throw", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({ a: Symbol() }); }`).result)).toEqual({ ok: true, value: "{}" });
    expect(litValue(call(`export function f() { return JSON.stringify([Symbol()]); }`).result)).toEqual({ ok: true, value: "[null]" });
    expect(litValue(call(`export function f() { return JSON.stringify({ a: () => 1 }); }`).result)).toEqual({ ok: true, value: "{}" });
    const c = call(`export function f() { return JSON.stringify({ a: Symbol() }); }`);
    expect(isNever(c.throws)).toBe(true);
  });

  it("abstract bigint prim receiver throws TypeError (definite)", () => {
    // v*1n（any × bigint）→ bigint prim（无 lit）→ stringify 定抛
    //（与字面量 1n 的宿主抛同面；控制组见下一测试）
    const rr = evalSrc(`export function f(v) { return JSON.stringify(v * 1n); }`);
    expect(isNever(rr.value)).toBe(true);
    expect(throwsError(rr.throws, "TypeError")).toBe(true);
  });

  it("controls: literal bigint throws, plain object folds exact", () => {
    const c1 = call(`export function f() { return JSON.stringify(1n); }`);
    expect(throwsError(c1.throws, "TypeError")).toBe(true);
    expect(litValue(call(`export function f() { return JSON.stringify({ a: 1 }); }`).result)).toEqual({ ok: true, value: '{"a":1}' });
  });
});

// --- Bug 61：Object.keys/values/entries 抽象臂 ---------------------------------

describe("Bug 61: Object.keys/values/entries abstract receiver may-throw", () => {
  it("abstract receiver records may TypeError, partial value unchanged", () => {
    const k = evalSrc(`export function f(x) { return Object.keys(x); }`);
    expect(k.effects).toContain("TypeError");
    expect((k.value as { shape?: { k?: string } }).shape?.k).toBe("arr");
    const v = evalSrc(`export function f(x) { return Object.values(x); }`);
    expect(v.effects).toContain("TypeError");
    const e = evalSrc(`export function f(x) { return Object.entries(x); }`);
    expect(e.effects).toContain("TypeError");
  });

  it("absent receiver throws TypeError (undefined not iterable→ToObject)", () => {
    for (const src of [
      `export function f() { return Object.keys(); }`,
      `export function f() { return Object.values(); }`,
      `export function f() { return Object.entries(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("controls: literal nullish still throws; concrete folds exact", () => {
    expect(throwsError(call(`export function f() { return Object.keys(null); }`).throws, "TypeError")).toBe(true);
    expect(tupleEls(call(`export function f() { return Object.keys({a:1}); }`).result)).toEqual(["a"]);
  });
});

// --- Bug 76：assign / getPrototypeOf symbol 接收者 ------------------------------

describe("Bug 76: Object.assign/getPrototypeOf symbol-prim receiver", () => {
  it("symbol-prim assign target throws TypeError (both engine faces)", () => {
    for (const src of [
      `export function f() { return Object.assign(Symbol(), {}); }`,
      `export function f() { return Object.assign(Symbol(), {a: 1}); }`,
      `export function f() { return Object.assign(Symbol()); }`,
      `export function f() { const s = Symbol(); return Object.assign(s, {a: 1}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("symbol-prim getPrototypeOf receiver throws TypeError", () => {
    const r = call(`export function f() { return Object.getPrototypeOf(Symbol()); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("controls: nullish throws; number target legal (boxing bail unknown)", () => {
    expect(throwsError(call(`export function f() { return Object.assign(null, {}); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(call(`export function f() { return Object.getPrototypeOf(null); }`).throws, "TypeError")).toBe(true);
    const c3 = call(`export function f() { return Object.getPrototypeOf(5); }`);
    expect(isNever(c3.result)).toBe(false);
    const c4 = call(`export function f() { return Object.assign(1, {}); }`);
    expect(isNever(c4.result)).toBe(false);
    expect(isNever(c4.throws)).toBe(true);
  });
});

// --- Bug 44：Object.fromEntries ------------------------------------------------

describe("Bug 44: Object.fromEntries validation + projection", () => {
  it("non- iterable receiver / non-object entries throw TypeError", () => {
    for (const src of [
      `export function f() { return Object.fromEntries(1); }`,
      `export function f() { return Object.fromEntries(null); }`,
      `export function f() { return Object.fromEntries(undefined); }`,
      `export function f() { return Object.fromEntries(Symbol()); }`,
      `export function f() { return Object.fromEntries(true); }`,
      `export function f() { return Object.fromEntries(1n); }`,
      `export function f() { return Object.fromEntries("ab"); }`,
      `export function f() { return Object.fromEntries([1]); }`,
      `export function f() { return Object.fromEntries([null]); }`,
      `export function f() { return Object.fromEntries([, ["a", 1]]); }`,
      `export function f() { return Object.fromEntries(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract receiver records may TypeError, open obj value", () => {
    const r = evalSrc(`export function f(x) { return Object.fromEntries(x); }`);
    expect(r.effects).toContain("TypeError");
    const sh = (r.value as { shape?: { k?: string; open?: boolean } }).shape;
    expect(sh?.k).toBe("obj");
    expect(sh?.open).toBe(true);
  });

  it("projects entry tuples (extra elements ignored, ToString keys, missing value)", () => {
    expect(objSlots(call(`export function f() { return Object.fromEntries([["a", 1], ["b", 2]]); }`).result)).toEqual({ a: 1, b: 2 });
    expect(objSlots(call(`export function f() { return Object.fromEntries([]); }`).result)).toEqual({});
    expect(objSlots(call(`export function f() { return Object.fromEntries(""); }`).result)).toEqual({});
    expect(objSlots(call(`export function f() { return Object.fromEntries([[1, 2, 3]]); }`).result)).toEqual({ "1": 2 });
    expect(objSlots(call(`export function f() { return Object.fromEntries([["a"]]); }`).result)).toEqual({ a: undefined });
    expect(objSlots(call(`export function f() { return Object.fromEntries([[1n, 2]]); }`).result)).toEqual({ "1": 2 });
    expect(objSlots(call(`export function f() { return Object.fromEntries([[true, 2]]); }`).result)).toEqual({ true: 2 });
    expect(objSlots(call(`export function f() { return Object.fromEntries([[null, 2]]); }`).result)).toEqual({ null: 2 });
    expect(objSlots(call(`export function f() { return Object.fromEntries([[undefined, 2]]); }`).result)).toEqual({ undefined: 2 });
  });

  it("Map brand receiver projects its entries", () => {
    expect(objSlots(call(`export function f() { return Object.fromEntries(new Map([["a", 1]])); }`).result)).toEqual({ a: 1 });
  });

  it("symbol entry keys are kept (node v26: no ToString) — no throw, open obj", () => {
    const r = call(`export function f() { return Object.fromEntries([[Symbol(), 1]]); }`);
    expect(isNever(r.result)).toBe(false);
    expect(isNever(r.throws)).toBe(true);
    expect((r.result as { shape?: { open?: boolean } }).shape?.open).toBe(true);
  });
});
