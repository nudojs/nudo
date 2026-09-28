/**
 * split(undefined, limit)：limit 走 ToUint32，不是 Number(lim)>0
 *   "abc".split(undefined, 0.5)   原生 []（ToUint32(0.5)=0）
 *   "abc".split(undefined, -1)    原生 ["abc"]（ToUint32(-1)=2^32-1）
 *   "abc".split(undefined, Infinity) 原生 []（ToUint32(Inf)=0）
 * 缺省/显式 undefined limit → 2^32-1（不是 ToUint32(undefined)=0）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function json(src: string) {
  const exports = runTranspiled(`export function f() { return JSON.stringify(${src}); }`, {
    mode: "exec",
    maxLoopIters: 2000,
  });
  return litValue(callTranspiledExportFull(exports, "f", []).result);
}

describe("split(undefined, limit) uses ToUint32", () => {
  it("limit 0.5 → ToUint32 0 → []", () => {
    expect(json(`"abc".split(undefined, 0.5)`)).toBe("[]");
    expect(json(`"abc".split(undefined, 0.9)`)).toBe("[]");
  });

  it("limit -1 / -1.5 → ToUint32 2^32-1 → [\"abc\"]", () => {
    expect(json(`"abc".split(undefined, -1)`)).toBe('["abc"]');
    expect(json(`"abc".split(undefined, -1.5)`)).toBe('["abc"]');
  });

  it("limit -0.5 → ToUint32 0 → [] (truncate(-0.5)=0)", () => {
    expect(json(`"abc".split(undefined, -0.5)`)).toBe("[]");
    expect(json(`"abc".split(undefined, -0)`)).toBe("[]");
  });

  it("limit Infinity / -Infinity → ToUint32 0 → []", () => {
    expect(json(`"abc".split(undefined, Infinity)`)).toBe("[]");
    expect(json(`"abc".split(undefined, -Infinity)`)).toBe("[]");
  });

  it("integer limits 0/1/2 unchanged", () => {
    expect(json(`"abc".split(undefined, 0)`)).toBe("[]");
    expect(json(`"abc".split(undefined, 1)`)).toBe('["abc"]');
    expect(json(`"abc".split(undefined, 2)`)).toBe('["abc"]');
  });
});
