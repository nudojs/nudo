import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, numVar, obj, type Abs } from "@nudojs/core";
import { and, gt, ge, eq } from "@nudojs/core";
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

  it("promise / fn / brand / unknown pass through without issues", () => {
    // checkNode 对 promise 是放行（同步投影不 unwrap thenable）。
    // 该分支曾与 unknown/fn/brand 共用 case 后又重复声明一次（死代码）——
    // 锁住放行语义，删重复 case 时不得改变行为。
    const passThrough = [
      { k: "promise" },
      { k: "fn" },
      { k: "brand", name: "Map" },
      { k: "unknown" },
    ] as const;
    const thenable = { then() {} };
    for (const node of passThrough) {
      const r = validateSchemaNode(node as never, thenable);
      expect(r.issues).toBeUndefined();
      expect(r.value).toBe(thenable);
    }
  });

  it("validates overlong tuple elements against rest (BUG-002)", () => {
    // [1, ...number]：超长元素必须满足 rest——合法放行、非法拒绝
    const withRest = abs(
      { k: "tuple", elements: [numLit(1)], rest: num() },
      undefined,
      undefined,
      "exact",
    );
    const { node } = absToSchemaNode(withRest);
    expect(validateSchemaNode(node, [1])).toEqual({ value: [1] });
    expect(validateSchemaNode(node, [1, 2, 3])).toEqual({ value: [1, 2, 3] });
    const bad = validateSchemaNode(node, [1, "x"]);
    expect(bad.issues).toBeDefined();
    expect(bad.issues![0]!.path).toEqual([1]);
    expect(bad.issues![0]!.message).toContain("number");
  });

  it("fixed tuple without rest keeps no-length-limit behavior (BUG-002)", () => {
    const fixed = abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact");
    const { node } = absToSchemaNode(fixed);
    // 现状语义：standard 面不设长度上限（zod 方言靠 z.tuple 定长）——锁住不回归
    expect(validateSchemaNode(node, [1, 2])).toEqual({ value: [1, 2] });
  });

  it("generated module inline __nudoCheck enforces rest on overlong elements (BUG-002)", () => {
    // 真执行生成模块（内嵌 CHECK_FN_SOURCE），不是只比对 validateSchemaNode
    const withRest = abs(
      { k: "tuple", elements: [numLit(1)], rest: num() },
      undefined,
      undefined,
      "exact",
    );
    const { source } = absToStandardSchema(withRest, { name: "t" });
    const js = source
      .replace(/export const (\w+)/g, "var $1")
      .replace(/} as const;/, "};");
    const mod = new Function(`${js}\nreturn t;`)() as {
      "~standard": { validate(value: unknown): unknown };
    };
    expect(mod["~standard"].validate([1, 2, 3])).toEqual({ value: [1, 2, 3] });
    const bad = mod["~standard"].validate([1, "x"]) as { issues: Array<{ path: PropertyKey[] }> };
    expect(bad.issues).toBeDefined();
    expect(bad.issues[0]!.path).toEqual([1]);
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

  it("projects literal contract domain for standard validators", () => {
    const { node } = absToSchemaNode(numLit(42));
    expect(validateSchemaNode(node, 42)).toEqual({ value: 42 });
    expect(validateSchemaNode(node, 41).issues?.[0]?.message).toContain("42");
  });

  it("projects union of literals from or-pred", () => {
    const u = numVar("x", { op: "or", args: [eq(v("x"), lit(1)), eq(v("x"), lit(2))] }, "exact");
    const { node } = absToSchemaNode(u);
    expect(validateSchemaNode(node, 1)).toEqual({ value: 1 });
    expect(validateSchemaNode(node, 2)).toEqual({ value: 2 });
    expect(validateSchemaNode(node, 3).issues).toBeDefined();
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
