/**
 * `% 0` 与 `x % k` 数值界回归。
 * 回归背景：mod 把 `n % 0` 折成抽象 number（原生恒 NaN，应 exact NaN）；
 * 且对 `x % k` 无条件挂 `(-|k|, |k|)` 开界——但 `Infinity % 5`、`NaN % 5`
 * 皆为 NaN，不在 (-5,5) 内。与 `x*0` 同族：number 域含 NaN/±Inf，
 * 该界对非有限被除数不成立。
 * 同类：div/mul 对 k=0 的字面量路径已保真；mod 的 vb===0 特判是漏网点。
 */
import { describe, it, expect } from "vitest";
import {
  mod,
  numLit,
  numVar,
  litValue,
  predToString,
  runTranspiled,
  callTranspiledExportFull,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("mod by zero folds to exact NaN", () => {
  it("5 % 0 is exact NaN", () => {
    const r = mod(numLit(5), numLit(0));
    const lv = litValue(r);
    expect(Number.isNaN(lv.ok ? lv.value : undefined)).toBe(true);
    expect(r.conf).toBe("exact");
  });

  it("0 % 0 / -3 % 0 / NaN % 0 / Infinity % 0 are exact NaN", () => {
    for (const a of [0, -3, NaN, Infinity, -Infinity]) {
      const r = mod(numLit(a), numLit(0));
      const lv = litValue(r);
      expect(Number.isNaN(lv.ok ? lv.value : undefined), String(a)).toBe(true);
    }
  });

  it("evaluator 5 % 0 folds to NaN", () => {
    const r = call(`export function f() { return 5 % 0; }`).result;
    const lv = litValue(r);
    expect(Number.isNaN(lv.ok ? lv.value : undefined)).toBe(true);
    expect(r.conf).toBe("exact");
  });

  it("x % 0 for numeric var is exact NaN (any number % 0)", () => {
    const r = mod(numVar("x"), numLit(0));
    const lv = litValue(r);
    expect(Number.isNaN(lv.ok ? lv.value : undefined)).toBe(true);
    expect(r.conf).toBe("exact");
  });
});

describe("x % k bounds must not exclude NaN", () => {
  it("unconstrained x % 5 must not claim (-5,5) — Inf%5 is NaN", () => {
    const r = mod(numVar("x"), numLit(5));
    const p = r.pred ? predToString(r.pred) : "";
    expect(p.includes("-5") && p.includes("5")).toBe(false);
  });

  it("finite-bounded x % 5 may keep (-5,5)", () => {
    // x ∈ [0, 10] 有限 ⇒ x%5 ∈ (-5,5) 且非 NaN
    const x = {
      shape: { k: "prim", type: "number" } as const,
      term: { op: "var" as const, id: "x" },
      pred: {
        op: "and" as const,
        args: [
          { op: "ge" as const, a: { op: "var" as const, id: "x" }, b: { op: "lit" as const, value: 0 } },
          { op: "le" as const, a: { op: "var" as const, id: "x" }, b: { op: "lit" as const, value: 10 } },
        ],
      },
      conf: "path" as const,
    };
    const r = mod(x, numLit(5));
    const p = r.pred ? predToString(r.pred) : "";
    expect(p.includes("-5")).toBe(true);
    expect(p.includes("5")).toBe(true);
  });

  it("evaluator Infinity % 5 is NaN (native parity)", () => {
    const r = call(`export function f() { return Infinity % 5; }`).result;
    const lv = litValue(r);
    expect(Number.isNaN(lv.ok ? lv.value : undefined)).toBe(true);
  });
});
