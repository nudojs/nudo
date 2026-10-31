/**
 * BUG-093 —— zod 面在 number **带数值 refinement** 时不放宽 ±Infinity ⇒
 * 导出的 schema **拒绝被导出函数自己的返回值**。
 *
 * 改前：`number().gt(0)` ⇒ `z.number().gt(0)`，而 zod v4 的 `z.number()` 只收
 * 有限数 ⇒ `Infinity`（`Infinity > 0` 成立）被拒；同一份源码的 standard / guard /
 * dts 三面都接受 ⇒ 跨面矛盾 + 消费方假红。
 *
 * 修法：按 refinement **逐条**判定（`int` 真的排除非有限值 ⇒ 不放宽；
 * `gt/ge/lt/le` 按数学比较 ⇒ 只放宽真正满足界限的那一端）。NaN 一律不放宽
 * （任何 numBound 对 NaN 都为假，与 standard / guard 同判据）。
 */
import { describe, it, expect } from "vitest";
import { abs, num, v, gt, ge, lt, le, lit, type Abs, type Pred } from "@nudojs/core";
import { absToSchemaSource, schemaNodeToZod } from "../schema-generator.ts";

const numWith = (pred: Pred): Abs =>
  abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, pred, "exact");

describe("BUG-093 — zod number + numBound 必须覆盖 ±Infinity 的合法端", () => {
  it("gt(0)：放宽 +Infinity，不放宽 -Infinity（-Infinity > 0 为假）", () => {
    const source = absToSchemaSource(numWith(gt(v("x"), lit(0))));
    expect(source).toContain("z.number().gt(0)");
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  });

  it("ge(5)：同上（+Infinity 满足 ge）", () => {
    const source = absToSchemaSource(numWith(ge(v("x"), lit(5))));
    expect(source).toContain("z.number().gte(5)");
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  });

  it("lt(5)：放宽 -Infinity，不放宽 +Infinity（+Infinity < 5 为假）", () => {
    const source = absToSchemaSource(numWith(lt(v("x"), lit(5))));
    expect(source).toContain("z.number().lt(5)");
    expect(source).toContain(".or(z.literal(-Infinity))");
    expect(source).not.toContain("z.literal(Infinity)");
  });

  it("le(5)：同上", () => {
    const source = absToSchemaSource(numWith(le(v("x"), lit(5))));
    expect(source).toContain("z.number().lte(5)");
    expect(source).toContain(".or(z.literal(-Infinity))");
    expect(source).not.toContain("z.literal(Infinity)");
  });

  it("int 真的排除非有限值 ⇒ 不放宽（`Number.isInteger(±Infinity)` 为假）", () => {
    // eq((x % 1), 0) 是引擎唯一认得的整性形态
    const intPred: Pred = {
      op: "eq",
      a: { op: "app", fn: "%", args: [{ op: "var", id: "x" }, { op: "lit", value: 1 }] },
      b: { op: "lit", value: 0 },
    };
    const source = absToSchemaSource(numWith(intPred));
    expect(source).toBe("z.number().int()");
  });

  it("多界合取：两端都满足才放宽对应端（gt(0) ∧ lt(10) ⇒ 两端都不满足）", () => {
    const both = {
      op: "and",
      args: [gt(v("x"), lit(0)), lt(v("x"), lit(10))],
    } as Pred;
    const source = absToSchemaSource(numWith(both));
    // +Infinity < 10 为假、-Infinity > 0 为假 ⇒ 不放宽任何一端（不得假绿）
    expect(source).toBe("z.number().gt(0).lt(10)");
  });

  it("多界合取：同为下界时只放宽 +Infinity（gt(0) ∧ ge(2)）", () => {
    const lowerBoth = {
      op: "and",
      args: [gt(v("x"), lit(0)), ge(v("x"), lit(2))],
    } as Pred;
    const source = absToSchemaSource(numWith(lowerBoth));
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  });

  it("负控制：无 refinement 的 number 仍放宽 NaN ∪ ±Infinity（Bug 1001 不回退）", () => {
    const source = absToSchemaSource(num());
    expect(source).toBe(
      "z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))",
    );
  });

  it("负控制：lit 精度不受影响", () => {
    const lit42 = abs(
      { k: "prim", type: "number" },
      { op: "lit", value: 42 },
      undefined,
      "exact",
    );
    expect(schemaNodeToZod({ k: "prim", type: "number", refinements: [] })).toContain("z.nan()");
    expect(absToSchemaSource(lit42)).toBe("z.literal(42)");
  });
});
