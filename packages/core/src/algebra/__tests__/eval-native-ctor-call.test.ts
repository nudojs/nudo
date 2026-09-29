/**
 * DEC-006A：原生构造器/函数收 Abs 导致 internal 清零（K2/K3 聚类 A）。
 *
 * 根因：$callNamed 把宿主构造器（BigInt / Error 家族 / Map…）当普通可调用
 * 对象直调，实参是 Abs 而非 JS 值——BigInt(absObj) 炸
 * "Cannot convert [object Object] to a BigInt"，AggregateError(absArr) 炸
 * "object is not iterable"，Map() 炸 "requires 'new'"。
 *
 * 修复：GLOBAL_FNS + hostBuiltinCtorName 身份兜底 → evalGlobalFn 统一分发
 * （lit 抽取 / 按 spec 转换 / errorBrandAbs），禁止裸宿主调用。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  setEvalFallbackCollector,
  type EvalFallback,
} from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function withFallbacks<T>(fn: () => T): { result: T; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { result: fn(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

function throwsName(t: unknown): string | undefined {
  const a = t as { shape?: { k?: string; name?: string } };
  return a?.shape?.k === "brand" ? a.shape.name : undefined;
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

describe("BigInt(x) ToBigInt conversion (K2)", () => {
  it("exact literal conversions", () => {
    expect(litValue(call(`export function f() { return BigInt(5); }`).result)).toBe(5n);
    expect(litValue(call(`export function f() { return BigInt("10"); }`).result)).toBe(10n);
    expect(litValue(call(`export function f() { return BigInt(5n); }`).result)).toBe(5n);
    expect(litValue(call(`export function f() { return BigInt('0x10'); }`).result)).toBe(16n);
    expect(litValue(call(`export function f() { return BigInt('0b101'); }`).result)).toBe(5n);
    expect(litValue(call(`export function f() { return BigInt(true); }`).result)).toBe(1n);
    expect(litValue(call(`export function f() { return BigInt(false); }`).result)).toBe(0n);
    expect(
      litValue(call(`export function f() { return BigInt('9007199254740993'); }`).result),
    ).toBe(9007199254740993n);
  });

  it("non-integer number → RangeError", () => {
    for (const src of [
      `export function f() { return BigInt(1.5); }`,
      `export function f() { return BigInt(42.5); }`,
      `export function f() { return BigInt(NaN); }`,
      `export function f() { return BigInt(Infinity); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("RangeError");
    }
  });

  it("unparseable string → SyntaxError", () => {
    for (const src of [
      `export function f() { return BigInt('x'); }`,
      `export function f() { return BigInt('abc'); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("SyntaxError");
    }
  });

  it("undefined/null/no-arg → TypeError", () => {
    for (const src of [
      `export function f() { return BigInt(); }`,
      `export function f() { return BigInt(undefined); }`,
      `export function f() { return BigInt(null); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("TypeError");
    }
  });

  it("no internal fallback on any BigInt call form", () => {
    const sources = [
      `export function f() { return BigInt(5); }`,
      `export function f() { return BigInt('10'); }`,
      `export function f() { return BigInt(1.5); }`,
      `export function f() { return BigInt('x'); }`,
      `export function f() { return BigInt(); }`,
    ];
    for (const src of sources) {
      const { fallbacks } = withFallbacks(() => call(src));
      expect(fallbacks.filter((f) => f.reason === "internal"), src).toEqual([]);
    }
  });
});

describe("Error family without new (K3)", () => {
  it("Error('x').message ≡ new Error('x').message", () => {
    expect(litValue(call(`export function f() { return Error('x').message; }`).result)).toBe("x");
    expect(litValue(call(`export function f() { return new Error('x').message; }`).result)).toBe("x");
  });

  it("TypeError('x').name ≡ new TypeError('x').name", () => {
    expect(litValue(call(`export function f() { return TypeError('x').name; }`).result)).toBe(
      "TypeError",
    );
  });

  it("AggregateError([],'x').message ≡ new AggregateError([],'x').message", () => {
    expect(
      litValue(call(`export function f() { return AggregateError([],'x').message; }`).result),
    ).toBe("x");
    expect(
      litValue(call(`export function f() { return AggregateError(['e1'],'x').errors[0]; }`).result),
    ).toBe("e1");
  });

  it("no internal fallback on Error-family call-without-new", () => {
    const sources = [
      `export function f() { return Error('x').message; }`,
      `export function f() { return TypeError('x').name; }`,
      `export function f() { return AggregateError([],'x').message; }`,
    ];
    for (const src of sources) {
      const { fallbacks } = withFallbacks(() => call(src));
      expect(fallbacks.filter((f) => f.reason === "internal"), src).toEqual([]);
    }
  });
});

describe("constructors requiring new throw TypeError (no internal)", () => {
  it("Map/Set/Promise/WeakMap/WeakSet without new → TypeError", () => {
    for (const src of [
      `export function f() { return Map(); }`,
      `export function f() { return Set(); }`,
      `export function f() { return Promise(()=>{}); }`,
      `export function f() { return WeakMap(); }`,
      `export function f() { return WeakSet(); }`,
    ]) {
      const { result: r, fallbacks } = withFallbacks(() => call(src));
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("TypeError");
      expect(fallbacks.filter((f) => f.reason === "internal"), src).toEqual([]);
    }
  });
});

describe("BigInt.asIntN / BigInt.asUintN", () => {
  it("exact conversions", () => {
    expect(litValue(call(`export function f() { return BigInt.asIntN(8, 255n); }`).result)).toBe(
      -1n,
    );
    expect(litValue(call(`export function f() { return BigInt.asIntN(8, 127n); }`).result)).toBe(
      127n,
    );
    expect(litValue(call(`export function f() { return BigInt.asUintN(8, 255n); }`).result)).toBe(
      255n,
    );
    expect(litValue(call(`export function f() { return BigInt.asUintN(8, -1n); }`).result)).toBe(
      255n,
    );
    expect(litValue(call(`export function f() { return BigInt.asIntN(8, 300n); }`).result)).toBe(
      44n,
    );
    expect(litValue(call(`export function f() { return BigInt.asUintN(8, 300n); }`).result)).toBe(
      44n,
    );
  });

  it("invalid bits → RangeError", () => {
    const r = call(`export function f() { return BigInt.asIntN(-1, 0n); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsName(r.throws)).toBe("RangeError");
  });

  it("aliased BigInt call also routes through builtin dispatch", () => {
    const { result: r, fallbacks } = withFallbacks(() =>
      call(`export function f() { const B = BigInt; return B(5); }`),
    );
    expect(litValue(r.result)).toBe(5n);
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
  });
});
