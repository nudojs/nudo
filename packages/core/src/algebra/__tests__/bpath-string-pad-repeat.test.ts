/**
 * 字符串 repeat/padStart/padEnd：此前一律折 strPrim（非具体）且不校验实参——
 * 'a'.repeat(3) 不折叠（精度缺口）；'a'.repeat(-1) 原生 RangeError 却折
 * strPrim + throws=never（check L2 漏报、catch 不可达）。
 * 修复：methods.ts callAbsMethod 字面量真执行（repeat 次数 ToIntegerOrInfinity
 * 截断、pad 长度 ToLength、缺省 fill=" "），非法实参硬抛 NudoThrow——
 * B 路径经 $catchVal 吸收、ast-eval 在 viaTable 调用点吸收为 EvalResult{threw}。
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

describe("B-path string repeat folding", () => {
  it("folds integer repeat", () => {
    expect(litValue(call(`export function f() { return 'a'.repeat(3); }`).result)).toBe("aaa");
    expect(litValue(call(`export function f() { return 'ab'.repeat(2); }`).result)).toBe("abab");
    expect(litValue(call(`export function f() { return 'a'.repeat(0); }`).result)).toBe("");
  });

  it("truncates fractional count via ToIntegerOrInfinity", () => {
    expect(litValue(call(`export function f() { return 'a'.repeat(2.5); }`).result)).toBe("aa");
    expect(litValue(call(`export function f() { return 'a'.repeat('2'); }`).result)).toBe("aa");
    expect(litValue(call(`export function f() { return 'a'.repeat(NaN); }`).result)).toBe("");
  });
});

describe("B-path string padStart/padEnd folding", () => {
  it("pads with explicit fill", () => {
    expect(litValue(call(`export function f() { return 'abc'.padStart(5, 'x'); }`).result)).toBe("xxabc");
    expect(litValue(call(`export function f() { return 'abc'.padStart(7, 'xy'); }`).result)).toBe("xyxyabc");
    expect(litValue(call(`export function f() { return 'ab'.padEnd(4, 'x'); }`).result)).toBe("abxx");
  });

  it("no-op when target <= length", () => {
    expect(litValue(call(`export function f() { return 'abc'.padStart(2, 'x'); }`).result)).toBe("abc");
    expect(litValue(call(`export function f() { return 'abc'.padStart(-1, 'x'); }`).result)).toBe("abc");
    expect(litValue(call(`export function f() { return 'abc'.padEnd(3, 'x'); }`).result)).toBe("abc");
  });

  it("defaults and coercions", () => {
    expect(litValue(call(`export function f() { return 'abc'.padStart(5); }`).result)).toBe("  abc");
    expect(litValue(call(`export function f() { return 'abc'.padStart('5', 'x'); }`).result)).toBe("xxabc");
    expect(litValue(call(`export function f() { return 'a'.padStart(3, 'xyz'); }`).result)).toBe("xya");
  });

  it("abstract args stay abstract", () => {
    const r = call(`export function f(x) { return x.repeat(3); }`);
    expect(litValue(r.result)).toBeUndefined();
    const r2 = call(`export function f(s, n) { return s.padStart(n, 'x'); }`);
    expect(litValue(r2.result)).toBeUndefined();
  });
});

describe("B-path string repeat/pad invalid args throw", () => {
  it("repeat negative / Infinity count throws RangeError", () => {
    for (const src of [
      `export function f() { return 'a'.repeat(-1); }`,
      `export function f() { return 'a'.repeat(Infinity); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "RangeError"), src).toBe(true);
    }
  });

  it("repeat -0.5 truncates to 0 (empty string)", () => {
    expect(litValue(call(`export function f() { return 'a'.repeat(-0.5); }`).result)).toBe("");
  });

  it("caught by try/catch", () => {
    for (const src of [
      `export function f() { try { 'a'.repeat(-1); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { 'ab'.repeat(Infinity); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("symbol args stay abstract on no-catch path", () => {
    // Symbol() 未建模为 symbol 字面量——保守非具体（不假精确、不硬抛）
    const r = call(`export function f() { return 'a'.repeat(Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
    const r2 = call(`export function f() { return 'a'.padStart(Symbol()); }`);
    expect(litValue(r2.result)).toBeUndefined();
  });
});

