/**
 * 求值引擎宿主构造器实参校验（wave 6：Bug 15/16/17/18/37/41/53/63/85）：
 * 原生构造器实参的确定非法形态不得折成 brand/promise/调用结果 + throws=never。
 * 三档口径：definite（prim/缺省/nullish 字面量等）→ NudoThrow（调用边界收成
 * throws TypeError/RangeError）；any/unknown/含坏成员 union → recordMayThrow
 * （值域不变）；对象形态 → 原生全定。全部断言与 node v26 ground truth 对齐。
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

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

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
    // throws 通道无抛是 never Abs（formatAbs → "never"），归一为空串
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

function isBrand(r: unknown, name: string): boolean {
  const a = r as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

// --- Bug 15：new WeakMap/WeakSet iterable 实参 ----------------------------

describe("Bug 15: WeakMap/WeakSet constructor iterable argument", () => {
  it("non-iterable literal argument → definite TypeError", () => {
    for (const src of [
      `export function f() { return new WeakMap(1); }`,
      `export function f() { return new WeakSet(1); }`,
      `export function f() { return new WeakMap("s"); }`,
      `export function f() { return new WeakSet("s"); }`,
      `export function f() { return new WeakMap([1]); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("absent / null / legal entries stay total", () => {
    for (const src of [
      `export function f() { return new WeakMap(); }`,
      `export function f() { return new WeakMap(null); }`,
      `export function f() { return new WeakMap(undefined); }`,
      `export function f() { return new WeakMap(""); }`,
      `export function f() { return new WeakMap([[{ x: 1 }, "v"]]); }`,
      `export function f() { return new WeakSet([{ x: 1 }]); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("");
      expect(/WeakMap|WeakSet/.test(r.value), src).toBe(true);
    }
  });
});

// --- Bug 16：new Promise(executor) IsCallable -----------------------------

describe("Bug 16: Promise executor callability", () => {
  it("non-callable literal executor → definite TypeError（catch 不得吞）", () => {
    for (const src of [
      `export function f() { return new Promise(1); }`,
      `export function f() { return new Promise("s"); }`,
      `export function f() { return new Promise(null); }`,
      `export function f() { return new Promise(undefined); }`,
      `export function f() { return new Promise({}); }`,
      `export function f() { return new Promise(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("any executor → may TypeError；fn executor 保持 promise 值域", () => {
    const may = evalSrc(`export function f(x) { return new Promise(x); }`, "f", [anyAbs]);
    expect(may.effects).toContain("TypeError");
    const ok = evalSrc(`export function f() { return new Promise((r) => { r(1); }); }`);
    expect(ok.throws).toBe("");
    expect(ok.value).toBe("promise<1>");
  });
});

// --- Bug 17：f.apply(thisArg, argArray) CreateListFromArrayLike -----------

describe("Bug 17: Function.prototype.apply argArray validation", () => {
  it("non-nullish primitive argArray → definite TypeError（不得计算调用结果）", () => {
    for (const src of [
      `export function f() { return (function () { return 1; }).apply(null, 1); }`,
      `export function f() { return (function () { return 1; }).apply(null, "ab"); }`,
      `export function f() { return (function () { return 1; }).apply(null, true); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("nullish → 0 args；闭对象无 length → 0 args；数组 → 精确 arity", () => {
    expect(litValue(call(`export function f() { return (function () { return arguments.length; }).apply(null, null); }`).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { return (function () { return arguments.length; }).apply(null, undefined); }`).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { return (function () { return arguments.length; }).apply(null, {}); }`).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { return (function () { return arguments.length; }).apply(null, [1, 2]); }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return (function () { return arguments.length; }).apply(null); }`).result)).toEqual({ ok: true, value: 0 });
  });

  it("any argArray → may TypeError", () => {
    const r = evalSrc(`export function f(x) { return (function () { return 1; }).apply(null, x); }`, "f", [anyAbs]);
    expect(r.effects).toContain("TypeError");
  });
});

// --- Bug 18：reduce/reduceRight 空数组无初值 ------------------------------

describe("Bug 18: reduce/reduceRight empty array without initial value", () => {
  it("empty tuple + no initial → definite TypeError", () => {
    for (const src of [
      `export function f() { return [].reduce(() => {}); }`,
      `export function f() { return [].reduceRight(() => {}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("single element + no initial → 返回该元素，不调回调", () => {
    const r = call(`export function f() { return [1].reduce((a, b) => a + b); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    const calls = call(`export function f() { let n = 0; [1].reduce((a, b) => { n++; return a; }); return n; }`);
    expect(litValue(calls.result)).toEqual({ ok: true, value: 0 });
  });

  it("多元素无初值按原生 acc=首元素折叠；有初值保持原语义", () => {
    expect(litValue(call(`export function f() { return [1, 2].reduce((a, b) => a + b); }`).result)).toEqual({ ok: true, value: 3 });
    expect(litValue(call(`export function f() { return [].reduce(() => {}, 0); }`).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { return [1, 2].reduceRight((a, b) => a - b); }`).result)).toEqual({ ok: true, value: 1 });
  });

  it("抽象数组（arr 元素型）无初值 → may TypeError", () => {
    const r = evalSrc(`export function f(xs) { return xs.reduce((a, b) => a); }`, "f", [
      abs({ k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") }, undefined, undefined, "path"),
    ]);
    expect(r.effects).toContain("TypeError");
  });
});

// --- Bug 37：new Proxy IsObject ×2 ---------------------------------------

describe("Bug 37: new Proxy target/handler IsObject", () => {
  it("prim/nullish target 或 handler → definite TypeError", () => {
    for (const src of [
      `export function f() { return new Proxy(1, {}); }`,
      `export function f() { return new Proxy({}, 1); }`,
      `export function f() { return new Proxy(null, {}); }`,
      `export function f() { return new Proxy({}, null); }`,
      `export function f() { return new Proxy("s", {}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("对象 target+handler → 全定 Proxy brand（不得假抛）", () => {
    const r = evalSrc(`export function f() { return new Proxy({}, {}); }`);
    expect(r.throws).toBe("");
    expect(isBrand(call(`export function f() { return new Proxy({}, {}); }`).result, "Proxy")).toBe(true);
  });

  it("any target 或 handler → may TypeError + brand", () => {
    expect(evalSrc(`export function f(x) { return new Proxy(x, {}); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new Proxy({}, x); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });
});

// --- Bug 41：new ArrayBuffer ToIndex --------------------------------------

describe("Bug 41: new ArrayBuffer ToIndex validation", () => {
  it("负数/超界/±∞ 字面量（含数字字符串折算）→ definite RangeError", () => {
    for (const src of [
      `export function f() { return new ArrayBuffer(-1); }`,
      `export function f() { return new ArrayBuffer("-1"); }`,
      `export function f() { return new ArrayBuffer(Infinity); }`,
      `export function f() { return new ArrayBuffer(2 ** 53); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "RangeError"), src).toBe(true);
    }
  });

  it("symbol/bigint → definite TypeError（ToNumber）", () => {
    for (const src of [
      `export function f() { return new ArrayBuffer(Symbol()); }`,
      `export function f() { return new ArrayBuffer(8n); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("合法长度（缺省/NaN/0/'8'/null）→ 全定 brand", () => {
    for (const src of [
      `export function f() { return new ArrayBuffer(8); }`,
      `export function f() { return new ArrayBuffer(); }`,
      `export function f() { return new ArrayBuffer("8"); }`,
      `export function f() { return new ArrayBuffer("abc"); }`,
      `export function f() { return new ArrayBuffer(null); }`,
      `export function f() { return new ArrayBuffer(-0.5); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("");
      expect(isBrand(call(src).result, "ArrayBuffer"), src).toBe(true);
    }
  });

  it("any 长度 → may RangeError", () => {
    expect(evalSrc(`export function f(x) { return new ArrayBuffer(x); }`, "f", [anyAbs]).effects).toContain("RangeError");
  });
});

// --- Bug 53：装箱构造器 symbol 实参 ---------------------------------------

describe("Bug 53: boxed Number/String symbol argument", () => {
  it("new Number/String(Symbol()) → definite TypeError", () => {
    for (const src of [
      `export function f() { return new Number(Symbol()); }`,
      `export function f() { return new String(Symbol()); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("Boolean(Symbol()) 与非 symbol 实参保持全定装箱", () => {
    for (const src of [
      `export function f() { return new Boolean(Symbol()); }`,
      `export function f() { return new Number(); }`,
      `export function f() { return new Number("a"); }`,
      `export function f() { return new Number(1n); }`,
      `export function f() { return new String(1); }`,
      `export function f() { return new String("ab"); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("");
    }
    expect(litValue(call(`export function f() { return new String("ab").length; }`).result)).toEqual({ ok: true, value: 2 });
  });

  it("any 实参 → may TypeError（Number/String，不含 Boolean）", () => {
    expect(evalSrc(`export function f(x) { return new Number(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new String(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new Boolean(x); }`, "f", [anyAbs]).effects).not.toContain("TypeError");
  });
});

// --- Bug 63：new DataView IsArrayBuffer / ToIndex -------------------------

describe("Bug 63: new DataView buffer validation", () => {
  it("非 ArrayBuffer 字面量接收者 → definite TypeError", () => {
    for (const src of [
      `export function f() { return new DataView(1); }`,
      `export function f() { return new DataView({}); }`,
      `export function f() { return new DataView(null); }`,
      `export function f() { return new DataView("buf"); }`,
      `export function f() { return new DataView([1, 2]); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("负 byteOffset 字面量 → definite RangeError；合法 → 全定 brand", () => {
    const bad = call(`export function f() { return new DataView(new ArrayBuffer(8), -1); }`);
    expect(isNever(bad.result)).toBe(true);
    expect(throwsBrand(bad.throws, "RangeError")).toBe(true);
    const ok = evalSrc(`export function f() { return new DataView(new ArrayBuffer(8)); }`);
    expect(ok.throws).toBe("");
    expect(isBrand(call(`export function f() { return new DataView(new ArrayBuffer(8)); }`).result, "DataView")).toBe(true);
  });

  it("any buffer → may TypeError", () => {
    expect(evalSrc(`export function f(x) { return new DataView(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });
});

// --- Bug 85：new URL ToString + 解析校验 ----------------------------------

describe("Bug 85: new URL input validation", () => {
  it("不可解析字面量 / symbol / 缺省 → definite TypeError", () => {
    for (const src of [
      `export function f() { return new URL("not a url"); }`,
      `export function f() { return new URL(1); }`,
      `export function f() { return new URL(null); }`,
      `export function f() { return new URL(Symbol()); }`,
      `export function f() { return new URL(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("合法 URL 真解析 → URL brand + 精确 href 槽", () => {
    const r = evalSrc(`export function f() { return new URL("http://x/"); }`);
    expect(r.throws).toBe("");
    expect(isBrand(call(`export function f() { return new URL("http://x/"); }`).result, "URL")).toBe(true);
    expect(litValue(call(`export function f() { return new URL("http://x/a?b=1").href; }`).result)).toEqual({ ok: true, value: "http://x/a?b=1" });
    expect(litValue(call(`export function f() { return new URL("a", "http://x/").href; }`).result)).toEqual({ ok: true, value: "http://x/a" });
  });

  it("any input / 抽象 base → may TypeError", () => {
    expect(evalSrc(`export function f(x) { return new URL(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(b) { return new URL("a", b); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });
});
