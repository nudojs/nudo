/**
 * Bug 1001 —— zod 方言把 Abs 的 `number` prim 投影成 `z.number()`，而
 * **zod 的 `number` 排除 NaN / ±Infinity**（Abs 的 `number` prim 域**含**它们）
 * ⇒ 导出的 schema **拒绝被导出函数自己的返回值** ⇒ 消费方假红。
 *
 * 域差（原生事实）：
 * - `typeof NaN === "number"` ⇒ Abs 的 number prim 域含 NaN
 *   （standard / guard / 门禁三面同口径：门禁渲染 `nanZero() => NaN`）；
 * - zod v4 的 `z.number()` 的 parse 是
 *   `typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)`
 *   ⇒ 只收**有限数** ⇒ `z.number()` 是**收窄**映射（不是合法超近似）。
 *
 * 修法：zod 侧的 `number` prim（**无 refinement**）放宽成
 * 「有限数 ∪ NaN ∪ ±Infinity」。带 refinement 的 number **不放宽**
 * （`x > 5` / `Number.isInteger(x)` 已把非有限值排除 ⇒ 放宽反而是收窄）。
 *
 * 跨片不变量（**不得**破坏）：standard 面的节点形态不变（仍是
 * `{"k":"prim","type":"number"}`——S4 明确不采纳「number 加 Number.isFinite」，
 * 本片只改 **zod 渲染**，不改共享节点）。
 */
import { describe, it, expect } from "vitest";
import { abs, num, v, gt, lit, type Abs, type Pred } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";

const numWith = (pred: Pred): Abs => abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, pred, "exact");

describe("Bug 1001 — zod 的 number prim 必须覆盖 Abs 的全部 JS number 域", () => {
  it("原生域前提：NaN / ±Infinity 都是 number（Abs 域含之）", () => {
    expect(typeof NaN).toBe("number");
    expect(typeof Infinity).toBe("number");
    expect(typeof -Infinity).toBe("number");
    // zod 的 z.number() 只收有限数 ⇒ 收窄
    expect(Number.isFinite(NaN)).toBe(false);
    expect(Number.isFinite(Infinity)).toBe(false);
  });

  it("无 refinement 的 number prim 渲染成放宽形态（不再收窄）", () => {
    const source = absToSchemaSource(num());
    expect(source).not.toBe("z.number()");
    expect(source).toContain("z.number()");
    expect(source).toContain("z.nan()");
    expect(source).toContain("z.literal(Infinity)");
    expect(source).toContain("z.literal(-Infinity)");
  });

  it("带 numBound 的 number prim 只放宽满足该界的那一端（BUG-093 收口）", () => {
    // `x > 5` 对 Infinity 为真、对 -Infinity 为假 ⇒ 只放宽 +Infinity
    // （`z.number()` 只收有限数 ⇒ 不放宽即**收窄**，见 BUG-093）。
    expect(absToSchemaSource(numWith(gt(v("x"), lit(5))))).toBe(
      "z.number().gt(5).or(z.literal(Infinity))",
    );
  });

  it("共享节点形态不变（standard 面不受影响——S4 的决定）", () => {
    const { node } = absToSchemaNode(num());
    expect(node).toEqual({ k: "prim", type: "number", refinements: [] });
  });

  it("lit NaN 的兜底投影覆盖 NaN 域（不再假红）", () => {
    // lit NaN 不可表达 ⇒ dropped + 兜底；兜底必须覆盖 NaN 的域
    const nanLit = abs({ k: "prim", type: "number" }, { op: "lit", value: NaN }, undefined, "exact");
    const { node, dropped } = absToSchemaNode(nanLit);
    expect(dropped.some((d) => d.includes("NaN"))).toBe(true);
    expect(node).toEqual({ k: "prim", type: "number", refinements: [] });
    const source = absToSchemaSource(nanLit);
    expect(source).toContain("z.nan()");
  });

  it("负控制：lit 精度的 number 仍投影成字面量（不牵连邻近形态）", () => {
    const lit42 = abs({ k: "prim", type: "number" }, { op: "lit", value: 42 }, undefined, "exact");
    expect(absToSchemaSource(lit42)).toBe("z.literal(42)");
  });
});
