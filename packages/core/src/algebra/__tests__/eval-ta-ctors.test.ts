/**
 * 求值引擎 TypedArray 构造器/静态面实参校验（Bug 21/27）：
 * - Bug 21：`new <TA>(length)` 跳过 ToIndex——负/超界 → 定抛 RangeError、
 *   symbol/bigint → 定抛 TypeError、抽象 → may（与 makeArrayBufferAbs 同
 *   口径；两个分发面 evalBuiltinNew + $new 宿主表共用 builder）。
 * - Bug 27：`%TypedArray%.from` items 跳过 ToObject（nullish → 定抛
 *   TypeError、可能 nullish 的抽象 → may）；`.of` 逐项跳过元素转换
 *   （number 域 symbol/bigint 项定抛；bigint 域 number/symbol/nullish 项
 *   定抛、string 项 StringToBigInt）。mapFn 校验属 Bug 37（另行任务）。
 * 全部断言与 node v26 ground truth 对齐（见 tmp/bug-report.md 两案矩阵）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  abs,
  type Abs,
} from "../index.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const numParam = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

type CallResult = { result: Abs; throws: Abs };

function call(src: string, fnName = "f", args: unknown[] = []): CallResult {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]) as unknown as CallResult;
}

/** may-throw 效果收集（gate 面断言；效果收集需要 may-throw session） */
function evalEffects(
  src: string,
  fnName = "f",
  args: unknown[] = [],
): string[] {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      callTranspiledExportFull(run, fnName, args as never[]) as unknown as CallResult;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(effects.map((e) => e.kind))];
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

// --- Bug 21：new <TA>(length) ToIndex 校验 --------------------------------

describe("Bug 21: TypedArray constructor ToIndex validation", () => {
  it("负数/超界/±∞ 字面量（含数字字符串折算）→ definite RangeError（全家族）", () => {
    for (const src of [
      `export function f() { return new Uint8Array(-1); }`,
      `export function f() { return new Uint8Array("-1"); }`,
      `export function f() { return new Uint8Array(1e300); }`,
      `export function f() { return new Uint8Array(2 ** 53); }`,
      `export function f() { return new Uint8Array(Infinity); }`,
      `export function f() { return new Int32Array(-1); }`,
      `export function f() { return new Float64Array(-1); }`,
      `export function f() { return new BigInt64Array(-1); }`,
      `export function f() { return new Uint8ClampedArray(-1); }`,
      `export function f() { return new Float16Array(-1); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "RangeError"), src).toBe(true);
    }
  });

  it("symbol/bigint → definite TypeError（ToNumber）", () => {
    for (const src of [
      `export function f() { return new Uint8Array(Symbol()); }`,
      `export function f() { return new Uint8Array(1n); }`,
      `export function f() { return new Float32Array(Symbol()); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("合法实参（缺省/NaN/截断/'8'/null/iterable）→ 不抛 + 元素域 brand", () => {
    for (const src of [
      `export function f() { return new Uint8Array(3); }`,
      `export function f() { return new Uint8Array(2.5); }`,
      `export function f() { return new Uint8Array(); }`,
      `export function f() { return new Uint8Array("8"); }`,
      `export function f() { return new Uint8Array("abc"); }`,
      `export function f() { return new Uint8Array(null); }`,
      `export function f() { return new Uint8Array(-0.5); }`,
      `export function f() { return new Uint8Array([1, 2]); }`,
      `export function f() { return new BigInt64Array(2); }`,
    ]) {
      const r = call(src);
      expect(throwsBrand(r.throws, "RangeError"), src).toBe(false);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(false);
      expect(r.result && typeof r.result === "object" && "shape" in r.result, src).toBe(true);
    }
    expect(isBrand(call(`export function f() { return new Uint8Array(3); }`).result, "Uint8Array")).toBe(true);
    expect(isBrand(call(`export function f() { return new BigInt64Array(2); }`).result, "BigInt64Array")).toBe(true);
  });

  it("any 长度 → may RangeError（+ 可能 symbol → may TypeError）；抽象 number → 仅 may RangeError", () => {
    const r = evalEffects(`export function f(x) { return new Uint8Array(x); }`, "f", [anyAbs]);
    expect(r).toContain("RangeError");
    expect(r).toContain("TypeError");
    const n = evalEffects(`export function f(n) { return new Uint8Array(n); }`, "f", [numParam]);
    expect(n).toEqual(["RangeError"]);
  });

  it("$new 宿主面与 evalBuiltinNew Abs 面（.constructor 派发）同口径", () => {
    const src = `export function f() { const C = new Uint8Array(1).constructor; return new C(-1); }`;
    const r = call(src);
    expect(isNever(r.result), src).toBe(true);
    expect(throwsBrand(r.throws, "RangeError"), src).toBe(true);
  });
});

// --- Bug 27：%TypedArray%.from / .of 静态面校验 ----------------------------

describe("Bug 27: TypedArray static from/of validation", () => {
  it("from(nullish) → definite TypeError（含 Int16/Float64/BigInt64/Float16 家族）", () => {
    for (const src of [
      `export function f() { return Uint8Array.from(null); }`,
      `export function f() { return Uint8Array.from(undefined); }`,
      `export function f() { return Int16Array.from(null); }`,
      `export function f() { return Float64Array.from(undefined); }`,
      `export function f() { return BigInt64Array.from(null); }`,
      `export function f() { return Float16Array.from(null); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("of 逐项 ToNumber（number 域）：symbol/bigint 项 → definite TypeError", () => {
    for (const src of [
      `export function f() { return Uint8Array.of(Symbol()); }`,
      `export function f() { return Uint8Array.of(1n); }`,
      `export function f() { return Float64Array.of(Symbol()); }`,
      `export function f() { return Float16Array.of(Symbol()); }`,
      `export function f() { return Uint8Array.of(1, 2, Symbol()); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("of 逐项 ToBigInt（bigint 域）：number/symbol/nullish 项 → TypeError；坏 string → SyntaxError", () => {
    for (const src of [
      `export function f() { return BigInt64Array.of(1); }`,
      `export function f() { return BigInt64Array.of(1.5); }`,
      `export function f() { return BigInt64Array.of(null); }`,
      `export function f() { return BigInt64Array.of(undefined); }`,
      `export function f() { return BigInt64Array.of(Symbol()); }`,
      `export function f() { return BigUint64Array.of(1); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(true);
    }
    const s = call(`export function f() { return BigInt64Array.of("abc"); }`);
    expect(isNever(s.result)).toBe(true);
    expect(throwsBrand(s.throws, "SyntaxError")).toBe(true);
  });

  it("合法控制组：from 非可迭代对象面全定（array-like 路径 length 0）/ of 良性项", () => {
    for (const src of [
      `export function f() { return Uint8Array.from(1); }`,
      `export function f() { return Uint8Array.from(Symbol()); }`,
      `export function f() { return Uint8Array.from("ab"); }`,
      `export function f() { return Uint8Array.from([1, 2]); }`,
      `export function f() { return Uint8Array.of(1, 2); }`,
      `export function f() { return Uint8Array.of(null, undefined, true, "2"); }`,
      `export function f() { return BigInt64Array.of(1n); }`,
      `export function f() { return BigInt64Array.of("2"); }`,
      `export function f() { return BigInt64Array.of(true); }`,
    ]) {
      const r = call(src);
      expect(throwsBrand(r.throws, "TypeError"), src).toBe(false);
      expect(throwsBrand(r.throws, "SyntaxError"), src).toBe(false);
      expect(r.result && typeof r.result === "object" && "shape" in r.result, src).toBe(true);
    }
    expect(isBrand(call(`export function f() { return Uint8Array.from([1, 2]); }`).result, "Uint8Array")).toBe(true);
    expect(isBrand(call(`export function f() { return BigInt64Array.of(1n); }`).result, "BigInt64Array")).toBe(true);
  });

  it("gate 面：抽象 items → may TypeError（from）/ may 元素转换（of）", () => {
    const fromAny = evalEffects(`export function f(x) { return Uint8Array.from(x); }`, "f", [anyAbs]);
    expect(fromAny).toContain("TypeError");
    const ofAny = evalEffects(`export function f(x) { return Uint8Array.of(x); }`, "f", [anyAbs]);
    expect(ofAny).toContain("TypeError");
    const bigOfAny = evalEffects(`export function f(x) { return BigInt64Array.of(x); }`, "f", [anyAbs]);
    expect(bigOfAny).toContain("TypeError");
    // 非 nullish 可能的抽象 prim（number 约束参数）：ToObject 全定 → 不记
    const fromNum = evalEffects(`export function f(x) { return Uint8Array.from(x); }`, "f", [numParam]);
    expect(fromNum).toEqual([]);
  });

  it("身份路由面：BYTES_PER_ELEMENT 折宿主真值（NAMESPACE_GLOBALS 入表收益）", () => {
    const r = call(`export function f() { return Uint8Array.BYTES_PER_ELEMENT; }`);
    expect(r.result && typeof r.result === "object" && "shape" in r.result).toBe(true);
    const v = (r.result as { term?: { op?: string; value?: unknown } }).term;
    expect(v?.op === "lit" && v.value === 1).toBe(true);
  });
});
