/**
 * formatShape 字面量展示保真。
 * 回归背景：lit(null) 落在 unknown 形状上，旧逻辑只特判 lit(undefined)，
 * null 被渲染成 "unknown"，与真 unknown 混淆。同类：-0 经 JSON.stringify
 * 抹成 "0"，与 1/x、Object.is 的可观察差异不一致（term.ts 明确要求保真）。
 */
import { describe, it, expect } from "vitest";
import { abs, lit, numLit, formatShape, formatAbs, unknown } from "../index.ts";

function nullLit() {
  return abs({ k: "unknown" }, lit(null), undefined, "exact");
}
function undefLit() {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

describe("formatShape literal fidelity", () => {
  it("lit(null) displays as null, not unknown", () => {
    expect(formatShape(nullLit())).toBe("null");
  });

  it("lit(undefined) still displays as undefined", () => {
    expect(formatShape(undefLit())).toBe("undefined");
  });

  it("bare unknown (no lit) stays unknown", () => {
    expect(formatShape(unknown)).toBe("unknown");
  });

  it("-0 displays as -0, not 0", () => {
    expect(formatShape(numLit(-0))).toBe("-0");
    expect(formatAbs(numLit(-0))).toContain("-0");
  });

  it("+0 still displays as 0", () => {
    expect(formatShape(numLit(0))).toBe("0");
  });

  it("NaN / Infinity keep JS spelling", () => {
    expect(formatShape(numLit(NaN))).toBe("NaN");
    expect(formatShape(numLit(Infinity))).toBe("Infinity");
    expect(formatShape(numLit(-Infinity))).toBe("-Infinity");
  });

  it("null inside arr / obj slots also displays as null", () => {
    const arr = abs(
      { k: "arr", element: nullLit() },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(arr)).toBe("null[]");
    const obj = abs(
      { k: "obj", slots: { a: { value: nullLit() } } },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(obj)).toBe("{ a: null }");
  });
});
