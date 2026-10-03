/**
 * Math 原生折叠 catch 的截断观测回归。
 * 回归背景：evalMathMethod 三处 `catch { return numPrim(); }`（min/max 全字面量
 * 折叠 / rounding 折叠 / 通用 impl 折叠）把「宿主篡改/环境分叉的 Math.* 抛错」
 * 静默拓宽成 number prim——与 promise.ts noteAbsTruncation 先例同口径，
 * 拓宽必须经 collector 可观测，check 映射 nudo:math-fold-error（不得误报
 * recursion-truncated）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { evalMathMethod } from "../builtins/math.ts";
import { setAbsTruncationCollector, MATH_FOLD_ERROR_LABEL } from "../call-budget.ts";
import { numLit, litValue, checkSource, pTrue } from "@nudojs/core";

const origMin = Math.min;
const origRound = Math.round;
const origHypot = Math.hypot;
const prevCollector = setAbsTruncationCollector(null);

afterEach(() => {
  Math.min = origMin;
  Math.round = origRound;
  Math.hypot = origHypot;
  setAbsTruncationCollector(prevCollector);
});

describe("Math native fold throw → widening is observable", () => {
  it("tampered Math.min widens to number prim and records truncation", () => {
    Math.min = (() => {
      throw new Error("tampered");
    }) as typeof Math.min;
    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    const r = evalMathMethod("min", [numLit(1), numLit(2)]);
    expect(r).toBeDefined();
    expect(r!.shape.k).toBe("prim");
    if (r!.shape.k === "prim") expect(r!.shape.type).toBe("number");
    expect(litValue(r!).ok).toBe(false);
    expect(seen).toContain(MATH_FOLD_ERROR_LABEL);
  });

  it("tampered Math.round (rounding fold) records truncation", () => {
    Math.round = (() => {
      throw new Error("tampered");
    }) as typeof Math.round;
    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    const r = evalMathMethod("round", [numLit(2.5)]);
    expect(r).toBeDefined();
    expect(litValue(r!).ok).toBe(false);
    expect(seen).toContain(MATH_FOLD_ERROR_LABEL);
  });

  it("tampered Math.hypot (generic impl fold) records truncation", () => {
    Math.hypot = (() => {
      throw new Error("tampered");
    }) as typeof Math.hypot;
    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    const r = evalMathMethod("hypot", [numLit(3), numLit(4)]);
    expect(r).toBeDefined();
    expect(litValue(r!).ok).toBe(false);
    expect(seen).toContain(MATH_FOLD_ERROR_LABEL);
  });

  it("untampered Math records nothing", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    const r = evalMathMethod("min", [numLit(3), numLit(-1), numLit(2)]);
    expect(litValue(r!)).toEqual({ ok: true, value: -1 });
    expect(seen).not.toContain(MATH_FOLD_ERROR_LABEL);
  });

  it("check maps the label to nudo:math-fold-error (info), not recursion-truncated", () => {
    Math.min = (() => {
      throw new Error("tampered");
    }) as typeof Math.min;
    const r = checkSource(
      "/t/math-fold.js",
      `export function f() { return Math.min(1, 2); }`,
      pTrue,
    );
    const hit = r.issues.filter((i) => i.code === "nudo:math-fold-error");
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(hit[0]!.severity).toBe("info");
    expect(r.issues.some((i) => i.code === "nudo:recursion-truncated")).toBe(false);
  });
});
