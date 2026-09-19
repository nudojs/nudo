import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, numVar, obj, type Abs } from "@nudojs/core";
import { and, gt, ge } from "@nudojs/core";
import { lit, v } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import {
  absToStandardSchema,
  absToStandardSchemaModule,
  validateSchemaNode,
} from "../standard-schema.ts";

const positiveNumber = (): Abs => numVar("x", and(gt(v("x"), lit(0))), "exact");

describe("validateSchemaNode", () => {
  it("accepts positive number bound and rejects 0", () => {
    const { node } = absToSchemaNode(positiveNumber());
    expect(validateSchemaNode(node, 1)).toEqual({ value: 1 });
    const bad = validateSchemaNode(node, 0);
    expect(bad.issues).toBeDefined();
    expect(bad.issues![0]!.message).toContain("gt 0");
  });

  it("checks int refinement", () => {
    const intPred = { op: "eq" as const, a: { op: "app" as const, fn: "%", args: [v("x"), lit(1)] }, b: lit(0) };
    const { node } = absToSchemaNode(numVar("x", and(intPred, ge(v("x"), lit(0))), "exact"));
    expect(validateSchemaNode(node, 2)).toEqual({ value: 2 });
    expect(validateSchemaNode(node, 2.5).issues?.[0]?.message).toContain("integer");
    expect(validateSchemaNode(node, -1).issues?.[0]?.message).toContain("ge 0");
  });

  it("checks object required slots and paths", () => {
    const o = obj({
      id: { value: positiveNumber() },
      name: { value: str() },
    });
    const { node } = absToSchemaNode(o);
    expect(validateSchemaNode(node, { id: 1, name: "a" })).toEqual({
      value: { id: 1, name: "a" },
    });
    const missing = validateSchemaNode(node, { name: "a" });
    expect(missing.issues?.[0]?.path).toEqual(["id"]);
    expect(missing.issues?.[0]?.message).toBe("required");
    const badId = validateSchemaNode(node, { id: 0, name: "a" });
    expect(badId.issues?.[0]?.path).toEqual(["id"]);
  });

  it("checks literals and unions", () => {
    const { node: litNode } = absToSchemaNode(numLit(42));
    expect(validateSchemaNode(litNode, 42)).toEqual({ value: 42 });
    expect(validateSchemaNode(litNode, 41).issues).toBeDefined();

    const unionAbs = abs(
      { k: "sum", members: [str(), num()] },
      undefined,
      undefined,
      "exact",
    );
    const { node: u } = absToSchemaNode(unionAbs);
    expect(validateSchemaNode(u, "a")).toEqual({ value: "a" });
    expect(validateSchemaNode(u, 1)).toEqual({ value: 1 });
    expect(validateSchemaNode(u, true).issues).toBeDefined();
  });
});

describe("absToStandardSchemaModule", () => {
  it("emits Standard Schema v1 shape with vendor nudo", () => {
    const { source } = absToStandardSchema(positiveNumber(), { name: "scaleArg0" });
    expect(source).toContain('"~standard"');
    expect(source).toContain("version: 1");
    expect(source).toContain('vendor: "nudo"');
    expect(source).toContain("export const scaleArg0");
    expect(source).toContain("__nudoCheck");
  });

  it("generated validate body matches validateSchemaNode for gt(0)", () => {
    // 提取模块里的 node JSON 并跑同一语义（源码内嵌 CHECK + node）
    const { source } = absToStandardSchema(positiveNumber(), { name: "s" });
    const m = source.match(/__nudoCheck\((\{.*?\}), value/s);
    expect(m).toBeTruthy();
    const node = JSON.parse(m![1]!) as Parameters<typeof validateSchemaNode>[0];
    expect(validateSchemaNode(node, 1)).toEqual({ value: 1 });
    expect(validateSchemaNode(node, 0).issues).toBeDefined();
  });

  it("multi-export module lists names", () => {
    const { source, dropped } = absToStandardSchemaModule({
      scaleOutput: num(),
      scaleArg0: positiveNumber(),
    });
    expect(source).toContain("export const scaleOutput");
    expect(source).toContain("export const scaleArg0");
    expect(Array.isArray(dropped)).toBe(true);
  });
});
