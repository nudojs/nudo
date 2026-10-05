/**
 * Wave 8 — 全局函数 / Number / Math 内建强转面 throws 域回归（Bug 23/25/26/
 * 30/45/50/81/83）。三面口径：确定抛（NudoThrow → 边界收成 throws brand）、
 * 抽象臂 may（recordMayThrow 效果，值域不变）、原生 total（无效果——假阳控制组）。
 * node v26 实测为 ground truth（探测结论见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, formatAbs, $lit } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";

function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

/** 无参入口（体内自含实参）；带抽象参入口（x: any） */
function evalAny(src: string, fnName = "f"): ReturnType<typeof evalSrc> {
  return evalSrc(src, fnName, [
    { shape: { k: "any" }, conf: "path" } as never,
  ]);
}

// --- Bug 23：Symbol(Symbol()) ----------------------------------------------

describe("Bug 23: Symbol(Symbol()) definite TypeError", () => {
  it("prim symbol descriptor → throws TypeError（node: ToString(Symbol) 恒抛）", () => {
    for (const src of [
      `export function f() { return Symbol(Symbol()); }`,
      `export function f() { return Symbol(Symbol("a")); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.value, src).toBe("never");
      expect(r.throws, src).toBe("TypeError");
    }
  });
  it("controls: string/number/bigint descriptor 原生全定", () => {
    for (const src of [
      `export function f() { return Symbol("a"); }`,
      `export function f() { return Symbol(1); }`,
      `export function f() { return Symbol(1n); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.throws, src).toBe("never");
      expect(r.value, src).toBe("symbol");
      expect(r.effects, src).toEqual([]);
    }
  });
});

// --- Bug 25：Math.* 静态 ----------------------------------------------------

describe("Bug 25: Math.* symbol/bigint operands", () => {
  it("prim symbol/bigint 操作数 → definite TypeError（node 实测全 Math 数值方法）", () => {
    for (const src of [
      `export function f() { return Math.max(Symbol()); }`,
      `export function f() { return Math.floor(Symbol()); }`,
      `export function f() { return Math.abs(BigInt(5)); }`,
      `export function f() { return Math.max(1n); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.value, src).toBe("never");
    }
  });
  it("抽象操作数 → may TypeError，值域不变", () => {
    const r = evalAny(`export function f(x) { return Math.max(x); }`);
    expect(r.value).toBe("NaN | number");
    expect(r.effects).toContain("TypeError");
    const r2 = evalAny(`export function f(x) { return Math.abs(x); }`);
    expect(r2.value).toBe("number");
    expect(r2.effects).toContain("TypeError");
  });
  it("FP 控制：lit(undefined)（含 spread 占位）原生 total，不打点", () => {
    const r = evalSrc(`export function f() { return Math.max(undefined); }`);
    expect(r.effects).toEqual([]);
    expect(r.value).toBe("NaN | number");
  });
  it("控制：全字面量折叠保持精确", () => {
    const r = evalSrc(`export function f() { return Math.max(1, 2); }`);
    expect(r.value).toBe("2");
  });
});

// --- Bug 26：parseInt / parseFloat / Number.parseFloat 首参 ------------------

describe("Bug 26: parseInt/parseFloat symbol first arg", () => {
  it("prim symbol 首参 → definite TypeError（node: ToString(Symbol) 恒抛）", () => {
    for (const src of [
      `export function f() { return parseInt(Symbol()); }`,
      `export function f() { return parseFloat(Symbol()); }`,
      `export function f() { return Number.parseFloat(Symbol()); }`,
      `export function f() { return Number.parseInt(Symbol()); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.value, src).toBe("never");
    }
  });
  it("抽象首参 → may TypeError，值域 number 不变", () => {
    for (const src of [
      `export function f(x) { return parseInt(x); }`,
      `export function f(x) { return Number.parseInt(x); }`,
      `export function f(x) { return parseFloat(x); }`,
    ]) {
      const r = evalAny(src);
      expect(r.value, src).toBe("number");
      expect(r.effects, src).toContain("TypeError");
    }
  });
  it("controls: 字面量 / bigint ToString 原生全定且精确", () => {
    expect(evalSrc(`export function f() { return parseInt("42"); }`).value).toBe("42");
    expect(evalSrc(`export function f() { return parseInt(1n); }`).value).toBe("1");
    expect(evalSrc(`export function f() { return Number.parseFloat("3.5"); }`).value).toBe("3.5");
  });
});

// --- Bug 30：BigInt({}) -----------------------------------------------------

describe("Bug 30: BigInt(object-literal) SyntaxError", () => {
  it("纯对象字面量（无自有 toString/valueOf）→ definite SyntaxError（node 实测）", () => {
    const r = evalSrc(`export function f() { return BigInt({}); }`);
    expect(r.value).toBe("never");
    expect(r.throws).toBe("SyntaxError");
    const r2 = evalSrc(`export function f() { return BigInt({ a: 1 }); }`);
    expect(r2.value).toBe("never");
    expect(r2.throws).toBe("SyntaxError");
  });
  it("抽象实参 → may TypeError|SyntaxError，值域 bigint 不变", () => {
    const r = evalAny(`export function f(x) { return BigInt(x); }`);
    expect(r.value).toBe("bigint");
    expect(r.effects).toContain("TypeError");
    expect(r.effects).toContain("SyntaxError");
  });
  it("controls: 字面量折叠 / 数组 / symbol 保持", () => {
    expect(evalSrc(`export function f() { return BigInt(5); }`).value).toBe("5n");
    expect(evalSrc(`export function f() { return BigInt("0x10"); }`).value).toBe("16n");
    expect(evalSrc(`export function f() { return BigInt(Symbol()); }`).value).toBe("never");
    const arr = evalSrc(`export function f() { return BigInt([5]); }`);
    expect(arr.value).toBe("bigint");
    expect(arr.effects).toEqual([]);
  });
});

// --- Bug 45：parseInt radix --------------------------------------------------

describe("Bug 45: parseInt/Number.parseInt radix", () => {
  it("symbol-prim / bigint-lit radix → definite TypeError（node: ToNumber 恒抛）", () => {
    for (const src of [
      `export function f() { return parseInt("42", Symbol()); }`,
      `export function f() { return Number.parseInt("42", Symbol()); }`,
      `export function f() { return parseInt("1", 1n); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.value, src).toBe("never");
    }
  });
  it("抽象 radix → may TypeError，值域 number 不变", () => {
    const r = evalAny(`export function f(x) { return parseInt("42", x); }`);
    expect(r.value).toBe("number");
    expect(r.effects).toContain("TypeError");
  });
  it("controls: 可 ToInt32 的 radix 字面量保持精确折叠（node 实测）", () => {
    expect(evalSrc(`export function f() { return parseInt("42", "8"); }`).value).toBe("34");
    expect(evalSrc(`export function f() { return parseInt("ff", 16); }`).value).toBe("255");
    expect(evalSrc(`export function f() { return parseInt("1", true); }`).value).toBe("NaN");
    expect(evalSrc(`export function f() { return parseInt("1", null); }`).value).toBe("1");
  });
});

// --- Bug 50：Number(x) / Array(x) / Object.assign(x, {}) ---------------------

describe("Bug 50: abstract arms of Number/Array/Object.assign", () => {
  it("Number(x) → may TypeError，值域 number 不变", () => {
    const r = evalAny(`export function f(x) { return Number(x); }`);
    expect(r.value).toBe("number");
    expect(r.effects).toContain("TypeError");
  });
  it("Array(x) → may RangeError（length 路径），值域 unknown[] 不变", () => {
    const r = evalAny(`export function f(x) { return Array(x); }`);
    expect(r.value).toBe("unknown[]");
    expect(r.effects).toContain("RangeError");
  });
  it("Object.assign(x, {}) → may TypeError（ToObject），值域不变", () => {
    const r = evalAny(`export function f(x) { return Object.assign(x, {}); }`);
    expect(r.effects).toContain("TypeError");
  });
  it("literal arms: 确定抛保持（node 实测）", () => {
    expect(evalSrc(`export function f() { return Number(Symbol()); }`).value).toBe("never");
    const neg = evalSrc(`export function f() { return Array(-1); }`);
    expect(neg.value).toBe("never");
    expect(neg.throws).toBe("RangeError");
    expect(evalSrc(`export function f() { return Object.assign(null, {}); }`).value).toBe("never");
  });
  it("FP 控制：Array(Symbol())/Array(1n) 原生单元素数组 total（node 实测），不打点", () => {
    const r = evalSrc(`export function f() { return Array(Symbol()); }`);
    expect(r.effects).toEqual([]);
    const r2 = evalSrc(`export function f() { return Array(1n); }`);
    expect(r2.effects).toEqual([]);
  });
  it("FP 控制：Number(1n) 原生合法折 1（ToNumeric 面，非 ToNumber）", () => {
    expect(evalSrc(`export function f() { return Number(1n); }`).value).toBe("1");
  });
});

// --- Bug 81：isNaN / isFinite ------------------------------------------------

describe("Bug 81: isNaN/isFinite coercion", () => {
  it("isFinite(<bigint literal>) → definite TypeError（node 实测，与 isNaN 同口径）", () => {
    const fin = evalSrc(`export function f() { return isFinite(1n); }`);
    expect(fin.value).toBe("never");
    expect(fin.throws).toBe("TypeError");
  });
  it("抽象臂 → may TypeError，值域 boolean 不变", () => {
    const r = evalAny(`export function f(x) { return isNaN(x); }`);
    expect(r.value).toBe("boolean");
    expect(r.effects).toContain("TypeError");
    const r2 = evalAny(`export function f(x) { return isFinite(x); }`);
    expect(r2.value).toBe("boolean");
    expect(r2.effects).toContain("TypeError");
  });
  it("controls: 字面量折叠 / symbol 硬抛保持", () => {
    expect(evalSrc(`export function f() { return isNaN(1n); }`).value).toBe("never");
    expect(evalSrc(`export function f() { return isNaN(Symbol()); }`).value).toBe("never");
    expect(evalSrc(`export function f() { return isFinite(Symbol()); }`).value).toBe("never");
    expect(evalSrc(`export function f() { return isFinite(""); }`).value).toBe("true");
  });
});

// --- Bug 83：BigInt.asIntN / asUintN -----------------------------------------

describe("Bug 83: BigInt.asIntN/asUintN ToIndex bits", () => {
  it("FP 修复：非 number 字面量位宽过 ToIndex 强转+截断，不再假阳 RangeError（node 实测）", () => {
    expect(evalSrc(`export function f() { return BigInt.asIntN("8", 1n); }`).value).toBe("1n");
    expect(evalSrc(`export function f() { return BigInt.asIntN(null, 1n); }`).value).toBe("0n");
    expect(evalSrc(`export function f() { return BigInt.asIntN(true, 1n); }`).value).toBe("-1n");
    expect(evalSrc(`export function f() { return BigInt.asIntN(1.5, 1n); }`).value).toBe("-1n");
    expect(evalSrc(`export function f() { return BigInt.asUintN(true, 1n); }`).value).toBe("1n");
    expect(evalSrc(`export function f() { return BigInt.asIntN(undefined, 1n); }`).value).toBe("0n");
  });
  it("prim symbol 位宽 → definite TypeError；抽象位宽 → may TypeError+RangeError", () => {
    const sym = evalSrc(`export function f() { return BigInt.asIntN(Symbol(), 1n); }`);
    expect(sym.value).toBe("never");
    expect(sym.throws).toBe("TypeError");
    const r = evalAny(`export function f(x) { return BigInt.asIntN(x, 1n); }`);
    expect(r.value).toBe("bigint");
    expect(r.effects).toContain("TypeError");
    expect(r.effects).toContain("RangeError");
  });
  it("controls: 负数 / 超界 → RangeError；正常折叠保持精确", () => {
    expect(evalSrc(`export function f() { return BigInt.asIntN(-1, 1n); }`).value).toBe("never");
    expect(evalSrc(`export function f() { return BigInt.asIntN(2 ** 53, 1n); }`).value).toBe("never");
    expect(evalSrc(`export function f() { return BigInt.asIntN(8, 255n); }`).value).toBe("-1n");
  });
});
