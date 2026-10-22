/**
 * Bug 859 回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。
 *
 * 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉
 * `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法**
 * 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?`
 * ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。
 *
 * 改后：与 core 的 `constraintToEntryAbs` 同口径，把 optional 写进槽位。
 */
import { describe, it, expect } from "vitest";
import { formatAbs } from "@nudojs/core";
import { parseCaseArgExpr } from "../directives.ts";

function slotsOf(expr: string): Record<string, { value: unknown; optional?: boolean }> {
  const abs = parseCaseArgExpr(expr);
  expect(abs.shape.k).toBe("obj");
  if (abs.shape.k !== "obj") throw new Error(`not an object: ${expr}`);
  return abs.shape.slots;
}

describe("Bug 859: shape optional flag is projected into the case-arg slot", () => {
  it("shape({ a: number().optional() }) → optional slot", () => {
    const slots = slotsOf("shape({ a: number().optional() })");
    expect(slots.a!.optional).toBe(true);
    // 展示面同步带出 `?`
    expect(formatAbs(parseCaseArgExpr("shape({ a: number().optional() })"))).toContain("?");
  });

  it("partial(shape({ a: number() })) → optional slot", () => {
    const slots = slotsOf("partial(shape({ a: number() }))");
    expect(slots.a!.optional).toBe(true);
  });

  it("required field stays required (no over-widening)", () => {
    const slots = slotsOf("shape({ a: number() })");
    expect(slots.a!.optional).toBeUndefined();
    expect(formatAbs(parseCaseArgExpr("shape({ a: number() })"))).not.toContain("?");
  });

  it("mixed shape keeps per-field optional flags", () => {
    const slots = slotsOf("shape({ a: number().optional(), b: string() })");
    expect(slots.a!.optional).toBe(true);
    expect(slots.b!.optional).toBeUndefined();
  });
});
