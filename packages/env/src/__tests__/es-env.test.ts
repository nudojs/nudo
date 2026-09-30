import { describe, it, expect } from "vitest";
import { defineEnv } from "../es.ts";
import {
  formatShape,
  litValue,
  getFnImpl,
  numLit,
  strLit,
  boolLit,
  abs,
} from "@nudojs/core";
import type { Abs } from "@nudojs/core";

/**
 * ES env face (packages/env/src/es.ts) — load + high-frequency builtins.
 * Asserts Abs-native signatures exist (shape-level; not full ES soundness).
 * Style mirrors node-env-gaps.test.ts.
 */

type Env = ReturnType<typeof defineEnv>;

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

/** clean = format 串不含 unknown/any 叶子 token */
function expectLeafClean(fmt: string, label: string): void {
  expect(fmt, `${label} should not mention unknown/any`).not.toMatch(
    /(^|[^\w])(unknown|any)([^\w]|$)/,
  );
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs | undefined;
    }
    if (cur && cur.shape.k === "fn" && cur.shape.slots) {
      cur = cur.shape.slots[k]?.value;
      continue;
    }
    if (!cur || cur.shape.k !== "obj") return undefined;
    const slot = cur.shape.slots[k];
    cur = slot?.value;
  }
  return cur;
}

function globalOf(env: Env, name: string): Abs {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
}

describe("es env load + key builtins", () => {
  const env = defineEnv();

  it("loads without throwing and exposes a globals table", () => {
    expect(env).toBeTruthy();
    expect(env.globals).toBeTypeOf("object");
    expect(Object.keys(env.globals).length).toBeGreaterThan(15);
    expect(env.modules).toBeUndefined();
  });

  it("JSON.parse / JSON.stringify are typed functions", () => {
    const JSON_ = globalOf(env, "JSON");
    const parse = walk(JSON_, "parse");
    const stringify = walk(JSON_, "stringify");
    expect(shapeOf(parse, "JSON.parse")).toContain("=>");
    expect(shapeOf(stringify, "JSON.stringify")).toContain("=>");
    // stringify literal folds to a string Abs
    const impl = getFnImpl(stringify!);
    expect(impl).toBeTruthy();
    const folded = impl!.apply!([globalOf(env, "undefined")]);
    // undefined → JSON.stringify(undefined) === undefined → undef leaf
    expect(folded).toBeTruthy();
  });

  it("Math exposes high-frequency numeric ops + constants", () => {
    const Math_ = globalOf(env, "Math");
    for (const name of [
      "abs",
      "ceil",
      "floor",
      "round",
      "max",
      "min",
      "pow",
      "sqrt",
      "random",
    ] as const) {
      const fn = walk(Math_, name);
      expect(shapeOf(fn, `Math.${name}`)).toContain("=>");
      expectLeafClean(shapeOf(fn, `Math.${name}`), `Math.${name}`);
    }
    for (const name of ["PI", "E"] as const) {
      const c = walk(Math_, name);
      expect(shapeOf(c, `Math.${name}`)).toContain("number");
    }
    // literal folding: Math.floor(3.7) → 3
    const floor = walk(Math_, "floor")!;
    const impl = getFnImpl(floor)!;
    const folded = impl.apply!([numLit(3.7)]);
    expect(litValue(folded!)).toEqual({ ok: true, value: 3 });
  });

  it("Math.min / Math.max / Math.hypot are variadic (3+ args stay number)", () => {
    const Math_ = globalOf(env, "Math");
    for (const [name, args, expected] of [
      ["min", [3, 1, 2], 1],
      ["max", [3, 1, 2], 3],
      ["hypot", [3, 4, 12], 13],
    ] as const) {
      const fn = walk(Math_, name)!;
      // 签名：required 为空 + 一个 rest 槽（形状里出现 "..."）
      expect(shapeOf(fn, `Math.${name}`)).toContain("...");
      const impl = getFnImpl(fn)!;
      const folded = impl.apply!(args.map((n) => numLit(n)));
      expect(litValue(folded!), `Math.${name}(${args.join(", ")})`).toEqual({ ok: true, value: expected });
      // 抽象实参：结果仍是 number（不再因 arity 不匹配落 unknown）
      const abstractNum = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
      const abstract = impl.apply!([abstractNum, abstractNum, abstractNum]);
      expect(shapeOf(abstract, `Math.${name} abstract`)).toContain("number");
    }
  });

  it("Math.min / Math.max / Math.hypot fold at 0 and 1 args (ES empty-call edge)", () => {
    const Math_ = globalOf(env, "Math");
    const cases = [
      ["min", [], Infinity],
      ["max", [], -Infinity],
      ["hypot", [], 0],
      ["min", [3], 3],
      ["max", [3], 3],
      ["hypot", [5], 5],
    ] as const;
    for (const [name, args, expected] of cases) {
      const fn = walk(Math_, name)!;
      const impl = getFnImpl(fn)!;
      const folded = impl.apply!(args.map((n) => numLit(n)));
      expect(litValue(folded!), `Math.${name}(${args.join(", ")})`).toEqual({ ok: true, value: expected });
    }
  });

  it("Number static checks and parseInt/parseFloat are present", () => {
    const Number_ = globalOf(env, "Number");
    for (const name of [
      "isFinite",
      "isInteger",
      "isNaN",
      "isSafeInteger",
      "parseFloat",
      "parseInt",
    ] as const) {
      expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("=>");
    }
    for (const name of [
      "MAX_SAFE_INTEGER",
      "MIN_SAFE_INTEGER",
      "NaN",
      "EPSILON",
    ] as const) {
      expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("number");
    }
  });

  it("Promise statics return promise-shaped results", () => {
    const Promise_ = globalOf(env, "Promise");
    const resolve = walk(Promise_, "resolve");
    expect(shapeOf(resolve, "Promise.resolve")).toContain("=>");
    expect(shapeOf(walk(Promise_, "reject"), "Promise.reject")).toContain("=>");
    expect(shapeOf(walk(Promise_, "all"), "Promise.all")).toContain("=>");
    expect(shapeOf(walk(Promise_, "race"), "Promise.race")).toContain("=>");
  });

  it("console methods are void functions", () => {
    const console_ = globalOf(env, "console");
    for (const name of ["log", "error", "warn", "info", "assert"] as const) {
      const fn = walk(console_, name);
      expect(shapeOf(fn, `console.${name}`)).toContain("=>");
    }
  });

  it("Error family constructors carry Error brands", () => {
    for (const name of [
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "URIError",
    ] as const) {
      const s = shapeOf(globalOf(env, name), name);
      expect(s).toContain(name);
      expectLeafClean(s, name);
    }
  });

  it("Array.isArray + Reflect high-frequency ops resolve", () => {
    const Array_ = globalOf(env, "Array");
    expect(shapeOf(walk(Array_, "isArray"), "Array.isArray")).toContain("=>");
    const Reflect_ = globalOf(env, "Reflect");
    for (const name of ["get", "set", "has", "apply", "ownKeys"] as const) {
      expect(shapeOf(walk(Reflect_, name), `Reflect.${name}`)).toContain("=>");
    }
  });

  it("global numeric/URI helpers are typed", () => {
    for (const name of [
      "parseInt",
      "parseFloat",
      "isNaN",
      "isFinite",
      "encodeURI",
      "decodeURI",
      "encodeURIComponent",
      "decodeURIComponent",
    ] as const) {
      const s = shapeOf(globalOf(env, name), name);
      expect(s).toContain("=>");
    }
    expect(shapeOf(globalOf(env, "NaN"), "NaN")).toContain("number");
    expect(shapeOf(globalOf(env, "Infinity"), "Infinity")).toContain("number");
  });

  it("Boolean/String coercions fold on literals", () => {
    const booleanFn = globalOf(env, "Boolean");
    const impl = getFnImpl(booleanFn)!;
    expect(litValue(impl.apply!([strLit("x")])!)).toEqual({ ok: true, value: true });
    const stringFn = globalOf(env, "String");
    const sImpl = getFnImpl(stringFn)!;
    expect(litValue(sImpl.apply!([boolLit(false)])!)).toEqual({ ok: true, value: "false" });
  });

  it("parseInt folds ToInt32 radix / auto-detect 0", () => {
    const parseIntFn = globalOf(env, "parseInt");
    const impl = getFnImpl(parseIntFn)!;
    const fold = (s: string, radix?: number) =>
      litValue(impl.apply!(radix !== undefined ? [strLit(s), numLit(radix)] : [strLit(s)])!);

    // ToInt32 截断小数
    expect(fold("10", 2.5)).toEqual({ ok: true, value: 2 });
    expect(fold("10", 2.9)).toEqual({ ok: true, value: 2 });
    // 0 / NaN → 自动进制
    expect(fold("10", 0)).toEqual({ ok: true, value: 10 });
    expect(fold("0x10", 0)).toEqual({ ok: true, value: 16 });
    expect(fold("10", NaN)).toEqual({ ok: true, value: 10 });
    // ToInt32 环绕
    expect(fold("10", 4294967298)).toEqual({ ok: true, value: 2 });
    // 越界仍 NaN
    expect(fold("10", 37)).toEqual({ ok: true, value: NaN });
    expect(fold("10", 1)).toEqual({ ok: true, value: NaN });
    // 无 radix：0x 前缀
    expect(fold("0x10")).toEqual({ ok: true, value: 16 });
  });

  it("Number.parseInt shares ToInt32 radix fold and declares radix?", () => {
    const Number_ = globalOf(env, "Number");
    const parseIntFn = walk(Number_, "parseInt")!;
    const impl = getFnImpl(parseIntFn)!;
    const fold = (s: string, radix?: number) =>
      litValue(impl.apply!(radix !== undefined ? [strLit(s), numLit(radix)] : [strLit(s)])!);
    expect(fold("10", 2.5)).toEqual({ ok: true, value: 2 });
    expect(fold("0x10", 0)).toEqual({ ok: true, value: 16 });
    // 签名面：radix 为可选参
    expect(shapeOf(parseIntFn, "Number.parseInt")).toContain("radix?");
  });

  // issue #58：dual-facet 全局（Number/Array）既可调用/构造，又带静态槽。
  // 此前 objAbs 遮蔽宿主全局后 $call/$new 折 unknown。
  it("Number/Array are dual-facet: callable + static slots", () => {
    const numberFn = globalOf(env, "Number");
    expect(numberFn.shape.k).toBe("fn");
    expect(getFnImpl(numberFn)?.apply).toBeTruthy();
    // Number("42") → 42
    expect(litValue(getFnImpl(numberFn)!.apply!([strLit("42")])!)).toEqual({ ok: true, value: 42 });
    expect(shapeOf(walk(numberFn, "isFinite"), "Number.isFinite")).toContain("=>");
    expect(shapeOf(walk(numberFn, "MAX_SAFE_INTEGER"), "Number.MAX_SAFE_INTEGER")).toContain(
      "number",
    );

    const arrayFn = globalOf(env, "Array");
    expect(arrayFn.shape.k).toBe("fn");
    const arrImpl = getFnImpl(arrayFn)!;
    // Array(3) → 3 元空洞 tuple
    const a3 = arrImpl.apply!([numLit(3)]);
    expect(a3.shape.k).toBe("tuple");
    expect(shapeOf(walk(arrayFn, "isArray"), "Array.isArray")).toContain("=>");
  });

  it("Promise/Date are constructible namespaces with statics", () => {
    const promiseFn = globalOf(env, "Promise");
    expect(promiseFn.shape.k).toBe("fn");
    expect(promiseFn.shape.k === "fn" && promiseFn.shape.name).toBe("Promise");
    expect(shapeOf(walk(promiseFn, "resolve"), "Promise.resolve")).toContain("=>");

    const dateFn = globalOf(env, "Date");
    expect(dateFn.shape.k).toBe("fn");
    expect(dateFn.shape.k === "fn" && dateFn.shape.name).toBe("Date");
    expect(shapeOf(walk(dateFn, "now"), "Date.now")).toContain("=>");
  });
});
