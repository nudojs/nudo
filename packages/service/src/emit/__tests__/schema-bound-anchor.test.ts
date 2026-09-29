/**
 * schema 投影的 pred 必须锚定 self。回归背景：lengthBound 只认 `fn==="length"`、
 * numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被
 * 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。
 * 主路径 absToConstraint 会拒掉未锚定项（返回 undefined）；错在 fallback。
 */
import { describe, it, expect } from "vitest";
import { abs, app, lit, v, ge, gt, SELF } from "@nudojs/core";
import { absToSchemaSource, projectAbsToSchema } from "../schema-generator.ts";

const strWith = (pred: Parameters<typeof abs>[2]) =>
  abs({ k: "prim", type: "string" }, { op: "var", id: "s" }, pred, "exact");
const numWith = (pred: Parameters<typeof abs>[2]) =>
  abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, pred, "exact");

describe("schema length/bound anchoring", () => {
  it("length(other) is not a string min", () => {
    const a = strWith(ge(app("length", [v("other")]), lit(1)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("gt(other, 0) is not a number bound", () => {
    const a = numWith(gt(v("other"), lit(0)));
    expect(absToSchemaSource(a)).toBe("z.number()");
    expect(projectAbsToSchema(a).source).toBe("z.number()");
  });

  it("length(self var) still projects min", () => {
    // fallback 路径（absToConstraint 对 length(s) 会改写为 __nudo_self__；
    // 这里直接断言锚定 length(s) 仍可投影）
    const a = strWith(ge(app("length", [v("s")]), lit(1)));
    expect(absToSchemaSource(a)).toBe("z.string().min(1)");
  });

  it("length(__nudo_self__) projects min (constraint path)", () => {
    const a = strWith(ge(app("length", [v(SELF)]), lit(1)));
    expect(absToSchemaSource(a)).toBe("z.string().min(1)");
  });

  it("gt(self var) still projects bound", () => {
    const a = numWith(gt(v("x"), lit(0)));
    expect(absToSchemaSource(a)).toBe("z.number().gt(0)");
  });
});
