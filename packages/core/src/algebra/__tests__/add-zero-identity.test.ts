/**
 * `x + 0` 代数恒等式回归。
 * 回归背景：simplifyTerm 把 `x + 0` / `0 + x` 折成 `x`，但 JS 中
 * `-0 + 0 === +0`（Object.is 与 1/(x) 可观察），且 any/string 参与 `+`
 * 是拼接（`"a" + 0 === "a0"`）。该恒等式与已删除的 `x * 0 = 0` 同族：
 * number 域含 -0，any 域含 string，恒等式不成立。
 * 同类：add() 的 any/sum 路径、toNumberResult 均经 simplifyTerm，
 * 会把 `x+0` 误认成 `x`，进而 strictEqAbs(same var) 折 true。
 */
import { describe, it, expect } from "vitest";
import {
  add,
  simplifyTerm,
  app,
  lit,
  v,
  numLit,
  numVar,
  strictEqAbs,
  litValue,
  runTranspiled,
  callTranspiledExportFull,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("x+0 identity is unsound", () => {
  it("simplifyTerm must not fold x+0 to x (-0 + 0 = +0)", () => {
    const t = simplifyTerm(app("+", [v("x"), lit(0)]));
    expect(t).not.toEqual(v("x"));
  });

  it("simplifyTerm must not fold 0+x to x", () => {
    const t = simplifyTerm(app("+", [lit(0), v("x")]));
    expect(t).not.toEqual(v("x"));
  });

  it("literal -0 + 0 still folds to +0 (not -0)", () => {
    const t = simplifyTerm(app("+", [lit(-0), lit(0)]));
    expect(t.op).toBe("lit");
    if (t.op === "lit") {
      expect(Object.is(t.value, 0)).toBe(true);
      expect(Object.is(t.value, -0)).toBe(false);
    }
  });

  it("add(any, 0) term must not be same var as the any operand", () => {
    const anyA = {
      shape: { k: "any" as const },
      term: v("A1"),
      conf: "path" as const,
    };
    const sum = add(anyA, numLit(0));
    expect(strictEqAbs(sum, anyA)).not.toBe(true);
  });

  it("evaluator (x+0)===(x) must not fold true (string concat / -0)", () => {
    const r = call(`export function f(x) { return (x + 0) === x; }`);
    expect(litValue(r.result)).not.toBe(true);
  });
});

describe("x-0 / x*1 keep working for pure numbers", () => {
  it("x-0 = x still holds for numeric terms", () => {
    expect(simplifyTerm(app("-", [v("x"), lit(0)]))).toEqual(v("x"));
  });

  it("x*1 = x still holds for numeric terms", () => {
    expect(simplifyTerm(app("*", [v("x"), lit(1)]))).toEqual(v("x"));
  });

  it("numVar + 0 still tracks as numeric add (not exact identity of -0)", () => {
    const r = add(numVar("x"), numLit(0));
    expect(r.shape).toEqual({ k: "prim", type: "number" });
    // 即使数值上 x+0≈x，项也不得抹掉 +0 的 -0→+0 归一
    expect(r.term).not.toEqual({ op: "var", id: "x" });
  });
});
