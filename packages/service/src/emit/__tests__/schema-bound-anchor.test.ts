/**
 * schema 投影的 pred 必须锚定 self。回归背景：lengthBound 只认 `fn==="length"`、
 * numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被
 * 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。
 * 主路径 absToConstraint 会拒掉未锚定项（返回 undefined）；错在 fallback。
 *
 * eq 同类：eqLitValue 曾把裸 `op==="app"` 当已锚定——`eq(length(s),5)` 被投影成
 * `z.literal(5)`（数字字面量盖到字符串上），dropped 仍为空。锚定与 core
 * anchoredEqLit 同口径：只认 self var。
 */
import { describe, it, expect } from "vitest";
import { abs, app, eq, lit, v, ge, gt, SELF } from "@nudojs/core";
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

  // --- eq 路径（与 anchoredEqLit 同口径：只认 self var 锚定）---

  it("eq(length(self), 5) is not z.literal(5)", () => {
    const a = strWith(eq(app("length", [v("s")]), lit(5)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    const p = projectAbsToSchema(a);
    expect(p.source).toBe("z.string()");
    expect(p.dropped.length).toBeGreaterThan(0);
    expect(p.dropped.join("\n")).toContain("pred not projected");
  });

  it("eq(5, length(self)) reverse is not z.literal(5)", () => {
    const a = strWith(eq(lit(5), app("length", [v("s")])));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("eq(length(other), 5) is not a literal", () => {
    const a = strWith(eq(app("length", [v("other")]), lit(5)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("eq(get(self,\"x\"), 5) is not z.literal(5)", () => {
    const a = numWith(eq(app("get", [v("x"), lit("y")]), lit(5)));
    expect(absToSchemaSource(a)).toBe("z.number()");
    expect(projectAbsToSchema(a).source).toBe("z.number()");
  });

  it("eq(self, lit) still projects literal", () => {
    expect(absToSchemaSource(strWith(eq(v("s"), lit("ada"))))).toBe('z.literal("ada")');
    expect(absToSchemaSource(numWith(eq(v("x"), lit(42))))).toBe("z.literal(42)");
    expect(absToSchemaSource(strWith(eq(lit("ada"), v("s"))))).toBe('z.literal("ada")');
  });

  it("eq(__nudo_self__, lit) still projects literal (constraint path)", () => {
    expect(absToSchemaSource(strWith(eq(v(SELF), lit("ada"))))).toBe('z.literal("ada")');
    expect(absToSchemaSource(numWith(eq(v(SELF), lit(42))))).toBe("z.literal(42)");
  });
});
