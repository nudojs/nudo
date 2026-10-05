/**
 * 求值引擎命名空间静态 + 宿主全局守卫（wave 11：Bug 19/20/38/43/47/54/64）。
 * 全部断言与 node v26 ground truth 对齐（probe 记录见各 bug 注释）：
 *
 * - Bug 19 Reflect.*：非对象 target（prim/nullish/缺省）→ 定抛 TypeError；
 *   any target → may；闭 obj 槽命中投影。
 * - Bug 20 宿主全局守卫：decodeURIComponent("%") 定抛 URIError；全字面量
 *   实参真执行（"%41" → "A"）；抽象实参保守 unknown + may；symbol 实参定抛。
 * - Bug 38 String.fromCodePoint：越界/非整数/NaN → 定抛 RangeError；
 *   symbol/bigint → TypeError；合法字面量精确折叠；抽象 → may。
 * - Bug 43 Symbol.for/keyFor：注册表身份（同 key === true、keyFor 反查）；
 *   symbol key 定抛；非 symbol keyFor 实参定抛；抽象 → may。
 * - Bug 47/64 Promise 静态：node v26 实测迭代器获取折为 rejection（含
 *   all——bug 文本「同步定抛」被否决），同步侧不抛；race/any → 元素联合、
 *   allSettled → {status;value|reason}[] 值域。
 * - Bug 54 Error 家族：symbol message 定抛（new 与调用形）；AggregateError
 *   errors 非可迭代定抛（同步 IterableToList）；nullish/数字 message 全定。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  abs,
  formatAbs,
  type Abs,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

type CallResult = { result: Abs; throws: Abs };

function call(src: string, fnName = "f", args: unknown[] = []): CallResult {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]) as unknown as CallResult;
}

/** 值 + throws + may-throw 效果三面（effects 收集需要 may-throw session） */
function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: CallResult | undefined;
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as CallResult;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown, isThrows = false): string => {
    const s = formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
    return isThrows && s === "never" ? "" : s;
  };
  return {
    value: norm(result?.result ?? abs({ k: "unknown" }, undefined, undefined, "partial")),
    throws: norm(result?.throws, true),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsBrand(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

/** 定抛：result=never + throws=<name> brand */
function expectThrows(src: string, name: string): void {
  const r = call(src);
  expect(isNever(r.result), src).toBe(true);
  expect(throwsBrand(r.throws, name), `${src} throws=${formatAbs(r.throws)}`).toBe(true);
}

// --- Bug 19：Reflect.* ----------------------------------------------------

describe("Bug 19: Reflect.* target validation", () => {
  it("non-object literal target → definite TypeError", () => {
    for (const m of ["get", "set", "has", "ownKeys", "deleteProperty"]) {
      expectThrows(`export function f() { return Reflect.${m}(1, "a"); }`, "TypeError");
      expectThrows(`export function f() { return Reflect.${m}(null, "a"); }`, "TypeError");
      expectThrows(`export function f() { return Reflect.${m}("s", "a"); }`, "TypeError");
    }
    expectThrows(`export function f() { return Reflect.ownKeys(1); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.defineProperty(1, "a", {}); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.getPrototypeOf(1); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.setPrototypeOf(1, {}); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.setPrototypeOf({}, 1); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.apply(1, null, []); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.construct(1, []); }`, "TypeError");
    expectThrows(`export function f() { return Reflect.apply(() => 1, null, 1); }`, "TypeError");
  });

  it("abstract target → may TypeError, value domain unchanged", () => {
    for (const src of [
      `export function f(x) { return Reflect.get(x, "a"); }`,
      `export function f(x) { return Reflect.has(x, "a"); }`,
      `export function f(x) { return Reflect.ownKeys(x); }`,
    ]) {
      const r = evalSrc(src, "f", [abs({ k: "any" }, undefined, undefined, "path")]);
      expect(r.effects, src).toContain("TypeError");
    }
  });

  it("object receivers project values (controls stay total)", () => {
    expect(litValue(call(`export function f() { return Reflect.get({ a: 1 }, "a"); }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return Reflect.has({ a: 1 }, "a"); }`).result))
      .toEqual({ ok: true, value: true });
    const set = evalSrc(`export function f() { return Reflect.set({}, "a", 1); }`);
    expect(set.throws).toBe("");
    const del = evalSrc(`export function f() { return Reflect.deleteProperty({ a: 1 }, "a"); }`);
    expect(del.throws).toBe("");
    const dp = evalSrc(`export function f() { return Reflect.defineProperty({}, "a", { value: 1 }); }`);
    expect(dp.throws).toBe("");
    const spo = evalSrc(`export function f() { return Reflect.setPrototypeOf({}, null); }`);
    expect(spo.throws).toBe("");
  });
});

// --- Bug 20：宿主全局守卫 --------------------------------------------------

describe("Bug 20: unmodeled host globals execute with guarded literal args", () => {
  it("literal arg reaching a native throw folds into the throws domain", () => {
    expectThrows(`export function f() { return decodeURIComponent("%"); }`, "URIError");
    expectThrows(`export function f() { return decodeURI("%"); }`, "URIError");
    expectThrows(`export function f() { return encodeURIComponent(Symbol()); }`, "TypeError");
    expectThrows(`export function f() { return btoa("€"); }`, "InvalidCharacterError");
  });

  it("literal args really execute and fold exact values", () => {
    expect(litValue(call(`export function f() { return decodeURIComponent("%41"); }`).result))
      .toEqual({ ok: true, value: "A" });
    expect(litValue(call(`export function f() { return btoa("ab"); }`).result))
      .toEqual({ ok: true, value: "YWI=" });
    expect(litValue(call(`export function f() { return encodeURIComponent("a b"); }`).result))
      .toEqual({ ok: true, value: "a%20b" });
  });

  it("abstract argument is not fed to the host fn: unknown + may", () => {
    const r = evalSrc(`export function f(x) { return encodeURIComponent(x); }`, "f", [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.effects).toContain("TypeError");
    expect(r.throws).toBe("");
  });

  it("allowlisted GLOBAL_FNS folds stay intact (control)", () => {
    expect(litValue(call(`export function f() { return parseInt("42"); }`).result))
      .toEqual({ ok: true, value: 42 });
  });
});

// --- Bug 38：String.fromCodePoint -----------------------------------------

describe("Bug 38: String.fromCodePoint validation and folding", () => {
  it("invalid literal code points → definite RangeError", () => {
    for (const arg of ["-1", "0x110000", "65.5", '"66.5"', "NaN", "undefined", '"abc"', "Infinity"]) {
      expectThrows(`export function f() { return String.fromCodePoint(${arg}); }`, "RangeError");
    }
  });

  it("symbol / bigint args → definite TypeError (ToNumber)", () => {
    expectThrows(`export function f() { return String.fromCodePoint(Symbol()); }`, "TypeError");
    expectThrows(`export function f() { return String.fromCodePoint(1n); }`, "TypeError");
  });

  it("legal literals fold exactly (multi-arg, coercion, no-arg)", () => {
    expect(litValue(call(`export function f() { return String.fromCodePoint(65); }`).result))
      .toEqual({ ok: true, value: "A" });
    expect(litValue(call(`export function f() { return String.fromCodePoint(65, 0x1F600); }`).result))
      .toEqual({ ok: true, value: "A😀" });
    expect(litValue(call(`export function f() { return String.fromCodePoint("65"); }`).result))
      .toEqual({ ok: true, value: "A" });
    expect(litValue(call(`export function f() { return String.fromCodePoint(null); }`).result))
      .toEqual({ ok: true, value: "\u0000" });
    expect(litValue(call(`export function f() { return String.fromCodePoint(); }`).result))
      .toEqual({ ok: true, value: "" });
  });

  it("abstract arg → conservative string + may RangeError", () => {
    const r = evalSrc(`export function f(x) { return String.fromCodePoint(x); }`, "f", [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.effects).toContain("RangeError");
    expect(r.throws).toBe("");
    expect(r.value).toContain("string");
  });

  it("fromCharCode unchanged (control)", () => {
    expect(litValue(call(`export function f() { return String.fromCharCode(65); }`).result))
      .toEqual({ ok: true, value: "A" });
  });
});

// --- Bug 43：Symbol.for / Symbol.keyFor -----------------------------------

describe("Bug 43: Symbol.for / Symbol.keyFor registry semantics", () => {
  it("definite TypeErrors: symbol key / non-symbol keyFor argument", () => {
    expectThrows(`export function f() { return Symbol.for(Symbol()); }`, "TypeError");
    expectThrows(`export function f() { return Symbol.keyFor(1); }`, "TypeError");
    expectThrows(`export function f() { return Symbol.keyFor("a"); }`, "TypeError");
    expectThrows(`export function f() { return Symbol.keyFor(null); }`, "TypeError");
  });

  it("registry identity: same key interns, keyFor round-trips, description is the key", () => {
    expect(litValue(call(`export function f() { return Symbol.for("a") === Symbol.for("a"); }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return String(Symbol.for("a")); }`).result))
      .toEqual({ ok: true, value: "Symbol(a)" });
    expect(litValue(call(`export function f() { return Symbol.keyFor(Symbol.for("a")); }`).result))
      .toEqual({ ok: true, value: "a" });
    expect(litValue(call(`export function f() { return Symbol.for("nudo").description; }`).result))
      .toEqual({ ok: true, value: "nudo" });
    // 非字符串字面量 key 过 ToString（node 实测 Symbol.for(1) → Symbol(1)）
    expect(litValue(call(`export function f() { return String(Symbol.for(1)); }`).result))
      .toEqual({ ok: true, value: "Symbol(1)" });
  });

  it("fresh symbols are unregistered → keyFor undefined; two fresh differ", () => {
    expect(litValue(call(`export function f() { return Symbol.keyFor(Symbol("a")); }`).result))
      .toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return Symbol("a") === Symbol("a"); }`).result))
      .toEqual({ ok: true, value: false });
  });

  it("abstract key / abstract keyFor arg → may TypeError", () => {
    const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
    const r1 = evalSrc(`export function f(x) { return Symbol.for(x); }`, "f", [anyAbs]);
    expect(r1.effects).toContain("TypeError");
    const r2 = evalSrc(`export function f(x) { return Symbol.keyFor(x); }`, "f", [anyAbs]);
    expect(r2.effects).toContain("TypeError");
  });
});

// --- Bug 47/64：Promise 静态（node v26：迭代器获取折 rejection，不同步抛）---

describe("Bug 47/64: Promise statics", () => {
  it("non-iterable receivers do not throw synchronously (node v26: rejected promise)", () => {
    for (const src of [
      `export function f() { return Promise.all(1); }`,
      `export function f() { return Promise.race(1); }`,
      `export function f() { return Promise.allSettled(null); }`,
      `export function f() { return Promise.any(1); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("");
    }
  });

  it("iterable receivers keep projections and stay total (controls)", () => {
    expect(evalSrc(`export function f() { return Promise.all([1]); }`).throws).toBe("");
    expect(evalSrc(`export function f() { return Promise.all("ab"); }`).throws).toBe("");
    const fast = evalSrc(`export function f() { return Promise.all([Promise.resolve(1), 2]); }`);
    expect(fast.value).toContain("promise<[1, 2]>");
    const fast2 = evalSrc(`export function f() { return Promise.all([Promise.resolve(1)]); }`);
    expect(fast2.value).toContain("promise<[1]>");
  });

  it("race/any project element unions; allSettled projects status entries", () => {
    const race = evalSrc(`export function f() { return Promise.race([1, "a"]); }`);
    expect(race.value).toContain('promise<1 | "a">');
    const any = evalSrc(`export function f() { return Promise.any([1]); }`);
    expect(any.value).toContain("promise<1>");
    const settled = evalSrc(`export function f() { return Promise.allSettled([1]); }`);
    expect(settled.value).toContain('"fulfilled" | "rejected"');
    expect(settled.value).toContain("value");
    expect(settled.value).toContain("reason");
  });

  it("resolve/reject unchanged (controls)", () => {
    const r = evalSrc(`export function f() { return Promise.resolve(1); }`);
    expect(r.value).toContain("promise<1>");
    expect(r.throws).toBe("");
  });
});

// --- Bug 54：Error 家族 ctor 实参 -----------------------------------------

describe("Bug 54: Error-family constructor argument validation", () => {
  it("symbol message → definite TypeError (all ctors, both call forms)", () => {
    for (const src of [
      `export function f() { return new Error(Symbol()); }`,
      `export function f() { return Error(Symbol()); }`,
      `export function f() { return new TypeError(Symbol()); }`,
      `export function f() { return new RangeError(Symbol()); }`,
      `export function f() { return new SyntaxError(Symbol("a")); }`,
      `export function f() { return new AggregateError([], Symbol()); }`,
    ]) {
      expectThrows(src, "TypeError");
    }
  });

  it("AggregateError errors argument not iterable → definite TypeError", () => {
    for (const src of [
      `export function f() { return new AggregateError(Symbol()); }`,
      `export function f() { return new AggregateError(1); }`,
      `export function f() { return new AggregateError(null); }`,
    ]) {
      expectThrows(src, "TypeError");
    }
  });

  it("non-symbol messages and iterable errors stay total (controls)", () => {
    for (const src of [
      `export function f() { return new Error(); }`,
      `export function f() { return new Error(1); }`,
      `export function f() { return new Error(null); }`,
      `export function f() { return new Error(undefined); }`,
      `export function f() { return new Error({}); }`,
      `export function f() { return new Error(1n); }`,
      `export function f() { return new Error("m", Symbol()); }`, // options 非对象原生忽略
      `export function f() { return new AggregateError([], "m"); }`,
      `export function f() { return new AggregateError("ab", "m"); }`, // 字符串可迭代
      `export function f() { return new AggregateError([1, 2]); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("");
    }
  });

  it("abstract message → may TypeError", () => {
    const r = evalSrc(`export function f(x) { return new Error(x); }`, "f", [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.effects).toContain("TypeError");
    const r2 = evalSrc(`export function f(x) { return new AggregateError(x, "m"); }`, "f", [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r2.effects).toContain("TypeError");
  });

  it("message folding unchanged for literals (regression)", () => {
    expect(litValue(call(`export function f() { return new Error(5).message; }`).result))
      .toEqual({ ok: true, value: "5" });
    expect(litValue(call(`export function f() { return new Error(null).message; }`).result))
      .toEqual({ ok: true, value: "null" });
  });
});
