import { describe, it, expect } from "vitest";
import {
  abs,
  num,
  str,
  numLit,
  strLit,
  boolLit,
  numVar,
  obj,
  type Abs,
  type Pred,
} from "@nudojs/core";
import { and, eq, ge, gt, le, ptypeof } from "@nudojs/core";
import { app, lit, v } from "@nudojs/core";
import {
  absToSchemaNode,
  absToSchemaSource,
  absToZodSchemaModule,
  projectAbsToSchema,
} from "../schema-generator.ts";

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");
const nullLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const undefLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
const numWith = (pred: Pred): Abs => numVar("x", pred, "exact");
const strWith = (pred: Pred): Abs =>
  abs({ k: "prim", type: "string" }, { op: "var", id: "s" }, pred, "exact");

describe("schema-generator", () => {
  it("generates z.string() for string type", () => {
    expect(absToSchemaSource(str())).toBe("z.string()");
  });

  it("generates z.number() for number type", () => {
    expect(absToSchemaSource(num())).toBe("z.number()");
  });

  it("generates z.literal() for literal types", () => {
    expect(absToSchemaSource(strLit("hello"))).toBe('z.literal("hello")');
    expect(absToSchemaSource(numLit(42))).toBe("z.literal(42)");
    expect(absToSchemaSource(boolLit(true))).toBe("z.literal(true)");
  });

  it("generates z.object() for object types", () => {
    const o = obj({ name: { value: str() }, age: { value: num() } });
    expect(absToSchemaSource(o)).toBe("z.object({ name: z.string(), age: z.number() })");
  });

  it("generates optional object slots", () => {
    const o = abs(
      {
        k: "obj",
        slots: {
          name: { value: str() },
          nick: { value: str(), optional: true },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    expect(absToSchemaSource(o)).toBe("z.object({ name: z.string(), nick: z.string().optional() })");
  });

  it("generates z.array() for array types", () => {
    expect(absToSchemaSource(arrOf(str()))).toBe("z.array(z.string())");
  });

  it("generates z.union() for union types", () => {
    expect(absToSchemaSource(unionOf(str(), num()))).toBe("z.union([z.string(), z.number()])");
  });

  it("generates z.null() and z.undefined()", () => {
    expect(absToSchemaSource(nullLit())).toBe("z.null()");
    expect(absToSchemaSource(undefLit())).toBe("z.undefined()");
  });

  it("projects tuple holes as z.unknown() and records them in dropped (BUG-020)", () => {
    // hole 槽 ≠ 显式 undefined 槽：zod tuple 无空槽概念，
    // 洞映射 z.unknown() 并计入 dropped，不得写成 z.undefined()
    const sparse = abs(
      { k: "tuple", elements: [numLit(1), undefLit(), numLit(3)], holes: [1] },
      undefined,
      undefined,
      "exact",
    );
    const dense = abs(
      { k: "tuple", elements: [numLit(1), undefLit(), numLit(3)] },
      undefined,
      undefined,
      "exact",
    );
    const sparseP = projectAbsToSchema(sparse);
    const denseP = projectAbsToSchema(dense);
    expect(sparseP.source).toBe("z.tuple([z.literal(1), z.unknown(), z.literal(3)])");
    expect(denseP.source).toBe("z.tuple([z.literal(1), z.undefined(), z.literal(3)])");
    expect(sparseP.source).not.toBe(denseP.source);
    expect(sparseP.dropped.some((d) => d.includes("hole") && d.includes("1"))).toBe(true);
    expect(denseP.dropped.some((d) => d.includes("hole"))).toBe(false);
  });

  it("projects leading/multi tuple holes and counts each in dropped (BUG-020)", () => {
    const multi = abs(
      { k: "tuple", elements: [undefLit(), numLit(1), undefLit()], holes: [0, 2] },
      undefined,
      undefined,
      "exact",
    );
    const p = projectAbsToSchema(multi);
    expect(p.source).toBe("z.tuple([z.unknown(), z.literal(1), z.unknown()])");
    const holeNotes = p.dropped.filter((d) => d.includes("hole"));
    expect(holeNotes).toHaveLength(2);
    expect(holeNotes.some((d) => d.includes("0"))).toBe(true);
    expect(holeNotes.some((d) => d.includes("2"))).toBe(true);
  });

  it("projects tuple rest as z.tuple(...).rest(...) without dropped note (BUG-002)", () => {
    // rest 槽不得静默丢弃：zod 3/4 均支持 .rest()；无投影损失则无 dropped 记录
    const withRest = abs(
      { k: "tuple", elements: [numLit(1)], rest: num() },
      undefined,
      undefined,
      "exact",
    );
    const p = projectAbsToSchema(withRest);
    expect(p.source).toBe("z.tuple([z.literal(1)]).rest(z.number())");
    expect(p.dropped).toEqual([]);
    // 固定元组渲染保持不变
    const fixed = abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact");
    expect(projectAbsToSchema(fixed).source).toBe("z.tuple([z.literal(1)])");
  });

  it("absToSchemaNode carries rest slot with its refinements (BUG-002)", () => {
    const withRest = abs(
      { k: "tuple", elements: [numLit(1)], rest: numVar("x", and(gt(v("x"), lit(0)), ptypeof(v("x"), "number")), "exact") },
      undefined,
      undefined,
      "exact",
    );
    const { node, dropped } = absToSchemaNode(withRest);
    if (node.k !== "tuple") throw new Error("expected tuple node");
    // rest 槽照常走 prim 投影（含 refinement），不再整槽丢弃
    expect(node.rest).toEqual({
      k: "prim",
      type: "number",
      refinements: [{ kind: "numBound", op: "gt", n: 0 }],
    });
    expect(dropped).toEqual([]);
  });
});

describe("pred → zod refinements", () => {
  it("projects number constant bounds", () => {
    const a = numWith(and(gt(v("x"), lit(0)), ptypeof(v("x"), "number")));
    expect(absToSchemaSource(a)).toBe("z.number().gt(0)");
  });

  it("projects eq(self, lit) as z.literal (core projection parity)", () => {
    const a = numWith(eq(v("x"), lit(42)));
    expect(absToSchemaSource(a)).toBe("z.literal(42)");
    const s = absToSchemaSource(strWith(eq(v("s"), lit("ada"))));
    expect(s).toBe('z.literal("ada")');
  });

  it("projects or-pred literal unions", () => {
    const a = numWith({ op: "or", args: [eq(v("x"), lit(1)), eq(v("x"), lit(2))] });
    expect(absToSchemaSource(a)).toBe("z.union([z.literal(1), z.literal(2)])");
  });

  it("projects ge/lt/le with zod gte/lte names", () => {
    expect(absToSchemaSource(numWith(ge(v("x"), lit(0))))).toBe("z.number().gte(0)");
    expect(absToSchemaSource(numWith(le(v("x"), lit(100))))).toBe("z.number().lte(100)");
    expect(absToSchemaSource(numWith({ op: "lt", a: v("x"), b: lit(5) }))).toBe("z.number().lt(5)");
  });

  it("projects int + bound", () => {
    // int 编码：x % 1 === 0
    const intPred = eq(
      { op: "app", fn: "%", args: [v("x"), lit(1)] },
      lit(0),
    );
    const a = numWith(and(intPred, ge(v("x"), lit(0))));
    expect(absToSchemaSource(a)).toBe("z.number().int().gte(0)");
  });

  it("projects string length bounds", () => {
    const a = strWith(ge(app("length", [v("s")]), lit(1)));
    expect(absToSchemaSource(a)).toBe("z.string().min(1)");
  });

  it("drops symbolic preds into notes, keeps base shape", () => {
    const a = numWith({ op: "gt", a: v("x"), b: v("y") });
    const p = projectAbsToSchema(a);
    expect(p.source).toBe("z.number()");
    expect(p.dropped.length).toBeGreaterThan(0);
    expect(p.dropped[0]).toContain("pred not projected");
  });

  it("projects refinements inside object slots", () => {
    const o = obj({
      id: { value: numWith(and(gt(v("x"), lit(0)), ptypeof(v("x"), "number"))) },
      name: { value: str() },
    });
    expect(absToSchemaSource(o)).toBe(
      "z.object({ id: z.number().gt(0), name: z.string() })",
    );
  });
});

describe("absToSchemaSource / dialect", () => {
  it("defaults to zod dialect", () => {
    const a = numWith(gt(v("x"), lit(0)));
    expect(absToSchemaSource(a)).toBe(absToSchemaSource(a, { dialect: "zod" }));
    expect(absToSchemaSource(a, { dialect: "zod" })).toBe("z.number().gt(0)");
  });

  it("projectAbsToSchema reports dialect", () => {
    const p = projectAbsToSchema(num(), { dialect: "zod" });
    expect(p.dialect).toBe("zod");
    expect(p.source).toBe("z.number()");
  });
});

describe("absToZodSchemaModule", () => {
  it("emits an importable zod JS module", () => {
    const { source, dialect, dropped } = absToZodSchemaModule({
      scaleInput: obj({ x: { value: num() } }),
      scaleOutput: numWith(gt(v("x"), lit(0))),
    });
    expect(dialect).toBe("zod");
    expect(dropped).toEqual([]);
    expect(source).toContain("// @generated by nudo export --format schema");
    expect(source).toContain('import { z } from "zod";');
    expect(source).toContain("export const scaleInput = z.object({ x: z.number() });");
    expect(source).toContain("export const scaleOutput = z.number().gt(0);");
  });

  it("lists dropped preds as comments", () => {
    const unprojectable = numWith({ op: "or", args: [gt(v("x"), lit(0)), gt(v("x"), lit(1))] });
    const { source, dropped } = absToZodSchemaModule({ aOutput: unprojectable });
    expect(dropped.length).toBeGreaterThan(0);
    expect(source).toContain("// dropped preds (not projected into zod):");
    expect(source).toContain("export const aOutput =");
  });

  it("sanitizes non-identifier export names", () => {
    const { source } = absToZodSchemaModule({ "weird name": num() });
    expect(source).toContain("export const weird_name = z.number();");
  });
});

describe("BUG-019: eqLit 通道 tagged 化 + 非有限界不投影（S6-004）", () => {
  it("eq(x, lit(undefined)) 投影为 z.undefined() 而非静默丢弃", () => {
    const a = numWith(eq(v("x"), lit(undefined)));
    const { node, dropped } = absToSchemaNode(a);
    expect(node).toEqual({ k: "lit", value: undefined });
    expect(dropped).toEqual([]);
    expect(absToSchemaSource(a)).toBe("z.undefined()");
  });

  it("双 eq(x, lit(undefined)) 不误报 conflicting", () => {
    const a = numWith(and(eq(v("x"), lit(undefined)), eq(v("x"), lit(undefined))));
    const { node, dropped } = absToSchemaNode(a);
    expect(node).toEqual({ k: "lit", value: undefined });
    expect(dropped.some((d) => d.includes("conflicting"))).toBe(false);
  });

  it("eq(x,5) 与 eq(x, lit(undefined)) 记 conflicting", () => {
    const a = numWith(and(eq(v("x"), lit(5)), eq(v("x"), lit(undefined))));
    const { dropped } = absToSchemaNode(a);
    expect(dropped.some((d) => d.includes("conflicting"))).toBe(true);
  });

  it("gt(x, lit(NaN)) 记 dropped 且不生成 .gt(NaN)", () => {
    const a = numWith(gt(v("x"), lit(NaN)));
    const { node, dropped } = absToSchemaNode(a);
    expect(dropped.some((d) => d.includes("not projected"))).toBe(true);
    expect(absToSchemaSource(a)).not.toContain("NaN");
    expect(node).toEqual({ k: "prim", type: "number", refinements: [] });
  });

  it("gt(x, lit(Infinity)) 不生成 .gt(Infinity)", () => {
    const a = numWith(gt(v("x"), lit(Infinity)));
    const { dropped } = absToSchemaNode(a);
    expect(dropped.some((d) => d.includes("not projected"))).toBe(true);
    expect(absToSchemaSource(a)).not.toContain("Infinity");
  });

  it("constraint 路径：eq(undefined) 同样产 lit(undefined) 节点", () => {
    // absToSchemaNode 优先走 core absToConstraint → constraintToSchemaNode
    const a = numWith(eq(v("x"), lit(undefined)));
    const { source } = absToZodSchemaModule({ out: a });
    expect(source).toContain("z.undefined()");
  });
});
