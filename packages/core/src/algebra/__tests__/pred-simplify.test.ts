import { describe, it, expect } from "vitest";
import { and, or, gt, lt, eq, pTrue, pFalse, predToString } from "../pred.ts";
import { v, lit } from "../term.ts";

describe("pred and/or 化简（D3）", () => {
  it("and 去重：ms>0 ∧ ms>0 → ms>0", () => {
    const x = v("ms");
    const p = and(gt(x, lit(0)), gt(x, lit(0)));
    expect(predToString(p)).toBe("ms > 0");
  });

  it("and 嵌套展平后仍去重", () => {
    const x = v("ms");
    const p = and(and(gt(x, lit(0)), gt(x, lit(0))), gt(x, lit(0)));
    expect(predToString(p)).toBe("ms > 0");
  });

  it("or 去重", () => {
    const x = v("n");
    const p = or(eq(x, lit(1)), eq(x, lit(1)));
    expect(predToString(p)).toBe("n = 1");
  });

  it("不等谓词不去重", () => {
    const x = v("n");
    const p = and(gt(x, lit(0)), lt(x, lit(10)));
    expect(predToString(p)).toBe("n > 0 ∧ n < 10");
  });

  it("true/false 吸收不变", () => {
    const x = v("n");
    expect(and(pTrue, gt(x, lit(0)))).toEqual(gt(x, lit(0)));
    expect(and(pFalse, gt(x, lit(0)))).toEqual(pFalse);
  });
});
