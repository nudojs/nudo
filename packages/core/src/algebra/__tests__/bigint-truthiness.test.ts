/**
 * bigint 真值性（ToBoolean）回归。
 * 回归背景：JS 中 0n 为 falsy（Boolean(0n)===false、if (0n) 不进真分支、
 * !0n===true），但 litTruth / isDefinitelyTruthyShape 把「无字面量的
 * bigint prim」一律当恒真——`!x` 折 false、`if (x)` 只走真分支。
 * 同类：callbackTruth（class.ts）已按 0n falsy 处理，此处是漏网同型点。
 */
import { describe, it, expect } from "vitest";
import { notAbs } from "../surface.ts";
import { abs, litValue, numLit, bigintLit, boolLit } from "../abs.ts";
import { lit } from "../term.ts";
import { litTruth, isDefinitelyTrue } from "../exec/runtime/state.ts";

function bigPrim() {
  return abs({ k: "prim", type: "bigint" }, undefined, undefined, "path");
}

function bigLit(n: bigint) {
  return abs({ k: "prim", type: "bigint" }, lit(n as never), undefined, "exact");
}

describe("bigint ToBoolean (0n is falsy)", () => {
  it("litTruth of abstract bigint is unknown, not always-true", () => {
    expect(litTruth(bigPrim())).toBeUndefined();
  });

  it("litTruth of 0n literal is false", () => {
    expect(litTruth(bigLit(0n))).toBe(false);
  });

  it("litTruth of non-zero bigint literal is true", () => {
    expect(litTruth(bigLit(5n))).toBe(true);
    expect(litTruth(bigLit(-1n))).toBe(true);
  });

  it("isDefinitelyTrue must not treat abstract bigint as always-true", () => {
    expect(isDefinitelyTrue(bigPrim())).toBe(false);
  });

  it("!abstractBigint is unknown boolean, not exact false", () => {
    const r = notAbs(bigPrim());
    expect(r.shape).toEqual({ k: "prim", type: "boolean" });
    expect(litValue(r)).toEqual({ ok: false });
  });

  it("!0n is true; !5n is false", () => {
    expect(litValue(notAbs(bigLit(0n)))).toEqual({ ok: true, value: true });
    expect(litValue(notAbs(bigLit(5n)))).toEqual({ ok: true, value: false });
  });

  it("symbol remains always-truthy (0n-like hole does not exist)", () => {
    const sym = abs({ k: "prim", type: "symbol" }, undefined, undefined, "path");
    expect(litTruth(sym)).toBe(true);
  });

  it("number prim stays unknown (0 is falsy)", () => {
    expect(litValue(notAbs(numLit(0)))).toEqual({ ok: true, value: true });
    expect(litTruth(bigintLit(0n))).toBe(false);
    expect(litTruth(boolLit(false))).toBe(false);
  });
});
