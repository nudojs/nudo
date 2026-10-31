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
import { loadGeneratedModule } from "./fixtures.ts";

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

  it("promise 需真 Promise；unknown 放行；fn / brand 有运行时判据", () => {
    // BUG-025：`promise` 节点此前**放行一切**（非 Promise 也被接受 ⇒ 假绿，
    // Standard Schema 校验器接受 `42`）。现按 `instanceof Promise` 判定。
    // `unknown` 无约束 ⇒ 仍放行。
    // fn / brand 自 Bug 535 / 531 起**不再恒真**：fn 要 `typeof === "function"`、
    // brand（全局构造器）要 `instanceof` —— 与 zod 面同口径（z.function() /
    // z.instanceof(Date)）。
    const thenable = { then() {} };
    const promiseBad = validateSchemaNode({ k: "promise" } as never, thenable);
    expect(promiseBad.issues?.[0]?.message).toContain("expected promise");
    const promiseOk = validateSchemaNode({ k: "promise" } as never, Promise.resolve(1));
    expect(promiseOk.issues).toBeUndefined();
    const unknownOk = validateSchemaNode({ k: "unknown" } as never, thenable);
    expect(unknownOk.issues).toBeUndefined();
    expect(unknownOk.value).toBe(thenable);
    const fn = validateSchemaNode({ k: "fn" } as never, thenable);
    expect(fn.issues?.[0]?.message).toContain("expected function");
    const fnOk = validateSchemaNode({ k: "fn" } as never, () => 1);
    expect(fnOk.issues).toBeUndefined();
    const brand = validateSchemaNode({ k: "brand", name: "Map" } as never, thenable);
    expect(brand.issues?.[0]?.message).toContain("expected Map");
    const brandOk = validateSchemaNode({ k: "brand", name: "Map" } as never, new Map());
    expect(brandOk.issues).toBeUndefined();
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

  it("fixed tuple without rest enforces fixed arity (Bug 522)", () => {
    const fixed = abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact");
    const { node } = absToSchemaNode(fixed);
    // 定长元组：长度必须与 elements 一致（引擎 leqAbs 的 tuple arity 判定 +
    // zod 面 z.tuple 同口径）——旧语义「不设长度上限」是 Bug 522（假绿）。
    const over = validateSchemaNode(node, [1, 2]);
    expect(over.issues?.[0]?.message).toContain("expected tuple of length 1");
    expect(validateSchemaNode(node, [1])).toEqual({ value: [1] });
  });

  it("generated module inline __nudoCheck enforces rest on overlong elements (BUG-002)", async () => {
    // 真执行生成模块（内嵌 CHECK_FN_SOURCE），不是只比对 validateSchemaNode
    const withRest = abs(
      { k: "tuple", elements: [numLit(1)], rest: num() },
      undefined,
      undefined,
      "exact",
    );
    const { source } = absToStandardSchema(withRest, { name: "t" });
    const mod = await loadGeneratedModule(source);
    expect(mod.t!["~standard"].validate([1, 2, 3])).toEqual({ value: [1, 2, 3] });
    const bad = mod.t!["~standard"].validate([1, "x"]);
    expect(bad.issues).toBeDefined();
    expect(bad.issues![0]!.path).toEqual([1]);
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

describe("BUG-018: 缺键 ≠ 显式 undefined（S6-003 第 5 次同族）", () => {
  /** lit(undefined) 的 Abs：schema 投影为 { k: "lit", value: undefined }。 */
  const undefLitAbs = (): Abs =>
    abs({ k: "prim", type: "number" }, { op: "lit", value: undefined }, undefined, "exact");

  it("required slot typed undefined: 在场 undefined 通过，缺键报 required", () => {
    const o = obj({ a: { value: undefLitAbs() } });
    const { node } = absToSchemaNode(o);
    expect(validateSchemaNode(node, { a: undefined })).toEqual({ value: { a: undefined } });
    const missing = validateSchemaNode(node, {});
    expect(missing.issues?.[0]?.message).toBe("required");
    expect(missing.issues?.[0]?.path).toEqual(["a"]);
  });

  it("required slot T|undefined: 显式 undefined 走 union 的 undefined 臂", () => {
    const unionAbs = abs(
      { k: "sum", members: [num(), undefLitAbs()] },
      undefined,
      undefined,
      "exact",
    );
    const o = obj({ a: { value: unionAbs } });
    const { node } = absToSchemaNode(o);
    expect(validateSchemaNode(node, { a: undefined })).toEqual({ value: { a: undefined } });
    expect(validateSchemaNode(node, { a: 1 })).toEqual({ value: { a: 1 } });
    const bad = validateSchemaNode(node, { a: "x" });
    expect(bad.issues).toBeDefined();
  });

  it("required number 槽对 undefined 报类型错而非 required", () => {
    const o = obj({ a: { value: num() } });
    const { node } = absToSchemaNode(o);
    const r = validateSchemaNode(node, { a: undefined });
    expect(r.issues?.[0]?.message).toContain("expected number");
    expect(r.issues?.[0]?.message).not.toBe("required");
  });

  it("optional 槽：缺键与显式 undefined 皆合法，在场值仍校验", () => {
    const o = obj({ a: { value: num(), optional: true } });
    const { node } = absToSchemaNode(o);
    expect(validateSchemaNode(node, {})).toEqual({ value: {} });
    expect(validateSchemaNode(node, { a: undefined })).toEqual({ value: { a: undefined } });
    expect(validateSchemaNode(node, { a: 1 })).toEqual({ value: { a: 1 } });
    expect(validateSchemaNode(node, { a: "x" }).issues).toBeDefined();
  });

  it("内联校验源（CHECK_FN_SOURCE 副本）与 checkNode 同口径", async () => {
    const o = obj({ a: { value: undefLitAbs() } });
    const { source } = absToStandardSchema(o, { name: "t" });
    const mod = await loadGeneratedModule(source);
    expect(mod.t!["~standard"].validate({ a: undefined })).toEqual({ value: { a: undefined } });
    const missing = mod.t!["~standard"].validate({});
    expect(missing.issues?.[0]?.message).toBe("required");
    expect(missing.issues?.[0]?.path).toEqual(["a"]);
  });
});
