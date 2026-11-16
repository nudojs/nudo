/**
 * ES env face：load + 高频内建签名与字面量折叠。
 */
import { describe, it, expect } from "vitest";
import { defineEnv } from "../es.ts";
import { formatShape, litValue, getFnImpl, absOnly, numLit, strLit, boolLit, abs } from "@nudojs/core";
import type { Abs } from "@nudojs/core";

type Env = ReturnType<typeof defineEnv>;

const shapeOf = (a: Abs | undefined, label: string): string => {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
};

const expectLeafClean = (fmt: string, label: string): void => {
  expect(fmt, `${label} should not mention unknown/any`).not.toMatch(/(^|[^\w])(unknown|any)([^\w]|$)/);
};

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur) return undefined;
    if (cur.shape.k === "fn" && cur.shape.slots) {
      cur = cur.shape.slots[k]?.value;
      continue;
    }
    if (cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

const globalOf = (env: Env, name: string): Abs => {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
};

const applyFold = (fn: Abs, args: Abs[]) => litValue(absOnly(getFnImpl(fn)!.apply!(args)));

describe("es env", () => {
  const env = defineEnv();

  it("加载并暴露 globals（无 modules）", () => {
    expect(env.globals).toBeTypeOf("object");
    expect(Object.keys(env.globals).length).toBeGreaterThan(15);
    expect(env.modules).toBeUndefined();
  });

  it("JSON.parse / stringify 是函数，stringify(undefined) 折叠", () => {
    const JSON_ = globalOf(env, "JSON");
    const parse = walk(JSON_, "parse");
    const stringify = walk(JSON_, "stringify");
    expect(shapeOf(parse, "JSON.parse")).toContain("=>");
    expect(shapeOf(stringify, "JSON.stringify")).toContain("=>");
    expect(getFnImpl(stringify!)!.apply!([globalOf(env, "undefined")])).toBeTruthy();
  });

  it("Math 高频运算/常量、floor 折叠、min/max/hypot 变长与 0/1 实参", () => {
    const Math_ = globalOf(env, "Math");
    for (const name of ["abs", "ceil", "floor", "round", "max", "min", "pow", "sqrt", "random"]) {
      const fmt = shapeOf(walk(Math_, name), `Math.${name}`);
      expect(fmt).toContain("=>");
      expectLeafClean(fmt, `Math.${name}`);
    }
    for (const name of ["PI", "E"]) expect(shapeOf(walk(Math_, name), `Math.${name}`)).toContain("number");
    expect(applyFold(walk(Math_, "floor")!, [numLit(3.7)])).toEqual({ ok: true, value: 3 });

    for (const [name, args, expected] of [["min", [3, 1, 2], 1], ["max", [3, 1, 2], 3], ["hypot", [3, 4, 12], 13]] as const) {
      const fn = walk(Math_, name)!;
      expect(shapeOf(fn, `Math.${name}`)).toContain("...");
      expect(applyFold(fn, args.map((n) => numLit(n))), `Math.${name}`).toEqual({ ok: true, value: expected });
      const abstractNum = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
      expect(shapeOf(absOnly(getFnImpl(fn)!.apply!([abstractNum, abstractNum, abstractNum])), `Math.${name} abstract`)).toContain("number");
    }

    for (const [name, args, expected] of [["min", [], Infinity], ["max", [], -Infinity], ["hypot", [], 0], ["min", [3], 3], ["max", [3], 3], ["hypot", [5], 5]] as const) {
      expect(applyFold(walk(Math_, name)!, args.map((n) => numLit(n))), `Math.${name}`).toEqual({ ok: true, value: expected });
    }
  });

  it("Number 静态检查 / 常量 / NaN 与 ±Infinity 精确", () => {
    const Number_ = globalOf(env, "Number");
    for (const name of ["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt"]) {
      expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("=>");
    }
    for (const name of ["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "EPSILON"]) expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("number");
    expect(shapeOf(walk(Number_, "NaN"), "Number.NaN")).toBe("NaN");
    expect(shapeOf(walk(Number_, "POSITIVE_INFINITY"), "Number.POSITIVE_INFINITY")).toBe("Infinity");
    expect(shapeOf(walk(Number_, "NEGATIVE_INFINITY"), "Number.NEGATIVE_INFINITY")).toBe("-Infinity");
  });

  it("Promise 静态方法返回 promise 形状", () => {
    const Promise_ = globalOf(env, "Promise");
    for (const name of ["resolve", "reject", "all", "race"]) expect(shapeOf(walk(Promise_, name), `Promise.${name}`)).toContain("=>");
  });

  it("console 方法是函数；Error 族品牌干净；ctor/name facet 正确", () => {
    const console_ = globalOf(env, "console");
    for (const name of ["log", "error", "warn", "info", "assert"]) expect(shapeOf(walk(console_, name), `console.${name}`)).toContain("=>");

    for (const name of ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError"]) {
      const s = shapeOf(globalOf(env, name), name);
      expect(s).toContain(name);
      expectLeafClean(s, name);
    }
    for (const name of ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "Date", "Promise"]) {
      const g = globalOf(env, name);
      expect(g.shape.k, name).toBe("fn");
      const fs = g.shape as { ctor?: boolean; name?: string };
      expect(fs.ctor, name).toBe(true);
      expect(fs.name, name).toBe(name);
    }
    const sym = globalOf(env, "Symbol");
    expect((sym.shape as { ctor?: boolean }).ctor).toBe(false);
    expect((sym.shape as { name?: string }).name).toBe("Symbol");
  });

  it("Array.isArray / Reflect 高频操作 / 全局数字 URI 助手 / NaN 与 Infinity", () => {
    expect(shapeOf(walk(globalOf(env, "Array"), "isArray"), "Array.isArray")).toContain("=>");
    const Reflect_ = globalOf(env, "Reflect");
    for (const name of ["get", "set", "has", "apply", "ownKeys"]) expect(shapeOf(walk(Reflect_, name), `Reflect.${name}`)).toContain("=>");
    for (const name of ["parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent"]) {
      expect(shapeOf(globalOf(env, name), name)).toContain("=>");
    }
    expect(shapeOf(globalOf(env, "NaN"), "NaN")).toBe("NaN");
    expect(shapeOf(globalOf(env, "Infinity"), "Infinity")).toBe("Infinity");
  });

  it("Boolean / String 对字面量折叠", () => {
    expect(applyFold(globalOf(env, "Boolean"), [strLit("x")])).toEqual({ ok: true, value: true });
    expect(applyFold(globalOf(env, "String"), [boolLit(false)])).toEqual({ ok: true, value: "false" });
  });

  it("parseInt / Number.parseInt 共享 ToInt32 radix 折叠", () => {
    const parseIntFn = globalOf(env, "parseInt");
    const numberParse = walk(globalOf(env, "Number"), "parseInt")!;
    for (const fn of [parseIntFn, numberParse]) {
      const fold = (s: string, radix?: number) => applyFold(fn, radix !== undefined ? [strLit(s), numLit(radix)] : [strLit(s)]);
      expect(fold("10", 2.5)).toEqual({ ok: true, value: 2 });
      expect(fold("10", 2.9)).toEqual({ ok: true, value: 2 });
      expect(fold("10", 0)).toEqual({ ok: true, value: 10 });
      expect(fold("0x10", 0)).toEqual({ ok: true, value: 16 });
      expect(fold("10", NaN)).toEqual({ ok: true, value: 10 });
      expect(fold("10", 4294967298)).toEqual({ ok: true, value: 2 });
      expect(fold("10", 37)).toEqual({ ok: true, value: NaN });
      expect(fold("10", 1)).toEqual({ ok: true, value: NaN });
      expect(fold("0x10")).toEqual({ ok: true, value: 16 });
    }
    expect(shapeOf(numberParse, "Number.parseInt")).toContain("radix?");
  });

  it("Number / Array 双面：可调用 + 静态槽；Promise / Date 可构造命名空间", () => {
    const numberFn = globalOf(env, "Number");
    expect(numberFn.shape.k).toBe("fn");
    expect(getFnImpl(numberFn)?.apply).toBeTruthy();
    expect(applyFold(numberFn, [strLit("42")])).toEqual({ ok: true, value: 42 });
    expect(shapeOf(walk(numberFn, "isFinite"), "Number.isFinite")).toContain("=>");
    expect(shapeOf(walk(numberFn, "MAX_SAFE_INTEGER"), "Number.MAX_SAFE_INTEGER")).toContain("number");

    const arrayFn = globalOf(env, "Array");
    expect(arrayFn.shape.k).toBe("fn");
    const a3 = absOnly(getFnImpl(arrayFn)!.apply!([numLit(3)]));
    expect(a3.shape.k).toBe("tuple");
    expect(shapeOf(walk(arrayFn, "isArray"), "Array.isArray")).toContain("=>");

    for (const name of ["Promise", "Date"]) {
      const fn = globalOf(env, name);
      expect(fn.shape.k).toBe("fn");
      expect(fn.shape.k === "fn" && fn.shape.name).toBe(name);
    }
    expect(shapeOf(walk(globalOf(env, "Promise"), "resolve"), "Promise.resolve")).toContain("=>");
    expect(shapeOf(walk(globalOf(env, "Date"), "now"), "Date.now")).toContain("=>");
  });
});
